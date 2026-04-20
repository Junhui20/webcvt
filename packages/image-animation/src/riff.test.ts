import { describe, expect, it } from 'vitest';
import { WebpChunkTooLargeError } from './errors.ts';
import { readRiffChunk, readU24Le, readU32Le, writeRiffChunk } from './riff.ts';

describe('writeRiffChunk', () => {
  it('writes a chunk with correct FourCC and size', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const chunk = writeRiffChunk('ANIM', payload);
    expect(chunk.length).toBe(8 + 4); // header + payload (even)
    // FourCC
    expect(String.fromCharCode(chunk[0] ?? 0, chunk[1] ?? 0, chunk[2] ?? 0, chunk[3] ?? 0)).toBe(
      'ANIM',
    );
    // Size (u32 LE) = 4
    expect(chunk[4]).toBe(4);
    expect(chunk[5]).toBe(0);
    expect(chunk[6]).toBe(0);
    expect(chunk[7]).toBe(0);
    // Payload
    expect(Array.from(chunk.subarray(8, 12))).toEqual([1, 2, 3, 4]);
  });

  it('adds a pad byte for odd-size payloads', () => {
    const payload = new Uint8Array([1, 2, 3]); // 3 bytes = odd
    const chunk = writeRiffChunk('VP8L', payload);
    expect(chunk.length).toBe(8 + 4); // header + 3 bytes + 1 pad
    // Size field = 3 (actual payload size, NOT padded)
    expect(chunk[4]).toBe(3);
    // Pad byte = 0
    expect(chunk[8 + 3]).toBe(0);
  });

  it('writes a zero-length chunk', () => {
    const chunk = writeRiffChunk('TEST', new Uint8Array(0));
    expect(chunk.length).toBe(8);
    expect(chunk[4]).toBe(0); // size = 0
  });

  it('writes FourCC with trailing space (VP8 )', () => {
    const payload = new Uint8Array([0x01, 0x02]);
    const chunk = writeRiffChunk('VP8 ', payload);
    expect(chunk[3]).toBe(0x20); // space character
  });
});

describe('readRiffChunk', () => {
  it('reads back a chunk written by writeRiffChunk', () => {
    const payload = new Uint8Array([10, 20, 30, 40]);
    const written = writeRiffChunk('ANMF', payload);
    const result = readRiffChunk(written, 0);
    expect(result.fourcc).toBe('ANMF');
    expect(result.size).toBe(4);
    expect(Array.from(result.payload)).toEqual([10, 20, 30, 40]);
    expect(result.nextOffset).toBe(written.length);
  });

  it('handles odd-size chunk with pad byte', () => {
    const payload = new Uint8Array([5, 6, 7]); // odd size
    const written = writeRiffChunk('VP8L', payload);
    const result = readRiffChunk(written, 0);
    expect(result.fourcc).toBe('VP8L');
    expect(result.size).toBe(3);
    expect(Array.from(result.payload)).toEqual([5, 6, 7]);
    // nextOffset accounts for pad byte
    expect(result.nextOffset).toBe(8 + 4); // 8 header + 3 payload + 1 pad = 12
  });

  it('reads a chunk at a non-zero offset', () => {
    const prefix = new Uint8Array([0xde, 0xad]);
    const payload = new Uint8Array([99]);
    const chunkBytes = writeRiffChunk('ICCP', payload);
    const combined = new Uint8Array([...prefix, ...chunkBytes]);
    const result = readRiffChunk(combined, 2);
    expect(result.fourcc).toBe('ICCP');
    expect(result.offset).toBe(2);
    expect(Array.from(result.payload)).toEqual([99]);
  });

  it('throws WebpChunkTooLargeError for oversized chunk', () => {
    const fakeChunk = new Uint8Array(8);
    fakeChunk[0] = 0x41; // 'A'
    fakeChunk[1] = 0x4e; // 'N'
    fakeChunk[2] = 0x4d; // 'M'
    fakeChunk[3] = 0x46; // 'F'
    const big = 200 * 1024 * 1024 + 1;
    fakeChunk[4] = big & 0xff;
    fakeChunk[5] = (big >> 8) & 0xff;
    fakeChunk[6] = (big >> 16) & 0xff;
    fakeChunk[7] = (big >> 24) & 0xff;
    expect(() => readRiffChunk(fakeChunk, 0)).toThrowError(WebpChunkTooLargeError);
  });

  it('throws when stream is too short for declared size', () => {
    const chunk = new Uint8Array(8);
    chunk[0] = 0x56; // 'V'
    chunk[1] = 0x50; // 'P'
    chunk[2] = 0x38; // '8'
    chunk[3] = 0x20; // ' '
    chunk[4] = 100; // says 100 bytes but none follow
    expect(() => readRiffChunk(chunk, 0)).toThrow();
  });

  it('throws when offset is at end of buffer', () => {
    const data = new Uint8Array(4);
    expect(() => readRiffChunk(data, 0)).toThrow(); // need 8 bytes minimum
  });

  it('reads multiple consecutive chunks correctly', () => {
    const c1 = writeRiffChunk('ANIM', new Uint8Array([1, 2, 3, 4, 5, 6]));
    const c2 = writeRiffChunk('ANMF', new Uint8Array([7, 8]));
    const combined = new Uint8Array([...c1, ...c2]);

    const r1 = readRiffChunk(combined, 0);
    expect(r1.fourcc).toBe('ANIM');
    const r2 = readRiffChunk(combined, r1.nextOffset);
    expect(r2.fourcc).toBe('ANMF');
    expect(r2.nextOffset).toBe(combined.length);
  });
});

describe('readU32Le / readU24Le / readU16Le', () => {
  it('readU32Le reads 32-bit LE correctly', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(readU32Le(data, 0)).toBe(0x04030201);
  });

  it('readU24Le reads 24-bit LE correctly', () => {
    const data = new Uint8Array([0xff, 0x03, 0x00]);
    expect(readU24Le(data, 0)).toBe(0x0003ff);
  });

  it('readU16Le reads 16-bit LE correctly', async () => {
    const { readU16Le } = await import('./riff.ts');
    const data = new Uint8Array([0x34, 0x12]);
    expect(readU16Le(data, 0)).toBe(0x1234);
  });

  it('readU32Le reads at non-zero offset', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(readU32Le(data, 1)).toBe(0x04030201);
  });

  it('readU24Le reads at non-zero offset', () => {
    const data = new Uint8Array([0x00, 0x0a, 0x0b, 0x0c]);
    expect(readU24Le(data, 1)).toBe(0x0c0b0a);
  });

  it('readU32Le handles max uint32 value', () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(readU32Le(data, 0)).toBe(0xffffffff);
  });

  it('readU32Le returns 0 for all-zero bytes', () => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(readU32Le(data, 0)).toBe(0);
  });
});
