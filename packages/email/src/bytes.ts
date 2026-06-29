/**
 * Byte-level helpers for @catlabtech/webcvt-email.
 *
 * EML is a byte format: MIME structure (boundaries, blank-line separators) is
 * pure ASCII, while bodies may be 8-bit/binary. We therefore parse on a
 * Uint8Array and decode regions to text only where appropriate. All scanning
 * here is hand-written and linear (no backtracking regex on untrusted input).
 */

/** ASCII line feed (\n). */
export const LF = 0x0a;
/** ASCII carriage return (\r). */
export const CR = 0x0d;
/** ASCII space. */
export const SP = 0x20;
/** ASCII horizontal tab. */
export const HT = 0x09;

const ENCODER = new TextEncoder();

/**
 * Normalise the public input (string | Uint8Array) to bytes.
 * Strings are UTF-8 encoded; this is exact for the ASCII structural bytes that
 * drive parsing and faithful for UTF-8 header/body text.
 */
export function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? ENCODER.encode(input) : input;
}

/**
 * Decode bytes as Latin-1 (ISO-8859-1) with an exact 1:1 byte→code-unit
 * mapping. Unlike `TextDecoder('latin1')` (which is an alias for windows-1252
 * in the Encoding standard), this preserves every byte value so that string
 * length equals byte count and ASCII scanning is exact.
 */
export function latin1Decode(bytes: Uint8Array): string {
  let result = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    result += String.fromCharCode(...bytes.subarray(i, end));
  }
  return result;
}

/** Encode an ASCII/Latin-1 string to bytes (each code unit masked to 8 bits). */
export function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Index of the next LF at or after `from`, or -1 if none. */
export function indexOfLF(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === LF) return i;
  }
  return -1;
}

/** Result of splitting an entity into its header section and body. */
export interface HeaderBodySplit {
  /** Bytes of the header section (excludes the separating blank line). */
  header: Uint8Array;
  /** Bytes of the body (everything after the blank line). */
  body: Uint8Array;
}

/**
 * Split entity bytes into header and body at the first blank line.
 *
 * CRLF and bare-LF tolerant. If the entity begins with a blank line the header
 * section is empty. If no blank line exists the whole input is treated as the
 * header section with an empty body.
 */
export function splitHeaderBody(bytes: Uint8Array): HeaderBodySplit {
  // Leading blank line → empty header section.
  if (bytes[0] === LF) {
    return { header: new Uint8Array(0), body: bytes.subarray(1) };
  }
  if (bytes[0] === CR && bytes[1] === LF) {
    return { header: new Uint8Array(0), body: bytes.subarray(2) };
  }

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== LF) continue;
    const next = bytes[i + 1];
    if (next === LF) {
      return { header: bytes.subarray(0, i), body: bytes.subarray(i + 2) };
    }
    if (next === CR && bytes[i + 2] === LF) {
      return { header: bytes.subarray(0, i), body: bytes.subarray(i + 3) };
    }
  }

  return { header: bytes, body: new Uint8Array(0) };
}
