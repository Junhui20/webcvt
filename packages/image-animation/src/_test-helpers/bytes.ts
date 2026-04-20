/**
 * Byte-building utilities for synthetic test fixtures.
 *
 * No production code should import this module.
 */

/** Convert an ASCII string to Uint8Array (code-points 0–127 only). */
export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Concatenate multiple Uint8Array slices into a single Uint8Array. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

/** Encode a uint8 as a single-byte Uint8Array. */
export function u8(v: number): Uint8Array {
  return new Uint8Array([v & 0xff]);
}

/** Encode a uint16 little-endian as a 2-byte Uint8Array. */
export function u16le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}

/** Encode a uint24 little-endian as a 3-byte Uint8Array. */
export function u24le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);
}

/** Encode a uint32 little-endian as a 4-byte Uint8Array. */
export function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = v & 0xff;
  b[1] = (v >> 8) & 0xff;
  b[2] = (v >> 16) & 0xff;
  b[3] = (v >> 24) & 0xff;
  return b;
}

/** Encode a uint32 big-endian as a 4-byte Uint8Array. */
export function u32be(v: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (v >> 24) & 0xff;
  b[1] = (v >> 16) & 0xff;
  b[2] = (v >> 8) & 0xff;
  b[3] = v & 0xff;
  return b;
}
