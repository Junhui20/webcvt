/**
 * Tests for the zlib CRC-32 implementation.
 *
 * Verifies against known-good values:
 *   - CRC-32("123456789") = 0xCBF43926 (standard zlib test vector)
 *   - CRC-32("") = 0x00000000
 *   - CRC-32([0x00]) = 0xD202EF8D
 */

import { describe, expect, it } from 'vitest';
import { computeCrc32 } from './crc32.ts';

describe('computeCrc32', () => {
  it('returns 0 for empty input', () => {
    expect(computeCrc32(new Uint8Array(0))).toBe(0x00000000);
  });

  it('computes the standard zlib test vector for "123456789"', () => {
    const data = new TextEncoder().encode('123456789');
    expect(computeCrc32(data)).toBe(0xcbf43926);
  });

  it('computes CRC-32 for a single zero byte', () => {
    const data = new Uint8Array([0x00]);
    expect(computeCrc32(data)).toBe(0xd202ef8d);
  });

  it('computes CRC-32 for "hello world"', () => {
    const data = new TextEncoder().encode('hello world');
    // Known value from zlib reference
    expect(computeCrc32(data)).toBe(0x0d4a1185);
  });

  it('supports incremental (chained) computation with seed', () => {
    const data = new TextEncoder().encode('123456789');
    // CRC of full string
    const full = computeCrc32(data);
    // Incremental: split at 4 bytes
    // NOTE: incremental CRC uses un-finalized intermediate value
    // The seed interface: pass previous (crc XOR 0xFFFFFFFF) as seed
    // Actually the seed approach here: we pass the raw internal CRC
    // Let's test that computing in two halves with no seed gives same result as full
    const partA = data.subarray(0, 4);
    const partB = data.subarray(4);
    // For incremental, the seed passed to the second call should be the RAW internal state
    // Our API: seed defaults to 0xFFFFFFFF, output XOR 0xFFFFFFFF
    // To chain: (result XOR 0xFFFFFFFF) gives the internal state for next call
    const crcA = computeCrc32(partA);
    const crcB = computeCrc32(partB, crcA ^ 0xffffffff);
    expect(crcB).toBe(full);
  });

  it('is different from MPEG-TS PSI CRC-32 (different polynomial)', () => {
    // The zlib poly is 0xEDB88320 (reflected) vs MPEG-TS 0x04C11DB7 (non-reflected)
    // They produce different results for the same input
    const data = new TextEncoder().encode('test');
    const zlibCrc = computeCrc32(data);
    // Just assert it's not the MPEG-TS result (which we can't easily compute here)
    // but we can verify it matches the known zlib value for "test"
    expect(zlibCrc).toBe(0xd87f7e0c);
  });

  it('handles arbitrary byte sequences', () => {
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
    const crc = computeCrc32(data);
    expect(typeof crc).toBe('number');
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffffffff);
  });
});
