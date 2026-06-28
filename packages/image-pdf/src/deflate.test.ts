/**
 * Tests for deflate.ts — zlib output via CompressionStream (available in Node 18+).
 */

import { describe, expect, it } from 'vitest';
import { deflate } from './deflate.ts';

async function inflate(zlibBytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  void writer.write(zlibBytes as BufferSource);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe('deflate', () => {
  it('produces a zlib stream (0x78 header)', async () => {
    const out = await deflate(new Uint8Array([1, 2, 3, 4, 5]));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toBe(0x78); // zlib CMF byte
  });

  it('round-trips through DecompressionStream', async () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) & 0xff;
    const compressed = await deflate(original);
    const restored = await inflate(compressed);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('compresses highly-repetitive input below its original size', async () => {
    const repetitive = new Uint8Array(4096).fill(0xab);
    const out = await deflate(repetitive);
    expect(out.length).toBeLessThan(repetitive.length);
  });
});
