/**
 * Iterative box-tree walker for MP4 containers.
 *
 * Uses an explicit stack (NOT recursion) to descend into container boxes.
 * Depth is capped at MAX_DEPTH (10) by design — this is tight enough to
 * cover moov→trak→mdia→minf→stbl→stsd→mp4a (7 levels) while bounding
 * adversarial inputs that nest thousands of containers. The spec note
 * says "it forces a stack rather than unbounded recursion".
 *
 * The walker collects every box header it encounters, grouped by parent
 * path. Container types are defined in CONTAINER_BOX_TYPES.
 */

import { type Mp4BoxHeader, readBoxHeader } from './box-header.ts';
import {
  CONTAINER_BOX_TYPES,
  MAX_BOXES_PER_FILE,
  MAX_BOX_SIZE_NON_MDAT,
  MAX_DEPTH,
} from './constants.ts';
import { Mp4DepthExceededError, Mp4InvalidBoxError, Mp4TooManyBoxesError } from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4Box extends Mp4BoxHeader {
  /**
   * Raw payload bytes — zero-copy subarray into the original file buffer
   * (Lesson #3: use subarray not slice for stored views).
   */
  payload: Uint8Array;
  /** Child boxes, populated when this is a known container type. */
  children: Mp4Box[];
  /** Depth of this box (0 = top-level). */
  depth: number;
}

// ---------------------------------------------------------------------------
// Stack frame for iterative descent
// ---------------------------------------------------------------------------

interface StackFrame {
  /** Absolute file offset where children start. */
  start: number;
  /** Absolute file offset where children end (exclusive). */
  end: number;
  /** Parent box that accumulates children (or null for top-level). */
  parent: Mp4Box | null;
  /** Depth of children (parent.depth + 1, or 0 for top-level). */
  depth: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk all boxes in `data` starting at `rangeStart`, ending before `rangeEnd`.
 *
 * Returns the flat list of top-level boxes; each container box's `.children`
 * array contains its direct children (recursively populated).
 *
 * @param data        Full file buffer.
 * @param rangeStart  Start offset (inclusive).
 * @param rangeEnd    End offset (exclusive). Pass `data.length` for the full file.
 * @param boxCount    Mutable counter shared across the walk (for MAX_BOXES cap).
 */
export function walkBoxes(
  data: Uint8Array,
  rangeStart: number,
  rangeEnd: number,
  boxCount: { value: number },
): Mp4Box[] {
  const topLevel: Mp4Box[] = [];

  // Iterative stack — each frame represents a range of bytes to parse as siblings.
  const stack: StackFrame[] = [{ start: rangeStart, end: rangeEnd, parent: null, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;

    if (frame.depth > MAX_DEPTH) {
      throw new Mp4DepthExceededError(MAX_DEPTH);
    }

    let cursor = frame.start;

    while (cursor < frame.end) {
      // Read box header.
      const header = readBoxHeader(data, cursor, data.length);
      if (header === null) {
        // Less than 8 bytes remain — tolerate trailing padding.
        break;
      }

      // Validate declared size doesn't overrun parent boundary (Sec-H-1).
      // A single guard — no off-by-one tolerance. readBoxHeader resolves size==0
      // to (fileLength - offset) before returning, so size>0 is always true here.
      const boxEnd = cursor + header.size;
      if (boxEnd > frame.end) {
        throw new Mp4InvalidBoxError(
          `box at offset ${cursor} (type ${header.type}) overruns its container (boxEnd=${boxEnd}, containerEnd=${frame.end}).`,
        );
      }

      // Per-box size cap (mdat exempted).
      if (header.type !== 'mdat' && header.size > MAX_BOX_SIZE_NON_MDAT) {
        throw new Mp4InvalidBoxError(
          `Box "${header.type}" at offset ${cursor} claims size ${header.size} which exceeds the 64 MiB per-box cap.`,
        );
      }

      // Global box count cap.
      boxCount.value += 1;
      if (boxCount.value > MAX_BOXES_PER_FILE) {
        throw new Mp4TooManyBoxesError(MAX_BOXES_PER_FILE);
      }

      // Payload slice — zero-copy subarray (Lesson #3).
      const payloadEnd = Math.min(header.payloadOffset + header.payloadSize, data.length);
      const payload = data.subarray(header.payloadOffset, payloadEnd);

      const box: Mp4Box = {
        ...header,
        payload,
        children: [],
        depth: frame.depth,
      };

      // Attach to parent or top-level list.
      if (frame.parent !== null) {
        frame.parent.children.push(box);
      } else {
        topLevel.push(box);
      }

      // Descend into known container types (except mdat — opaque).
      if (CONTAINER_BOX_TYPES.has(header.type) && header.type !== 'mdat') {
        const childDepth = frame.depth + 1;
        if (childDepth > MAX_DEPTH) {
          throw new Mp4DepthExceededError(MAX_DEPTH);
        }
        // Push child range onto stack. Stack order: last pushed = first processed.
        stack.push({
          start: header.payloadOffset,
          end: header.payloadOffset + header.payloadSize,
          parent: box,
          depth: childDepth,
        });
      }

      cursor += header.size;
    }
  }

  return topLevel;
}

/**
 * Find the first direct child of `box` whose type equals `type`.
 * Returns undefined if not found.
 */
export function findChild(box: Mp4Box, type: string): Mp4Box | undefined {
  return box.children.find((c) => c.type === type);
}

/**
 * Find all direct children of `box` whose type equals `type`.
 */
export function findChildren(box: Mp4Box, type: string): Mp4Box[] {
  return box.children.filter((c) => c.type === type);
}

/**
 * Walk the payload of a non-container box as a flat sequence of child boxes
 * (used for mp4a which is not in CONTAINER_BOX_TYPES but does contain esds).
 * Returns parsed child boxes without descending further.
 */
export function walkPayloadBoxes(
  data: Uint8Array,
  startOffset: number,
  endOffset: number,
  depth: number,
  boxCount: { value: number },
): Mp4Box[] {
  if (depth > MAX_DEPTH) {
    throw new Mp4DepthExceededError(MAX_DEPTH);
  }

  const boxes: Mp4Box[] = [];
  let cursor = startOffset;

  while (cursor < endOffset) {
    const header = readBoxHeader(data, cursor, data.length);
    if (header === null) break;

    if (cursor + header.size > endOffset) {
      throw new Mp4InvalidBoxError(
        `Box "${header.type}" at offset ${cursor} claims size ${header.size} which exceeds payload boundary.`,
      );
    }

    boxCount.value += 1;
    if (boxCount.value > MAX_BOXES_PER_FILE) {
      throw new Mp4TooManyBoxesError(MAX_BOXES_PER_FILE);
    }

    const payloadEnd = Math.min(header.payloadOffset + header.payloadSize, data.length);
    const payload = data.subarray(header.payloadOffset, payloadEnd);

    boxes.push({ ...header, payload, children: [], depth });

    cursor += header.size;
  }

  return boxes;
}
