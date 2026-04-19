/**
 * Ogg CRC-32 implementation.
 *
 * Ogg uses the non-reflected CRC-32 polynomial 0x04C11DB7, init 0.
 * This is DISTINCT from the zlib/PNG/GZIP CRC-32 (reflected, poly 0xEDB88320).
 * Using a generic CRC-32 library will produce wrong checksums 100% of the time.
 *
 * Reference: RFC 3533 §6 and the Ogg Vorbis I spec appendix.
 *
 * Algorithm:
 *   table[i] = (i << 24) processed through 8 iterations of:
 *     if (high bit set): r = (r << 1) ^ poly
 *     else:              r = r << 1
 *   Operate on 32-bit values with masking to emulate uint32 arithmetic.
 */

// ---------------------------------------------------------------------------
// CRC-32 lookup table (non-reflected, poly 0x04C11DB7)
// ---------------------------------------------------------------------------

const POLY = 0x04c11db7;
const TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = r & 0x80000000 ? (r << 1) ^ POLY : r << 1;
    r = r >>> 0; // keep uint32
  }
  TABLE[i] = r >>> 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the Ogg CRC-32 over a byte array.
 *
 * The checksum field at bytes [22..25] MUST be zeroed before calling this
 * function during verification. On write, build the page with checksum=0,
 * then call computeCrc32 and patch the result in.
 *
 * @returns CRC-32 value as a non-negative 32-bit integer.
 */
export function computeCrc32(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc = ((crc << 8) ^ (TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}
