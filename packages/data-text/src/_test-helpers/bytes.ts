/**
 * Byte-array helpers for @catlabtech/webcvt-data-text tests.
 *
 * All helpers construct Uint8Arrays inline without committed binary fixtures,
 * following the same pattern as @catlabtech/webcvt-archive-zip's _test-helpers.
 *
 * NOT exported from the package index — test use only.
 */

const ENCODER = new TextEncoder();

/** UTF-8 BOM as a Uint8Array (3 bytes: EF BB BF). */
export function bom(): Uint8Array {
  return new Uint8Array([0xef, 0xbb, 0xbf]);
}

/** Encode a string to UTF-8 bytes. */
export function utf8(s: string): Uint8Array {
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

/**
 * A minimal 2-byte invalid UTF-8 sequence: 0xC3 0x28.
 * 0xC3 is the start of a 2-byte sequence but 0x28 ('(') is not a valid
 * continuation byte (must be 0x80–0xBF).
 */
export function invalidUtf8(): Uint8Array {
  return new Uint8Array([0xc3, 0x28]);
}
