import { afterEach, describe, expect, it } from 'vitest';
import { deflate, inflate } from './compression.ts';
import { FontCompressionUnavailableError, FontTableTooLargeError } from './errors.ts';

const BIG_BUDGET = { used: 0, max: 1_000_000 };

describe('deflate / inflate', () => {
  it('round-trips bytes through zlib deflate and inflate', async () => {
    const data = new Uint8Array(512).map((_, i) => i & 0xff);
    const compressed = await deflate(data);
    const out = await inflate(compressed, data.length, 'test', { used: 0, max: 1_000_000 });
    expect(Array.from(out)).toEqual(Array.from(data));
  });

  it('aborts when output exceeds the per-table cap', async () => {
    const compressed = await deflate(new Uint8Array(200));
    await expect(inflate(compressed, 10, 'glyf', { ...BIG_BUDGET })).rejects.toThrow(
      FontTableTooLargeError,
    );
  });

  it('aborts when the cumulative budget is exhausted', async () => {
    const compressed = await deflate(new Uint8Array(200));
    await expect(inflate(compressed, 1000, 'glyf', { used: 0, max: 5 })).rejects.toThrow(
      FontTableTooLargeError,
    );
  });
});

describe('environment guards', () => {
  const realCompression = globalThis.CompressionStream;
  const realDecompression = globalThis.DecompressionStream;

  afterEach(() => {
    globalThis.CompressionStream = realCompression;
    globalThis.DecompressionStream = realDecompression;
  });

  it('throws when CompressionStream is unavailable', async () => {
    // @ts-expect-error — deliberately remove for the test.
    globalThis.CompressionStream = undefined;
    await expect(deflate(new Uint8Array(4))).rejects.toThrow(FontCompressionUnavailableError);
  });

  it('throws when DecompressionStream is unavailable', async () => {
    // @ts-expect-error — deliberately remove for the test.
    globalThis.DecompressionStream = undefined;
    await expect(inflate(new Uint8Array(4), 100, 'x', { ...BIG_BUDGET })).rejects.toThrow(
      FontCompressionUnavailableError,
    );
  });
});
