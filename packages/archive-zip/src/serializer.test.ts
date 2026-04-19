/**
 * Tests for top-level GZip serializer convenience wrappers.
 */

import { describe, expect, it } from 'vitest';
import { compressGzip, decompressGzip } from './serializer.ts';

describe('compressGzip + decompressGzip', () => {
  it('round-trips arbitrary bytes through compress → decompress', async () => {
    const original = new TextEncoder().encode('Hello, gzip round-trip!');
    const compressed = await compressGzip(original);
    // gzip magic bytes
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
    const recovered = await decompressGzip(compressed);
    expect(new TextDecoder().decode(recovered)).toBe('Hello, gzip round-trip!');
  });

  it('handles empty input', async () => {
    const empty = new Uint8Array(0);
    const compressed = await compressGzip(empty);
    const recovered = await decompressGzip(compressed);
    expect(recovered).toHaveLength(0);
  });

  it('compressed output is smaller than large repetitive input', async () => {
    const data = new TextEncoder().encode('a'.repeat(10000));
    const compressed = await compressGzip(data);
    expect(compressed.length).toBeLessThan(data.length);
  });
});
