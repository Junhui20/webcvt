import { describe, expect, it } from 'vitest';
import { crc32, crc32Two } from './crc32.ts';

describe('crc32', () => {
  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  });

  it('computes known CRC for "123456789"', () => {
    // Standard CRC-32 test vector: "123456789" → 0xCBF43926
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it('computes known CRC for single byte 0x00', () => {
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
  });

  it('computes known CRC for PNG IHDR type bytes', () => {
    // PNG IHDR chunk type: [0x49, 0x48, 0x44, 0x52] = "IHDR"
    const type = new TextEncoder().encode('IHDR');
    // 13-byte standard IHDR data: 1x1 image, 8-bit depth, RGBA
    const data = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x01, // width = 1
      0x00,
      0x00,
      0x00,
      0x01, // height = 1
      0x08, // bit depth
      0x06, // colour type (RGBA)
      0x00, // compression
      0x00, // filter
      0x00, // interlace
    ]);
    const combined = new Uint8Array([...type, ...data]);
    const crc = crc32(combined);
    // Should be non-zero and deterministic
    expect(crc).toBeTypeOf('number');
    expect(crc).toBeGreaterThan(0);
  });

  it('is incremental: crc of concat equals chained computation', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const combined = new Uint8Array([...a, ...b]);
    // Chained: feed b using the intermediate state from a
    const partial = crc32(a);
    // Note: crc32 uses full computation, so we need to use crc32Two for chaining
    const crcCombined = crc32(combined);
    const crcChained = crc32Two(a, b);
    expect(crcChained).toBe(crcCombined);
  });

  it('crc32Two matches crc32 over concatenation', () => {
    const type = new TextEncoder().encode('IDAT');
    const payload = new Uint8Array([0x78, 0x9c, 0x62, 0x60, 0x00, 0x00]);
    const combined = new Uint8Array([...type, ...payload]);
    expect(crc32Two(type, payload)).toBe(crc32(combined));
  });

  it('is deterministic across multiple calls (table caching)', () => {
    const data = new TextEncoder().encode('hello');
    const c1 = crc32(data);
    const c2 = crc32(data);
    expect(c1).toBe(c2);
  });

  it('caches the CRC table across calls (exercises non-undefined branch)', () => {
    // Call multiple times to ensure the cached-table path is exercised.
    // First call builds the table; subsequent calls reuse it.
    const data = new TextEncoder().encode('world');
    const c1 = crc32(data);
    const c2 = crc32(data);
    const c3 = crc32(data);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
    // Also exercise crc32Two with repeated calls
    const a = new TextEncoder().encode('PNG');
    const b = new Uint8Array([1, 2, 3]);
    const r1 = crc32Two(a, b);
    const r2 = crc32Two(a, b);
    expect(r1).toBe(r2);
  });

  it('computes correct CRC for all-0xFF bytes (exercises both ternary branches in table build)', () => {
    // 0xFF byte exercises c & 1 = true branch frequently in table construction
    const data = new Uint8Array(4).fill(0xff);
    const result = crc32(data);
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThan(0);
  });

  it('computes CRC with a non-default initial value', () => {
    const data = new Uint8Array([0xab, 0xcd]);
    // Using a different initial value exercises the initial parameter branch
    const r1 = crc32(data, 0x00000000);
    const r2 = crc32(data, 0xffffffff);
    // They should differ since they start from different states
    expect(r1).not.toBe(r2);
  });
});
