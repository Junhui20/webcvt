/**
 * PNG chunk reader and writer.
 *
 * PNG chunk layout: length(u32 BE) | type(4 ASCII) | data(length bytes) | crc32(u32 BE)
 *
 * CRC-32 is computed over type + data (Trap §8: NOT over length, NOT over data alone).
 */

import { MAX_PNG_CHUNK_BYTES } from './constants.ts';
import { crc32Two } from './crc32.ts';
import {
  ApngBadCrcError,
  ApngChunkStreamTruncatedError,
  ApngChunkTooLargeError,
  ApngChunkTruncatedError,
} from './errors.ts';

export interface PngChunk {
  /** 4-character ASCII chunk type (e.g. 'IHDR', 'IDAT'). */
  type: string;
  /** Raw chunk data bytes (excludes length, type, and CRC). */
  data: Uint8Array;
  /** Stored CRC-32 value from the file. */
  storedCrc: number;
  /** Byte offset in the input where the chunk starts (length field). */
  offset: number;
  /** Byte offset immediately after this chunk (next chunk's length field). */
  nextOffset: number;
}

/**
 * Read a single PNG chunk from `bytes` starting at `offset`.
 * Validates the CRC-32 over type + data.
 *
 * @throws ApngChunkTooLargeError if chunk data length > MAX_PNG_CHUNK_BYTES
 * @throws ApngBadCrcError if the stored CRC doesn't match computed CRC
 */
export function readPngChunk(bytes: Uint8Array, offset: number): PngChunk {
  if (offset + 8 > bytes.length) {
    throw new ApngChunkStreamTruncatedError(offset);
  }

  // ?? 0 fallbacks below are structurally unreachable: offset+8 <= bytes.length ensures all reads are in bounds
  /* v8 ignore next 6 — offset+3 < bytes.length is guaranteed by the bounds check above */
  const length =
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0;

  if (length > MAX_PNG_CHUNK_BYTES) {
    const type = readChunkType(bytes, offset + 4);
    throw new ApngChunkTooLargeError(type, length, MAX_PNG_CHUNK_BYTES);
  }

  const typeEnd = offset + 8;
  if (typeEnd + length + 4 > bytes.length) {
    const type = readChunkType(bytes, offset + 4);
    throw new ApngChunkTruncatedError(type, offset, length);
  }

  const typeBytes = bytes.subarray(offset + 4, offset + 8);
  // typeBytes has exactly 4 elements since subarray(offset+4, offset+8) and offset+8 <= bytes.length
  /* v8 ignore next 6 — typeBytes always has 4 elements: subarray bounds are validated above */
  const type = String.fromCharCode(
    typeBytes[0] ?? 0,
    typeBytes[1] ?? 0,
    typeBytes[2] ?? 0,
    typeBytes[3] ?? 0,
  );

  const data = bytes.subarray(offset + 8, offset + 8 + length);

  const storedCrcOffset = offset + 8 + length;
  // storedCrcOffset+3 < bytes.length is guaranteed by the typeEnd + length + 4 <= bytes.length check
  /* v8 ignore next 6 — storedCrcOffset+3 is in bounds: validated by the typeEnd+length+4 check above */
  const storedCrc =
    (((bytes[storedCrcOffset] ?? 0) << 24) |
      ((bytes[storedCrcOffset + 1] ?? 0) << 16) |
      ((bytes[storedCrcOffset + 2] ?? 0) << 8) |
      (bytes[storedCrcOffset + 3] ?? 0)) >>>
    0;

  const computedCrc = crc32Two(typeBytes, data);
  if (computedCrc !== storedCrc) {
    throw new ApngBadCrcError(type, offset, computedCrc, storedCrc);
  }

  return {
    type,
    data,
    storedCrc,
    offset,
    nextOffset: storedCrcOffset + 4,
  };
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  /* v8 ignore next 6 — ?? 0 fallbacks are defensive; callers only invoke this after validating offset+4 <= bytes.length */
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * Write a single PNG chunk: length | type | data | crc32(type + data).
 * Returns the encoded chunk as a new Uint8Array.
 */
export function writePngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    typeBytes[i] = type.charCodeAt(i) & 0xff;
  }

  const crc = crc32Two(typeBytes, data);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  const len = data.length;
  out[0] = (len >> 24) & 0xff;
  out[1] = (len >> 16) & 0xff;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(typeBytes, 4);
  out.set(data, 8);
  out[8 + len] = (crc >> 24) & 0xff;
  out[8 + len + 1] = (crc >> 16) & 0xff;
  out[8 + len + 2] = (crc >> 8) & 0xff;
  out[8 + len + 3] = crc & 0xff;

  return out;
}
