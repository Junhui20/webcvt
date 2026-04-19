/**
 * EBML variable-length integer (VINT) codec.
 *
 * Two distinct entry points per design note Trap §1/§3:
 *   - readVintId(bytes, offset) — ID encoding: keeps the length-marker bit.
 *   - readVintSize(bytes, offset) — size encoding: strips the length-marker bit.
 *
 * They intentionally have the same function signature but different semantics.
 * Do NOT unify them with a flag parameter — that is the bug source the design
 * note warns about explicitly.
 *
 * Per RFC 8794: VINT is 1-8 bytes. The position of the first set bit in the
 * first byte determines the width. Width > 8 (all-zeros first byte) is invalid.
 */

import { MAX_VINT_WIDTH } from './constants.ts';
import { WebmVintError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EbmlVint {
  /** Numeric value. For IDs: marker bit retained. For sizes: marker bit stripped. */
  value: number;
  /** Wire width in bytes, 1..8. */
  width: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

export interface EbmlVintBig {
  /** Numeric value as bigint (for sizes that may exceed 2^32). */
  value: bigint;
  /** Wire width in bytes, 1..8. */
  width: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

// ---------------------------------------------------------------------------
// Internal helper: determine VINT width from first byte
// ---------------------------------------------------------------------------

function vintWidth(firstByte: number, offset: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  if (firstByte === 0) {
    throw new WebmVintError(offset, 'first byte is 0x00 (invalid VINT — exceeds 8-byte max width)');
  }
  // Find highest set bit position (0-indexed from right).
  // Leading zeros count tells us the width.
  if (firstByte & 0x80) return 1;
  if (firstByte & 0x40) return 2;
  if (firstByte & 0x20) return 3;
  if (firstByte & 0x10) return 4;
  if (firstByte & 0x08) return 5;
  if (firstByte & 0x04) return 6;
  if (firstByte & 0x02) return 7;
  return 8; // firstByte & 0x01
}

// ---------------------------------------------------------------------------
// readVintId — ID encoding (marker bit RETAINED in value)
// ---------------------------------------------------------------------------

/**
 * Read an EBML element ID from `bytes` at `offset`.
 *
 * The length-marker bit IS retained in the parsed value per the spec:
 * e.g. 0x1A 0x45 0xDF 0xA3 → ID = 0x1A45DFA3.
 *
 * @throws WebmVintError if the encoding is invalid.
 */
export function readVintId(bytes: Uint8Array, offset: number): EbmlVint {
  if (offset >= bytes.length) {
    throw new WebmVintError(offset, 'offset past end of buffer');
  }
  const first = bytes[offset] as number;
  const width = vintWidth(first, offset);

  if (offset + width > bytes.length) {
    throw new WebmVintError(offset, `VINT width ${width} exceeds buffer length`);
  }

  // Assemble the numeric value — marker bit IS kept for IDs.
  // Limit to 4 bytes for element IDs per RFC 8794 (EBMLMaxIDLength default 4).
  if (width > 4) {
    throw new WebmVintError(offset, `ID VINT width ${width} exceeds maximum ID width of 4`);
  }

  let value = 0;
  for (let i = 0; i < width; i++) {
    value = (value << 8) | (bytes[offset + i] as number);
  }
  // value is a 32-bit integer; use unsigned right-shift to keep it positive.
  value = value >>> 0;

  return { value, width: width as EbmlVint['width'] };
}

// ---------------------------------------------------------------------------
// readVintSize — size encoding (marker bit STRIPPED from value)
// ---------------------------------------------------------------------------

/**
 * Read an EBML element size VINT from `bytes` at `offset`.
 *
 * The length-marker bit IS stripped from the parsed value:
 * e.g. 0x82 → size = 2 (not 0x82 = 130).
 *
 * Returns a bigint value because EBML sizes can reach 2^56-1 bytes.
 * The all-ones-payload pattern means "unknown size" — indicated by returning -1n.
 *
 * @throws WebmVintError if the encoding is invalid.
 */
export function readVintSize(bytes: Uint8Array, offset: number): EbmlVintBig {
  if (offset >= bytes.length) {
    throw new WebmVintError(offset, 'offset past end of buffer');
  }
  const first = bytes[offset] as number;
  const width = vintWidth(first, offset);

  if (offset + width > bytes.length) {
    throw new WebmVintError(offset, `size VINT width ${width} exceeds buffer length`);
  }

  // Marker bit mask for stripping: the first set bit in the first byte.
  const markerMask = 0x80 >> (width - 1);

  // Build bigint value and strip marker bit.
  let value = BigInt(first & ~markerMask);
  for (let i = 1; i < width; i++) {
    value = (value << 8n) | BigInt(bytes[offset + i] as number);
  }

  // Check for unknown-size (all-ones payload: after stripping marker, remaining bits all 1).
  // Unknown-size is represented as -1n per the interface contract.
  const maxSigned = (1n << BigInt(7 * width)) - 1n;
  if (value === maxSigned) {
    return { value: -1n, width: width as EbmlVintBig['width'] };
  }

  return { value, width: width as EbmlVintBig['width'] };
}

// ---------------------------------------------------------------------------
// writeVintId — encode an element ID as VINT bytes
// ---------------------------------------------------------------------------

/**
 * Encode an element ID to its VINT wire representation.
 * The ID value already contains the length-marker bit (retained from parse).
 */
export function writeVintId(id: number): Uint8Array {
  // Determine width from the position of the highest set bit in the ID.
  // ID MSB pattern: 1xxx = 1 byte, 01xx = 2 bytes, 001x = 3 bytes, 0001 = 4 bytes.
  if (id >= 0x10000000 && id <= 0x1fffffff) {
    // 4-byte ID: 0x10000000 .. 0x1fffffff
    const out = new Uint8Array(4);
    out[0] = (id >>> 24) & 0xff;
    out[1] = (id >>> 16) & 0xff;
    out[2] = (id >>> 8) & 0xff;
    out[3] = id & 0xff;
    return out;
  }
  if (id >= 0x200000 && id <= 0x3fffff) {
    // 3-byte ID
    const out = new Uint8Array(3);
    out[0] = (id >>> 16) & 0xff;
    out[1] = (id >>> 8) & 0xff;
    out[2] = id & 0xff;
    return out;
  }
  if (id >= 0x4000 && id <= 0x7fff) {
    // 2-byte ID
    const out = new Uint8Array(2);
    out[0] = (id >>> 8) & 0xff;
    out[1] = id & 0xff;
    return out;
  }
  if (id >= 0x80 && id <= 0xfe) {
    // 1-byte ID
    return new Uint8Array([id]);
  }
  throw new WebmVintError(0, `Cannot encode ID 0x${id.toString(16)} as VINT`);
}

// ---------------------------------------------------------------------------
// writeVintSize — encode a size value as VINT bytes (marker bit added)
// ---------------------------------------------------------------------------

/**
 * Encode a size value to its VINT wire representation.
 *
 * @param size  The numeric size (must be >= 0).
 * @param width Optional forced wire width (1..8). If omitted, uses minimum width.
 */
export function writeVintSize(size: bigint, width?: number): Uint8Array {
  // Determine minimum required width.
  let minWidth = 1;
  if (size >= 1n << 49n) minWidth = 8;
  else if (size >= 1n << 42n) minWidth = 7;
  else if (size >= 1n << 35n) minWidth = 6;
  else if (size >= 1n << 28n) minWidth = 5;
  else if (size >= 1n << 21n) minWidth = 4;
  else if (size >= 1n << 14n) minWidth = 3;
  // Max 1-byte value is 126 (0x7E); 127 produces 0xFF which is the unknown-size pattern.
  // Max 2-byte value is 16382 (0x3FFE); 16383 would be unknown-size for 2-byte.
  else if (size >= 127n) minWidth = 2;

  const actualWidth = width !== undefined ? Math.max(width, minWidth) : minWidth;

  if (actualWidth > MAX_VINT_WIDTH) {
    throw new WebmVintError(0, `Size ${size} requires VINT width > 8 bytes`);
  }

  // The marker bit position for this width: bit (8 - width) of the first byte.
  const markerBit = 0x80 >> (actualWidth - 1);

  const out = new Uint8Array(actualWidth);
  let remaining = size;
  for (let i = actualWidth - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  // Add marker bit to first byte.
  out[0] = (out[0] as number) | markerBit;
  return out;
}
