/**
 * CRC utilities for FLAC.
 *
 * CRC-8:  polynomial 0x07, init 0, no output reflection.
 *         Input bytes are NOT reflected (reflected-input means each input byte
 *         is bit-reversed before feeding; FLAC CRC-8 is NOT reflected-input
 *         despite what some sources say — it is a standard non-reflected CRC).
 *         Trap #8: precompute table at module load.
 *
 * CRC-16: polynomial 0x8005 (CRC-16-IBM), init 0, no reflection.
 *         Covers the ENTIRE frame from sync through CRC-8 inclusive
 *         (Trap #2 — the CRC-16 covers the CRC-8 byte).
 *
 * Refs: §9.1.1 and §9.2.2 of the FLAC format spec.
 */

// ---------------------------------------------------------------------------
// CRC-8 table (poly 0x07, MSB-first, non-reflected)
// ---------------------------------------------------------------------------

const CRC8_TABLE: Uint8Array = buildCrc8Table();

function buildCrc8Table(): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    table[i] = crc;
  }
  return table;
}

/**
 * Update a running CRC-8 value with one byte.
 *
 * @param crc - Current CRC value (0 to start).
 * @param byte - Next input byte.
 * @returns Updated CRC-8 value.
 */
export function crc8Update(crc: number, byte: number): number {
  // Index is masked to 0-255, so the lookup always succeeds.
  return CRC8_TABLE[(crc ^ byte) & 0xff] as number;
}

/**
 * Compute CRC-8 over a byte slice.
 *
 * @param data - Input bytes.
 * @param start - Inclusive start index.
 * @param end - Exclusive end index.
 * @returns 8-bit CRC.
 */
export function crc8(data: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    // Bounded loop — data[i] is always defined.
    crc = crc8Update(crc, data[i] as number);
  }
  return crc;
}

// ---------------------------------------------------------------------------
// CRC-16 table (poly 0x8005, MSB-first, non-reflected)
// ---------------------------------------------------------------------------

const CRC16_TABLE: Uint16Array = buildCrc16Table();

function buildCrc16Table(): Uint16Array {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
    table[i] = crc;
  }
  return table;
}

/**
 * Update a running CRC-16 value with one byte.
 *
 * @param crc - Current CRC value (0 to start).
 * @param byte - Next input byte.
 * @returns Updated CRC-16 value.
 */
export function crc16Update(crc: number, byte: number): number {
  // Index is masked to 0-255, so the lookup always succeeds.
  return (((crc << 8) & 0xffff) ^ (CRC16_TABLE[((crc >> 8) ^ byte) & 0xff] as number)) & 0xffff;
}

/**
 * Compute CRC-16 over a byte slice.
 *
 * @param data - Input bytes.
 * @param start - Inclusive start index.
 * @param end - Exclusive end index.
 * @returns 16-bit CRC.
 */
export function crc16(data: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    // Bounded loop — data[i] is always defined.
    crc = crc16Update(crc, data[i] as number);
  }
  return crc;
}
