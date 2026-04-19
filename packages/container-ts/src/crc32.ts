/**
 * MPEG-TS PSI CRC-32 implementation.
 *
 * Uses polynomial 0x04C11DB7, init 0xFFFFFFFF, non-reflected input and output.
 * This is the "MPEG-2 CRC-32" — same polynomial as Ogg but DIFFERENT init value.
 * Ogg uses init 0x00000000; MPEG-TS PSI uses init 0xFFFFFFFF (Trap §8).
 *
 * Reference: ISO/IEC 13818-1 Annex B.
 */

// ---------------------------------------------------------------------------
// CRC-32 lookup table (non-reflected, poly 0x04C11DB7, init 0xFFFFFFFF)
// ---------------------------------------------------------------------------

const POLY = 0x04c11db7;
const TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = (r & 0x80000000) !== 0 ? (r << 1) ^ POLY : r << 1;
    r = r >>> 0; // keep uint32
  }
  TABLE[i] = r >>> 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the MPEG-TS PSI CRC-32 over a byte array.
 *
 * Init value is 0xFFFFFFFF (MPEG-2 standard). This differs from Ogg CRC-32
 * which uses init 0x00000000 with the same polynomial.
 *
 * @returns CRC-32 value as a non-negative 32-bit integer.
 */
export function computePsiCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc = ((crc << 8) ^ (TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}
