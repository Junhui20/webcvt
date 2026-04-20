/**
 * RIFF chunk reader and writer for WebP animated images.
 *
 * RIFF chunk layout: fourcc(4 bytes) | size(u32 LE) | payload(size bytes) | [pad byte if size is odd]
 *
 * The pad byte (0x00) aligns chunks to 16-bit boundaries per RIFF spec.
 * The outer RIFF chunk's size field INCLUDES the 4-byte WEBP FourCC (Trap §11).
 */

import { MAX_RIFF_CHUNK_BYTES } from './constants.ts';
import {
  WebpChunkStreamTruncatedError,
  WebpChunkTooLargeError,
  WebpChunkTruncatedError,
} from './errors.ts';

export interface RiffChunk {
  /** 4-character FourCC (e.g. 'VP8X', 'ANIM', 'ANMF'). */
  fourcc: string;
  /** Declared payload size in bytes (per the chunk's size field). */
  size: number;
  /** Payload bytes (subarray of the source buffer). */
  payload: Uint8Array;
  /** Byte offset in the source where this chunk starts (FourCC field). */
  offset: number;
  /** Byte offset immediately after this chunk (next chunk's FourCC field, or end of buffer). */
  nextOffset: number;
}

/**
 * Read a single RIFF chunk from `bytes` at `offset`.
 * Handles the odd-byte pad rule: if size is odd, advances nextOffset by 1 extra byte.
 *
 * @throws WebpChunkTooLargeError if chunk size > MAX_RIFF_CHUNK_BYTES
 */
export function readRiffChunk(bytes: Uint8Array, offset: number): RiffChunk {
  if (offset + 8 > bytes.length) {
    throw new WebpChunkStreamTruncatedError(offset);
  }

  // ?? 0 fallbacks below are structurally unreachable: offset+7 < bytes.length guaranteed by the check above
  /* v8 ignore next 6 — offset+3 in bounds: verified by offset+8 <= bytes.length above */
  const fourcc = String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );

  /* v8 ignore next 6 — offset+7 in bounds: verified by offset+8 <= bytes.length above */
  const size =
    ((bytes[offset + 4] ?? 0) |
      ((bytes[offset + 5] ?? 0) << 8) |
      ((bytes[offset + 6] ?? 0) << 16) |
      ((bytes[offset + 7] ?? 0) << 24)) >>>
    0;

  if (size > MAX_RIFF_CHUNK_BYTES) {
    throw new WebpChunkTooLargeError(fourcc, size, MAX_RIFF_CHUNK_BYTES);
  }

  const payloadStart = offset + 8;
  if (payloadStart + size > bytes.length) {
    throw new WebpChunkTruncatedError(fourcc, offset, size);
  }

  const payload = bytes.subarray(payloadStart, payloadStart + size);

  // RIFF chunks are padded to even size — odd-size chunks have a trailing 0x00 pad byte
  const padded = size + (size & 1);
  const nextOffset = payloadStart + padded;

  return {
    fourcc,
    size,
    payload,
    offset,
    nextOffset,
  };
}

/**
 * Write a single RIFF chunk: fourcc | size(u32 LE) | payload | [pad byte].
 * Returns the encoded chunk as a new Uint8Array.
 */
export function writeRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const size = payload.length;
  const padded = size + (size & 1);
  const out = new Uint8Array(8 + padded);

  // FourCC (4 bytes)
  for (let i = 0; i < 4; i++) {
    out[i] = fourcc.charCodeAt(i) & 0xff;
  }

  // Size (u32 LE)
  out[4] = size & 0xff;
  out[5] = (size >> 8) & 0xff;
  out[6] = (size >> 16) & 0xff;
  out[7] = (size >> 24) & 0xff;

  // Payload
  out.set(payload, 8);

  // Pad byte is already 0 from Uint8Array initialization

  return out;
}

/**
 * Read a uint32 little-endian value from `bytes` at `offset`.
 */
export function readU32Le(bytes: Uint8Array, offset: number): number {
  /* v8 ignore next 6 — ?? 0 fallbacks are structurally unreachable: callers validate bounds before calling these helpers */
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Read a uint24 little-endian value from `bytes` at `offset`.
 */
export function readU24Le(bytes: Uint8Array, offset: number): number {
  /* v8 ignore next 1 — ?? 0 fallbacks are structurally unreachable: callers validate bounds before calling this helper */
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

/**
 * Read a uint16 little-endian value from `bytes` at `offset`.
 */
export function readU16Le(bytes: Uint8Array, offset: number): number {
  /* v8 ignore next 1 — ?? 0 fallbacks are structurally unreachable: callers validate bounds before calling this helper */
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0;
}
