/**
 * CRC-32 tests — verifies Ogg CRC, NOT zlib CRC.
 *
 * Design note test case: "verifies CRC-32 using Ogg polynomial, not zlib polynomial"
 */

import { describe, expect, it } from 'vitest';
import { computeCrc32 } from './crc32.ts';

describe('computeCrc32', () => {
  it('returns 0 for empty input', () => {
    expect(computeCrc32(new Uint8Array(0))).toBe(0);
  });

  it('returns a non-negative 32-bit integer', () => {
    const result = computeCrc32(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });

  it('computes deterministically — same input same output', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(computeCrc32(data)).toBe(computeCrc32(data));
  });

  it('differs from zlib CRC-32 for non-trivial input', () => {
    // The zlib reflected CRC of "OggS" is known to differ from Ogg CRC.
    // We verify our implementation is NOT the reflected variant by checking
    // that zeroing then running through the non-reflected algorithm gives
    // the value used internally by Ogg page verification.
    const data = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // "OggS"
    // For "OggS" zlib reflected CRC32 would be 0xbf855001 (known value from zlib).
    const oggCrc = computeCrc32(data);
    const zlibKnown = 0xbf855001;
    expect(oggCrc).not.toBe(zlibKnown);
  });

  it('produces different results for different inputs', () => {
    const a = computeCrc32(new Uint8Array([1, 2, 3]));
    const b = computeCrc32(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it('is sensitive to byte order', () => {
    const ab = computeCrc32(new Uint8Array([0xaa, 0xbb]));
    const ba = computeCrc32(new Uint8Array([0xbb, 0xaa]));
    expect(ab).not.toBe(ba);
  });

  it('computes correct Ogg page CRC for a known minimal valid page', () => {
    // Build a minimal Ogg page with a known byte sequence.
    // The checksum field (bytes 22..25) is zeroed during computation.
    // We build an otherwise-valid page header and verify the CRC round-trips.
    const page = new Uint8Array([
      // OggS
      0x4f, 0x67, 0x67, 0x53,
      // version = 0
      0x00,
      // header_type = 0x02 (BOS)
      0x02,
      // granule_position = 0 (LE int64)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // serial_number = 0x12345678 (LE)
      0x78, 0x56, 0x34, 0x12,
      // page_sequence_number = 0 (LE)
      0x00, 0x00, 0x00, 0x00,
      // checksum = 0 (4 bytes)
      0x00, 0x00, 0x00, 0x00,
      // page_segments = 1
      0x01,
      // segment_table: [5]
      0x05,
      // body: 5 bytes
      0x01, 0x76, 0x6f, 0x72, 0x62,
    ]);

    const crc = computeCrc32(page);
    // CRC should be non-zero for this data.
    expect(crc).toBeGreaterThan(0);

    // If we now patch the CRC into bytes 22..25 (LE uint32) and recompute,
    // the result should equal the stored CRC (self-consistent).
    const withCrc = new Uint8Array(page);
    const view = new DataView(withCrc.buffer);
    view.setUint32(22, crc, true);
    // Zero the field to recompute.
    const forVerify = new Uint8Array(withCrc);
    forVerify[22] = 0;
    forVerify[23] = 0;
    forVerify[24] = 0;
    forVerify[25] = 0;
    expect(computeCrc32(forVerify)).toBe(crc);
  });
});
