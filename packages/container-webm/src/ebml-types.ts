/**
 * EBML typed value readers and writers.
 *
 * Handles all EBML scalar types:
 *   uint    — unsigned integer, 1-8 bytes big-endian
 *   int     — signed integer, 1-8 bytes big-endian
 *   float   — IEEE 754, 4 or 8 bytes big-endian
 *   string  — ASCII bytes (UTF-8 subset for CodecID etc.)
 *   utf8    — UTF-8 string (DocType, MuxingApp, WritingApp)
 *   binary  — raw Uint8Array
 *   date    — int64 nanoseconds since 2001-01-01 00:00:00 UTC
 *
 * All readers accept a subarray of the payload bytes (not offset+length pairs)
 * to keep the call sites clean.
 */

// Module-scope TextDecoder instance (hoisted per Lesson #2 — do not instantiate per-call).
const UTF8_DECODER = new TextDecoder('utf-8');
const ASCII_DECODER = new TextDecoder('ascii');

// ---------------------------------------------------------------------------
// Uint readers
// ---------------------------------------------------------------------------

/**
 * Read an unsigned integer from EBML payload bytes (big-endian, 1-8 bytes).
 * Returns a bigint to handle the full 64-bit range.
 */
export function readUint(payload: Uint8Array): bigint {
  let value = 0n;
  for (const byte of payload) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Read an unsigned integer as a plain JS number (safe up to 2^53-1).
 * Use this when you know the value fits in a safe integer (e.g. TimecodeScale,
 * pixel dimensions, channel counts).
 */
export function readUintNumber(payload: Uint8Array): number {
  // Use bigint for assembly then downcast.
  return Number(readUint(payload));
}

// ---------------------------------------------------------------------------
// Int readers
// ---------------------------------------------------------------------------

/**
 * Read a signed integer from EBML payload bytes (big-endian, 1-8 bytes).
 * Returns bigint for full 64-bit range.
 */
export function readInt(payload: Uint8Array): bigint {
  if (payload.length === 0) return 0n;
  const unsigned = readUint(payload);
  const bits = BigInt(payload.length * 8);
  const signBit = 1n << (bits - 1n);
  if (unsigned >= signBit) {
    return unsigned - (1n << bits);
  }
  return unsigned;
}

// ---------------------------------------------------------------------------
// Float readers
// ---------------------------------------------------------------------------

/**
 * Read an IEEE 754 float from EBML payload bytes (4 or 8 bytes, big-endian).
 * Returns NaN for empty payload.
 */
export function readFloat(payload: Uint8Array): number {
  if (payload.length === 4) {
    const view = new DataView(payload.buffer, payload.byteOffset, 4);
    return view.getFloat32(0, false);
  }
  if (payload.length === 8) {
    const view = new DataView(payload.buffer, payload.byteOffset, 8);
    return view.getFloat64(0, false);
  }
  return Number.NaN;
}

// ---------------------------------------------------------------------------
// String readers
// ---------------------------------------------------------------------------

/**
 * Read an ASCII string from EBML payload bytes (CodecID, DocType, etc.).
 * Strips trailing null bytes per EBML spec.
 */
export function readString(payload: Uint8Array): string {
  // Find null terminator if present.
  let len = payload.length;
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === 0) {
      len = i;
      break;
    }
  }
  return ASCII_DECODER.decode(payload.subarray(0, len));
}

/**
 * Read a UTF-8 string from EBML payload bytes (MuxingApp, WritingApp, etc.).
 * Strips trailing null bytes per EBML spec.
 */
export function readUtf8(payload: Uint8Array): string {
  let len = payload.length;
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === 0) {
      len = i;
      break;
    }
  }
  return UTF8_DECODER.decode(payload.subarray(0, len));
}

// ---------------------------------------------------------------------------
// Binary reader
// ---------------------------------------------------------------------------

/**
 * Return a zero-copy view of EBML binary payload.
 * Use subarray (not slice) per Lesson #3 — zero-copy for stored views.
 * Only slice at the API boundary when handing immutable bytes to user code.
 */
export function readBinary(payload: Uint8Array): Uint8Array {
  return payload.subarray(0, payload.length);
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

const UTF8_ENCODER = new TextEncoder();

/**
 * Encode an unsigned integer to big-endian bytes, minimum width.
 */
export function writeUint(value: bigint, width?: number): Uint8Array {
  if (value === 0n && !width) return new Uint8Array([0]);

  // Compute minimum byte width.
  let minWidth = 1;
  let temp = value;
  while (temp > 0xffn) {
    temp >>= 8n;
    minWidth++;
  }

  const actualWidth = width !== undefined ? Math.max(width, minWidth) : minWidth;
  const out = new Uint8Array(actualWidth);
  let remaining = value;
  for (let i = actualWidth - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/**
 * Encode a float64 to 8-byte big-endian IEEE 754.
 */
export function writeFloat64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setFloat64(0, value, false);
  return out;
}

/**
 * Encode a float32 to 4-byte big-endian IEEE 754.
 */
export function writeFloat32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  const view = new DataView(out.buffer);
  view.setFloat32(0, value, false);
  return out;
}

/**
 * Encode an ASCII string to bytes (null-terminated optional).
 */
export function writeString(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Encode a UTF-8 string to bytes.
 */
export function writeUtf8(value: string): Uint8Array {
  return UTF8_ENCODER.encode(value);
}

// ---------------------------------------------------------------------------
// EBML element builder
// ---------------------------------------------------------------------------

/**
 * Concatenate multiple Uint8Arrays into one. Internal helper for serializers.
 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
