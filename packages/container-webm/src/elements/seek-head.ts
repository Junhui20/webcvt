/**
 * SeekHead element (ID 0x114D9B74) decode and encode.
 *
 * SeekHead is optional but recommended (Trap §10).
 * Writer uses it to point to Info, Tracks, and Cues.
 * Reader uses it optionally for position hints; the parser always
 * falls back to a linear scan regardless.
 *
 * Void element (0xEC) is used for padding inside SeekHead to fill the
 * reserved byte budget (SEEK_HEAD_RESERVED_BYTES) — Trap §16.
 */

import {
  ID_SEEK,
  ID_SEEK_HEAD,
  ID_SEEK_ID,
  ID_SEEK_POSITION,
  ID_VOID,
  SEEK_HEAD_RESERVED_BYTES,
} from '../constants.ts';
import { findChildren, parseFlatChildren } from '../ebml-element.ts';
import type { EbmlElement } from '../ebml-element.ts';
import { concatBytes, readUintNumber, writeUint } from '../ebml-types.ts';
import { writeVintId, writeVintSize } from '../ebml-vint.ts';
import { WebmCorruptStreamError, WebmMissingElementError } from '../errors.ts';
import { encodeBinaryElement, encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebmSeekEntry {
  /** The target element's ID as a Uint8Array (SeekID is binary). */
  seekId: Uint8Array;
  /** Segment-relative byte offset of the target element. */
  seekPosition: number;
}

export interface WebmSeekHead {
  entries: WebmSeekEntry[];
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode a SeekHead element from its direct children.
 * Unknown children (other than Seek) are skipped per Trap §14.
 *
 * @param bytes          Full file buffer.
 * @param children       Direct children of the SeekHead master element.
 * @param elementCount   Mutable global element counter for cap enforcement (Q-H-2 / Sec-M-1).
 * @param segmentPayloadOffset  Absolute file offset of Segment payload start (for Sec-M-2 bounds check).
 */
export function decodeSeekHead(
  bytes: Uint8Array,
  children: EbmlElement[],
  elementCount: { value: number } = { value: 0 },
  segmentPayloadOffset = 0,
): WebmSeekHead {
  const seekElems = findChildren(children, ID_SEEK);
  const entries: WebmSeekEntry[] = [];

  for (const seekElem of seekElems) {
    // Q-H-2 / Sec-M-1: use shared helper that threads elementCount + size caps.
    const seekChildren = parseFlatChildren(bytes, seekElem, elementCount);

    const seekIdElem = seekChildren.find((c) => c.id === ID_SEEK_ID);
    const seekPosElem = seekChildren.find((c) => c.id === ID_SEEK_POSITION);

    if (!seekIdElem || !seekPosElem) continue; // tolerate malformed Seek entries

    const seekId = bytes.subarray(seekIdElem.payloadOffset, seekIdElem.nextOffset).slice();
    const seekPosition = readUintNumber(
      bytes.subarray(seekPosElem.payloadOffset, seekPosElem.nextOffset),
    );

    // Sec-M-2: validate absolute file offset against file bounds.
    const absoluteOffset = segmentPayloadOffset + seekPosition;
    if (absoluteOffset >= bytes.length) {
      throw new WebmCorruptStreamError(
        `SeekPosition ${seekPosition} + segmentPayloadOffset ${segmentPayloadOffset} = ${absoluteOffset} exceeds file length ${bytes.length}`,
      );
    }

    entries.push({ seekId, seekPosition });
  }

  return { entries };
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode a SeekHead element padded to SEEK_HEAD_RESERVED_BYTES total.
 *
 * The SeekHead element itself (ID + size + body) must fit within the reserved
 * budget. If the body is smaller, the remaining space is filled with a Void
 * element (Trap §16).
 *
 * @param entries           Seek entries to include.
 * @returns Uint8Array of exactly SEEK_HEAD_RESERVED_BYTES bytes.
 */
export function encodeSeekHead(entries: WebmSeekEntry[]): Uint8Array {
  const seekParts = entries.map(encodeSeekEntry);
  const body = concatBytes(seekParts);

  // SeekHead ID (4 bytes: 0x11 0x4D 0x9B 0x74) + size VINT (1 byte for small bodies) + body.
  const idBytes = writeVintId(ID_SEEK_HEAD);
  const sizeBytes = writeVintSize(BigInt(body.length));
  const seekHeadBytes = concatBytes([idBytes, sizeBytes, body]);

  if (seekHeadBytes.length > SEEK_HEAD_RESERVED_BYTES) {
    // Body too large for reserved budget — emit without padding.
    return seekHeadBytes;
  }

  // Pad remainder with a Void element.
  const remaining = SEEK_HEAD_RESERVED_BYTES - seekHeadBytes.length;
  if (remaining < 2) {
    // Cannot fit even a minimal Void element; return as-is.
    const padded = new Uint8Array(SEEK_HEAD_RESERVED_BYTES);
    padded.set(seekHeadBytes);
    return padded;
  }

  const voidPayloadSize = remaining - 2; // 1 byte ID (0xEC) + 1 byte size VINT
  const voidElem = buildVoid(voidPayloadSize);
  const out = concatBytes([seekHeadBytes, voidElem]);

  // If still short (unlikely), zero-pad to budget.
  if (out.length < SEEK_HEAD_RESERVED_BYTES) {
    const padded = new Uint8Array(SEEK_HEAD_RESERVED_BYTES);
    padded.set(out);
    return padded;
  }

  return out.subarray(0, SEEK_HEAD_RESERVED_BYTES);
}

function encodeSeekEntry(entry: WebmSeekEntry): Uint8Array {
  const children = concatBytes([
    encodeBinaryElement(ID_SEEK_ID, entry.seekId),
    encodeUintElement(ID_SEEK_POSITION, BigInt(entry.seekPosition)),
  ]);
  return encodeMasterElement(ID_SEEK, children);
}

/**
 * Build a Void element (0xEC) with the given payload size.
 * Void payload is zero-filled padding (Trap §16).
 */
function buildVoid(payloadSize: number): Uint8Array {
  if (payloadSize < 0) return new Uint8Array(0);

  // Void ID is 1 byte: 0xEC.
  const idByte = new Uint8Array([ID_VOID]);
  const sizeBytes = writeVintSize(BigInt(payloadSize));
  const voidPayload = new Uint8Array(payloadSize); // zero-filled
  return concatBytes([idByte, sizeBytes, voidPayload]);
}

// ---------------------------------------------------------------------------
// Helper: ID bytes for a known element (for SeekID encoding)
// ---------------------------------------------------------------------------

/**
 * Convert a numeric element ID to its wire bytes (for SeekID field).
 */
export function idToBytes(id: number): Uint8Array {
  return writeVintId(id);
}
