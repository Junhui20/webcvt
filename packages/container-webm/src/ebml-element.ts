/**
 * EBML element header parsing and iterative element walker.
 *
 * Uses an explicit stack (NOT recursion) to descend into master elements.
 * Depth is capped at MAX_NEST_DEPTH (8) per design note §9 / Trap §9.
 *
 * Element header layout: [ID VINT][Size VINT][payload...]
 *
 * The walker is the core building block for both the two-phase segment scan
 * and the deep descent into Info, Tracks, and Cluster elements.
 */

import { MAX_ELEMENTS_PER_FILE, MAX_ELEMENT_PAYLOAD_BYTES, MAX_NEST_DEPTH } from './constants.ts';
import { readVintId, readVintSize } from './ebml-vint.ts';
import {
  WebmDepthExceededError,
  WebmElementTooLargeError,
  WebmTooManyElementsError,
  WebmTruncatedError,
  WebmUnknownSizeError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EbmlElement {
  /** Numeric ID with leading length-marker bit retained (e.g. 0x1A45DFA3). */
  id: number;
  /** Size of payload in bytes. -1n means unknown size (rejected first pass). */
  size: bigint;
  /** Absolute file offset of the first payload byte. */
  payloadOffset: number;
  /** Absolute file offset of the next sibling element (payloadOffset + size). */
  nextOffset: number;
  /** Wire width of the ID VINT (bytes). */
  idWidth: number;
  /** Wire width of the size VINT (bytes). */
  sizeWidth: number;
}

// ---------------------------------------------------------------------------
// readElementHeader — parse one EBML element header at the given offset
// ---------------------------------------------------------------------------

/**
 * Parse an EBML element header at `offset` within `bytes`.
 *
 * Returns the element descriptor or null if fewer than 2 bytes remain
 * (tolerate trailing padding).
 *
 * @throws WebmVintError on malformed VINT.
 * @throws WebmUnknownSizeError if size VINT is the unknown-size pattern.
 * @throws WebmTruncatedError if claimed size exceeds remaining bytes in the file.
 */
export function readElementHeader(
  bytes: Uint8Array,
  offset: number,
  containerEnd: number,
  allowUnknownSize = false,
): EbmlElement | null {
  if (offset >= containerEnd) return null;
  // Need at least 2 bytes for a minimal element (1-byte ID + 1-byte size).
  if (containerEnd - offset < 2) return null;

  const idVint = readVintId(bytes, offset);
  const sizeOffset = offset + idVint.width;
  const sizeVint = readVintSize(bytes, sizeOffset);

  const payloadOffset = sizeOffset + sizeVint.width;

  if (sizeVint.value === -1n) {
    if (!allowUnknownSize) {
      throw new WebmUnknownSizeError(idVint.value, offset);
    }
    // Unknown size: nextOffset set to containerEnd (consume to end).
    return {
      id: idVint.value,
      size: -1n,
      payloadOffset,
      nextOffset: containerEnd,
      idWidth: idVint.width,
      sizeWidth: sizeVint.width,
    };
  }

  const nextOffset = payloadOffset + Number(sizeVint.value);

  // Validate claimed size against the enclosing container boundary.
  if (nextOffset > containerEnd) {
    throw new WebmTruncatedError(idVint.value, sizeVint.value, containerEnd - payloadOffset);
  }

  return {
    id: idVint.value,
    size: sizeVint.value,
    payloadOffset,
    nextOffset,
    idWidth: idVint.width,
    sizeWidth: sizeVint.width,
  };
}

// ---------------------------------------------------------------------------
// Stack frame for iterative walker
// ---------------------------------------------------------------------------

interface StackFrame {
  start: number;
  end: number;
  depth: number;
}

// ---------------------------------------------------------------------------
// walkElements — flat iterative walker over a range
// ---------------------------------------------------------------------------

/**
 * Walk all EBML elements in `bytes[start..end)` at `depth`, yielding each
 * element header without descending. Callers decide whether to push child
 * ranges onto the stack.
 *
 * This is a generator that yields one EbmlElement per parsed element. The
 * caller is responsible for all descent decisions, caps, and dispatch.
 *
 * Security: enforces MAX_NEST_DEPTH and validates each element header.
 */
export function* walkElements(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  elementCount: { value: number },
  maxElements: number,
  maxElementPayloadBytes: number,
  clusterId: number,
  segmentId: number,
): Generator<EbmlElement> {
  if (depth > MAX_NEST_DEPTH) {
    throw new WebmDepthExceededError(MAX_NEST_DEPTH);
  }

  let cursor = start;

  while (cursor < end) {
    elementCount.value += 1;
    if (elementCount.value > maxElements) {
      throw new WebmTooManyElementsError(maxElements);
    }

    const elem = readElementHeader(bytes, cursor, end);
    if (elem === null) break;

    // Per-element size cap (Cluster and Segment have their own caps handled by caller).
    if (elem.id !== clusterId && elem.id !== segmentId) {
      if (elem.size > BigInt(maxElementPayloadBytes)) {
        throw new WebmElementTooLargeError(elem.id, elem.size, maxElementPayloadBytes);
      }
    }

    yield elem;
    cursor = elem.nextOffset;
  }
}

// ---------------------------------------------------------------------------
// readChildren — parse all direct children of a master element
// ---------------------------------------------------------------------------

/**
 * Parse all direct children of the master element at `elem.payloadOffset`.
 * Returns a flat array of child EbmlElement descriptors — does NOT recurse.
 *
 * Used by the element decoders (header, info, tracks, cluster, cues) after
 * the element-walker has already located the parent.
 */
export function readChildren(
  bytes: Uint8Array,
  payloadOffset: number,
  payloadEnd: number,
  depth: number,
  elementCount: { value: number },
  maxElements: number,
  maxElementPayloadBytes: number,
  clusterId: number,
  segmentId: number,
): EbmlElement[] {
  const children: EbmlElement[] = [];

  for (const elem of walkElements(
    bytes,
    payloadOffset,
    payloadEnd,
    depth,
    elementCount,
    maxElements,
    maxElementPayloadBytes,
    clusterId,
    segmentId,
  )) {
    children.push(elem);
  }

  return children;
}

// ---------------------------------------------------------------------------
// findChild / findChildren helpers (by element ID)
// ---------------------------------------------------------------------------

export function findChild(children: EbmlElement[], id: number): EbmlElement | undefined {
  return children.find((c) => c.id === id);
}

export function findChildren(children: EbmlElement[], id: number): EbmlElement[] {
  return children.filter((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// parseFlatChildren — shared flat child scanner with element-count threading
// ---------------------------------------------------------------------------

/**
 * Parse all direct children of a master element using a simple linear scan.
 *
 * Q-H-2 / Sec-M-1: shared implementation used by cues.ts, seek-head.ts, and
 * tracks.ts to eliminate duplication and to thread the global element count so
 * that MAX_ELEMENTS_PER_FILE is enforced across nested child scans.
 *
 * @param bytes          Full file buffer.
 * @param elem           Parent master element descriptor.
 * @param elementCount   Mutable counter shared across the entire parse (global cap).
 * @param maxElements    Maximum total element count (typically MAX_ELEMENTS_PER_FILE).
 * @param maxPayloadBytes Per-element size cap (typically MAX_ELEMENT_PAYLOAD_BYTES).
 */
export function parseFlatChildren(
  bytes: Uint8Array,
  elem: EbmlElement,
  elementCount: { value: number } = { value: 0 },
  maxElements: number = MAX_ELEMENTS_PER_FILE,
  maxPayloadBytes: number = MAX_ELEMENT_PAYLOAD_BYTES,
): EbmlElement[] {
  const children: EbmlElement[] = [];
  let cursor = elem.payloadOffset;
  const end = elem.nextOffset;

  while (cursor < end) {
    if (end - cursor < 2) break;

    const idVint = readVintId(bytes, cursor);
    const sizeOffset = cursor + idVint.width;
    const sizeVint = readVintSize(bytes, sizeOffset);

    if (sizeVint.value === -1n) break; // unknown size: stop scan

    const payloadOffset = sizeOffset + sizeVint.width;
    const nextOffset = payloadOffset + Number(sizeVint.value);

    if (nextOffset > end) break; // truncated child: stop

    elementCount.value++;
    if (elementCount.value > maxElements) {
      throw new WebmTooManyElementsError(maxElements);
    }

    if (sizeVint.value > BigInt(maxPayloadBytes)) {
      throw new WebmElementTooLargeError(idVint.value, sizeVint.value, maxPayloadBytes);
    }

    children.push({
      id: idVint.value,
      size: sizeVint.value,
      payloadOffset,
      nextOffset,
      idWidth: idVint.width,
      sizeWidth: sizeVint.width,
    });

    cursor = nextOffset;
  }

  return children;
}
