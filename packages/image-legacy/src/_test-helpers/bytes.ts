/**
 * Byte-array helpers for @catlabtech/webcvt-image-legacy tests.
 *
 * All helpers construct Uint8Arrays inline without committed binary fixtures.
 *
 * NOT exported from the package index — test use only.
 */

const ENCODER = new TextEncoder();

/** Encode an ASCII string to bytes. */
export function ascii(s: string): Uint8Array {
  return ENCODER.encode(s);
}

/** Concatenate multiple Uint8Arrays into one. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Encode a 32-bit unsigned integer big-endian. */
export function u32be(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, n, false);
  return buf;
}

/** Encode a 32-bit IEEE-754 float big-endian. */
export function f32be(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  const dv = new DataView(buf.buffer);
  dv.setFloat32(0, n, false);
  return buf;
}

/** Encode a 32-bit IEEE-754 float little-endian. */
export function f32le(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  const dv = new DataView(buf.buffer);
  dv.setFloat32(0, n, true);
  return buf;
}

/** Encode a 16-bit unsigned integer big-endian. */
export function u16be(n: number): Uint8Array {
  const buf = new Uint8Array(2);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, n, false);
  return buf;
}
