/**
 * CRC-32 implementation — zlib variant.
 *
 * This is the THIRD CRC-32 variant in the webcvt codebase:
 *   1. container-ts/src/crc32.ts  — MPEG-TS PSI CRC-32
 *                                    poly 0x04C11DB7, NON-reflected, init 0xFFFFFFFF
 *   2. container-ogg/src/crc32.ts — Ogg CRC-32
 *                                    poly 0x04C11DB7, NON-reflected, init 0x00000000
 *   3. THIS FILE                  — zlib / ZIP / gzip CRC-32
 *                                    poly 0xEDB88320, REFLECTED, init 0xFFFFFFFF,
 *                                    output XOR 0xFFFFFFFF
 *
 * References:
 *   - PKWARE APPNOTE.TXT §4.4.7 (ZIP CRC-32 field)
 *   - RFC 1952 §8 (GZip CRC-32 definition, same zlib variant)
 *   - ISO 3309 / ITU-T V.42 (reflected CRC-32 polynomial basis)
 *
 * DO NOT import this from container-ts or container-ogg — they use different
 * CRC-32 variants. This implementation is deliberately standalone.
 */

// ---------------------------------------------------------------------------
// CRC-32 lookup table (reflected, poly 0xEDB88320)
// ---------------------------------------------------------------------------

const POLY = 0xedb88320;
const TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i++) {
  let r = i;
  for (let j = 0; j < 8; j++) {
    r = (r & 1) !== 0 ? (r >>> 1) ^ POLY : r >>> 1;
  }
  TABLE[i] = r >>> 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the zlib CRC-32 (reflected, poly 0xEDB88320, init 0xFFFFFFFF, XOR out 0xFFFFFFFF).
 *
 * This is the CRC-32 used by ZIP entries, gzip trailers, and zlib streams.
 * It is DIFFERENT from the MPEG-TS PSI CRC-32 and the Ogg CRC-32.
 *
 * @param data  Byte array to checksum.
 * @param seed  Optional initial CRC value (default 0xFFFFFFFF). Pass the result of
 *              a previous call to chain incremental updates.
 * @returns     Final CRC-32 value as a non-negative 32-bit integer.
 */
export function computeCrc32(data: Uint8Array, seed = 0xffffffff): number {
  let crc = seed;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc = (TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
