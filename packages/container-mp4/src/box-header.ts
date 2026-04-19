/**
 * MP4 box header parser.
 *
 * Handles the three size-encoding variants (ISO/IEC 14496-12 §4.2):
 *   size > 1        — total box size including 8-byte header
 *   size == 1       — read 8 more bytes as largesize (u64)
 *   size == 0       — extends to EOF (valid only for top-level mdat)
 *
 * uuid boxes (type == 'uuid') are not supported in Phase 3; the caller
 * handles them by throwing Mp4UnsupportedBrandError.
 *
 * All multi-byte fields are big-endian (Trap §7).
 */

import { Mp4InvalidBoxError } from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4BoxHeader {
  /** Four-character code, e.g. 'moov', 'mp4a'. */
  type: string;
  /**
   * Total box size in bytes including header.
   * For size==0 (EOF-extent mdat), this is set to (fileLength - headerOffset).
   */
  size: number;
  /** 8 for normal header, 16 when largesize was used. */
  headerSize: 8 | 16;
  /** Absolute file offset of first payload byte. */
  payloadOffset: number;
  /** size - headerSize */
  payloadSize: number;
}

// ---------------------------------------------------------------------------
// Module-scope TextDecoder (Lesson #2: hoist to module scope, not per-call).
// ---------------------------------------------------------------------------
const TEXT_DECODER = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read an MP4 box header starting at `offset` within `data`.
 *
 * @param data       The full file buffer.
 * @param offset     Byte offset of the box start.
 * @param fileLength Full file byte length (used for size==0 resolution).
 * @returns          Parsed header or null if fewer than 8 bytes remain.
 * @throws Mp4InvalidBoxError on malformed size fields.
 */
export function readBoxHeader(
  data: Uint8Array,
  offset: number,
  fileLength: number,
): Mp4BoxHeader | null {
  // Need at minimum 8 bytes for size + type.
  if (offset + 8 > fileLength) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const rawSize = view.getUint32(offset, false); // big-endian
  const type = TEXT_DECODER.decode(data.subarray(offset + 4, offset + 8));

  if (rawSize === 1) {
    // largesize: 8 more bytes follow the type field.
    if (offset + 16 > fileLength) {
      throw new Mp4InvalidBoxError(
        `Box at offset ${offset} uses largesize but fewer than 16 bytes remain.`,
      );
    }
    const hi = view.getUint32(offset + 8, false);
    const lo = view.getUint32(offset + 12, false);
    // Combine hi and lo into a JS number. Boxes <= 2^53 bytes are representable.
    const largeSize = hi * 0x100000000 + lo;
    if (largeSize < 16) {
      throw new Mp4InvalidBoxError(
        `Box at offset ${offset} has largesize=${largeSize} which is less than the 16-byte header.`,
      );
    }
    // Sec-M-2: validate largeSize against remaining bytes to guard against
    // overflow and against values that cannot possibly be satisfied.
    if (largeSize > fileLength - offset) {
      throw new Mp4InvalidBoxError(
        `largesize ${largeSize} at offset ${offset} exceeds remaining bytes (${fileLength - offset}).`,
      );
    }
    return {
      type,
      size: largeSize,
      headerSize: 16,
      payloadOffset: offset + 16,
      payloadSize: largeSize - 16,
    };
  }

  if (rawSize === 0) {
    // Sec-M-3: size==0 (extends-to-EOF) is only valid for the top-level mdat box.
    if (type !== 'mdat') {
      throw new Mp4InvalidBoxError(
        `size==0 (extends-to-EOF) is only valid for the top-level mdat box; got type='${type}' at offset ${offset}.`,
      );
    }
    // Extends to EOF — we compute the effective size here.
    const effectiveSize = fileLength - offset;
    return {
      type,
      size: effectiveSize,
      headerSize: 8,
      payloadOffset: offset + 8,
      payloadSize: effectiveSize - 8,
    };
  }

  if (rawSize < 8) {
    throw new Mp4InvalidBoxError(
      `Box at offset ${offset} has size=${rawSize} which is less than the minimum 8-byte header.`,
    );
  }

  return {
    type,
    size: rawSize,
    headerSize: 8,
    payloadOffset: offset + 8,
    payloadSize: rawSize - 8,
  };
}

/**
 * Encode a four-character code to bytes (big-endian, ASCII).
 * Used by the serializer.
 */
export function encodeFourCC(type: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    out[i] = type.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Write a standard 8-byte box header (size + type) into a pre-allocated buffer
 * at the given offset.
 */
export function writeBoxHeader(buf: Uint8Array, offset: number, size: number, type: string): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, size, false);
  const typeBytes = encodeFourCC(type);
  buf.set(typeBytes, offset + 4);
}

/**
 * Write a 16-byte largesize box header (size=1 + type + largesize u64) into
 * a pre-allocated buffer at the given offset.
 */
export function writeLargeBoxHeader(
  buf: Uint8Array,
  offset: number,
  largeSize: number,
  type: string,
): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, 1, false); // size == 1 signals largesize
  const typeBytes = encodeFourCC(type);
  buf.set(typeBytes, offset + 4);
  const hi = Math.floor(largeSize / 0x100000000);
  const lo = largeSize >>> 0;
  view.setUint32(offset + 8, hi, false);
  view.setUint32(offset + 12, lo, false);
}
