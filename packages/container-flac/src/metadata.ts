/**
 * FLAC metadata block header decoder and higher-level block parsers.
 *
 * Block types supported for reading:
 *   0 = STREAMINFO   (decoded by streaminfo.ts)
 *   1 = PADDING      (body ignored)
 *   2 = APPLICATION  (raw body stored)
 *   3 = SEEKTABLE    (decoded into seek points)
 *   4 = VORBIS_COMMENT (decoded into key/value pairs)
 *   5 = CUESHEET     (raw body stored)
 *   6 = PICTURE      (decoded per Trap #4)
 * 127 = INVALID
 *
 * Refs: https://xiph.org/flac/format.html#metadata_block
 *       https://xiph.org/vorbis/doc/v-comment.html
 */

import { FlacInvalidMetadataError } from './errors.ts';

// ---------------------------------------------------------------------------
// Block type constants
// ---------------------------------------------------------------------------

export const BLOCK_TYPE_STREAMINFO = 0;
export const BLOCK_TYPE_PADDING = 1;
export const BLOCK_TYPE_APPLICATION = 2;
export const BLOCK_TYPE_SEEKTABLE = 3;
export const BLOCK_TYPE_VORBIS_COMMENT = 4;
export const BLOCK_TYPE_CUESHEET = 5;
export const BLOCK_TYPE_PICTURE = 6;
export const BLOCK_TYPE_INVALID = 127;

// ---------------------------------------------------------------------------
// Shared decoder singleton — avoids per-call TextDecoder allocation (H-3)
// ---------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// Allocation caps
// ---------------------------------------------------------------------------

/** H-2: Maximum number of seek points in a SEEKTABLE. */
const MAX_SEEKPOINTS = 65_536;

/** H-3: Maximum number of Vorbis comments in a single block. */
const MAX_COMMENTS = 100_000;

/** H-3: Maximum length in bytes of a single Vorbis comment (1 MiB). */
const MAX_COMMENT_LENGTH = 1 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Raw metadata block (body stored verbatim for round-trip fidelity). */
export interface FlacMetadataBlock {
  /** Block type 0..6, 127. */
  type: number;
  /** Raw body bytes (NOT including the 4-byte block header). */
  data: Uint8Array;
}

/** Decoded seek point from SEEKTABLE block. */
export interface FlacSeekPoint {
  /** Sample number of the first sample in the target frame. 0xFFFF…FF = placeholder. */
  sampleNumber: number;
  /** Offset in bytes from the first frame to the target frame. */
  byteOffset: number;
  /** Number of samples in the target frame. */
  frameSamples: number;
}

/** Decoded Vorbis comment block. */
export interface FlacVorbisComment {
  /** Encoder vendor string. */
  vendor: string;
  /** User comment key/value pairs (keys are uppercase by convention). */
  comments: Array<{ key: string; value: string }>;
}

/** Decoded PICTURE block (Trap #4 — variable-length fields). */
export interface FlacPicture {
  /** APIC-style picture type (3 = cover art). */
  pictureType: number;
  /** MIME type string (e.g. "image/jpeg"). */
  mime: string;
  /** UTF-8 description. */
  description: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Colour depth in bits per pixel. */
  colorDepth: number;
  /** For indexed images, number of colours; 0 otherwise. */
  colorCount: number;
  /** Raw picture data bytes. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Block header (4 bytes)
// ---------------------------------------------------------------------------

export interface MetaBlockHeader {
  lastBlock: boolean;
  type: number;
  /** Length of body in bytes (NOT including the 4-byte header). */
  length: number;
}

/**
 * Parse a 4-byte metadata block header.
 *
 * @param bytes - Full file buffer.
 * @param offset - Byte offset of the header start.
 */
export function parseBlockHeader(bytes: Uint8Array, offset: number): MetaBlockHeader {
  if (offset + 4 > bytes.length) {
    throw new FlacInvalidMetadataError('Truncated metadata block header', offset);
  }
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;

  const lastBlock = (b0 & 0x80) !== 0;
  const type = b0 & 0x7f;
  const length = (b1 << 16) | (b2 << 8) | b3;

  return { lastBlock, type, length };
}

/**
 * Encode a metadata block header.
 *
 * @param lastBlock - Whether this is the last metadata block.
 * @param type - Block type (0..127).
 * @param bodyLength - Length of the body in bytes.
 * @returns 4-byte header.
 */
export function encodeBlockHeader(
  lastBlock: boolean,
  type: number,
  bodyLength: number,
): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = ((lastBlock ? 1 : 0) << 7) | (type & 0x7f);
  out[1] = (bodyLength >> 16) & 0xff;
  out[2] = (bodyLength >> 8) & 0xff;
  out[3] = bodyLength & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// SEEKTABLE decoder
// ---------------------------------------------------------------------------

/** A SEEKTABLE seek-point is 18 bytes. */
const SEEK_POINT_SIZE = 18;

/**
 * Decode a SEEKTABLE block body into an array of seek points.
 *
 * @param body - Raw block body bytes.
 * @param offset - File offset for error reporting.
 */
export function decodeSeekTable(body: Uint8Array, offset: number): FlacSeekPoint[] {
  if (body.length % SEEK_POINT_SIZE !== 0) {
    throw new FlacInvalidMetadataError(
      `SEEKTABLE body length ${body.length} is not a multiple of ${SEEK_POINT_SIZE}`,
      offset,
    );
  }

  const count = body.length / SEEK_POINT_SIZE;

  // H-2: Cap to prevent allocating millions of seek-point objects from a crafted block.
  if (count > MAX_SEEKPOINTS) {
    throw new FlacInvalidMetadataError(
      `SEEKTABLE claims ${count} points, max is ${MAX_SEEKPOINTS}`,
      offset,
    );
  }

  const points: FlacSeekPoint[] = [];

  for (let i = 0; i < count; i++) {
    const base = i * SEEK_POINT_SIZE;
    // sample_number: 8 bytes big-endian (may exceed 32-bit safe range)
    const sn = readUint64BE(body, base, offset);
    // stream_offset: 8 bytes big-endian
    const bo = readUint64BE(body, base + 8, offset);
    const fs = ((body[base + 16] ?? 0) << 8) | (body[base + 17] ?? 0);
    points.push({ sampleNumber: sn, byteOffset: bo, frameSamples: fs });
  }

  return points;
}

// ---------------------------------------------------------------------------
// VORBIS_COMMENT decoder
// ---------------------------------------------------------------------------

/**
 * Decode a VORBIS_COMMENT block body.
 *
 * Format (little-endian length-prefixed UTF-8 strings):
 *   4 bytes vendor_length
 *   vendor_length bytes vendor_string
 *   4 bytes user_comment_list_length
 *   for each comment:
 *     4 bytes length
 *     length bytes "KEY=value" string
 *
 * Refs: https://xiph.org/vorbis/doc/v-comment.html
 */
export function decodeVorbisComment(body: Uint8Array, offset: number): FlacVorbisComment {
  let pos = 0;

  const vendorLen = readUint32LE(body, pos, offset);
  pos += 4;

  if (pos + vendorLen > body.length) {
    throw new FlacInvalidMetadataError('VORBIS_COMMENT vendor string truncated', offset);
  }
  const vendor = UTF8_DECODER.decode(body.subarray(pos, pos + vendorLen));
  pos += vendorLen;

  const commentCount = readUint32LE(body, pos, offset);
  pos += 4;

  // H-3: Cap comment count to prevent degenerate allocation from crafted blocks.
  if (commentCount > MAX_COMMENTS) {
    throw new FlacInvalidMetadataError(
      `VORBIS_COMMENT claims ${commentCount} comments, max is ${MAX_COMMENTS}`,
      offset,
    );
  }

  const comments: Array<{ key: string; value: string }> = [];

  for (let i = 0; i < commentCount; i++) {
    if (pos + 4 > body.length) {
      throw new FlacInvalidMetadataError(`VORBIS_COMMENT comment ${i} truncated`, offset);
    }
    const len = readUint32LE(body, pos, offset);
    pos += 4;

    // H-3: Cap individual comment length.
    if (len > MAX_COMMENT_LENGTH) {
      throw new FlacInvalidMetadataError(
        `VORBIS_COMMENT comment ${i} claims ${len} bytes, max is ${MAX_COMMENT_LENGTH}`,
        offset,
      );
    }

    if (pos + len > body.length) {
      throw new FlacInvalidMetadataError(`VORBIS_COMMENT comment ${i} body truncated`, offset);
    }

    const raw = UTF8_DECODER.decode(body.subarray(pos, pos + len));
    pos += len;

    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) {
      // Malformed comment — skip without throwing (tolerant parsing)
      continue;
    }
    comments.push({ key: raw.slice(0, eqIdx).toUpperCase(), value: raw.slice(eqIdx + 1) });
  }

  return { vendor, comments };
}

// ---------------------------------------------------------------------------
// PICTURE decoder (Trap #4 — variable-length fields)
// ---------------------------------------------------------------------------

/**
 * Decode a PICTURE block body.
 *
 * Format:
 *   4 bytes picture_type
 *   4 bytes mime_type_length
 *   mime_type_length bytes mime_type (ASCII)
 *   4 bytes description_length
 *   description_length bytes description (UTF-8)
 *   4 bytes width
 *   4 bytes height
 *   4 bytes color_depth
 *   4 bytes color_count (0 for non-indexed)
 *   4 bytes data_length
 *   data_length bytes picture_data
 */
export function decodePicture(body: Uint8Array, offset: number): FlacPicture {
  let pos = 0;

  const pictureType = readUint32BE(body, pos, offset);
  pos += 4;

  const mimeLen = readUint32BE(body, pos, offset);
  pos += 4;
  if (pos + mimeLen > body.length) {
    throw new FlacInvalidMetadataError('PICTURE MIME type truncated', offset);
  }
  const mime = UTF8_DECODER.decode(body.subarray(pos, pos + mimeLen));
  pos += mimeLen;

  const descLen = readUint32BE(body, pos, offset);
  pos += 4;
  if (pos + descLen > body.length) {
    throw new FlacInvalidMetadataError('PICTURE description truncated', offset);
  }
  const description = UTF8_DECODER.decode(body.subarray(pos, pos + descLen));
  pos += descLen;

  const width = readUint32BE(body, pos, offset);
  pos += 4;
  const height = readUint32BE(body, pos, offset);
  pos += 4;
  const colorDepth = readUint32BE(body, pos, offset);
  pos += 4;
  const colorCount = readUint32BE(body, pos, offset);
  pos += 4;

  const dataLen = readUint32BE(body, pos, offset);
  pos += 4;
  if (pos + dataLen > body.length) {
    throw new FlacInvalidMetadataError('PICTURE data truncated', offset);
  }
  const data = body.slice(pos, pos + dataLen);

  return { pictureType, mime, description, width, height, colorDepth, colorCount, data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readUint32LE(data: Uint8Array, pos: number, fileOffset: number): number {
  if (pos + 4 > data.length) {
    throw new FlacInvalidMetadataError('Unexpected end of block data', fileOffset);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getUint32(pos, true);
}

function readUint32BE(data: Uint8Array, pos: number, fileOffset: number): number {
  if (pos + 4 > data.length) {
    throw new FlacInvalidMetadataError('Unexpected end of block data', fileOffset);
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getUint32(pos, false);
}

/**
 * Read a 64-bit big-endian unsigned integer as a JS number.
 * Values above 2^53 lose precision (not expected for FLAC sample counts < 2^36).
 *
 * M-4: Defensive bounds check to catch truncated seek-table bodies.
 */
function readUint64BE(data: Uint8Array, pos: number, fileOffset: number): number {
  if (pos + 8 > data.length) {
    throw new FlacInvalidMetadataError(
      `Unexpected end of data reading uint64 at pos ${pos}`,
      fileOffset,
    );
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hi = dv.getUint32(pos, false);
  const lo = dv.getUint32(pos + 4, false);
  return hi * 0x1_0000_0000 + lo;
}
