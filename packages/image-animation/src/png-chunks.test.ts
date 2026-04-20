import { describe, expect, it } from 'vitest';
import { crc32Two } from './crc32.ts';
import { ApngBadCrcError, ApngChunkTooLargeError } from './errors.ts';
import { readPngChunk, writePngChunk } from './png-chunks.ts';

/** Build a valid PNG chunk for testing. */
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  return writePngChunk(type, data);
}

describe('writePngChunk', () => {
  it('writes a zero-length chunk with correct structure', () => {
    const chunk = writePngChunk('IEND', new Uint8Array(0));
    expect(chunk.length).toBe(12); // 4+4+0+4
    // Length field = 0
    expect(chunk[0]).toBe(0);
    expect(chunk[1]).toBe(0);
    expect(chunk[2]).toBe(0);
    expect(chunk[3]).toBe(0);
    // Type = 'IEND'
    expect(chunk[4]).toBe(0x49); // I
    expect(chunk[5]).toBe(0x45); // E
    expect(chunk[6]).toBe(0x4e); // N
    expect(chunk[7]).toBe(0x44); // D
  });

  it('writes a 4-byte chunk with correct length field', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const chunk = writePngChunk('tEXt', data);
    expect(chunk.length).toBe(4 + 4 + 4 + 4);
    expect(chunk[3]).toBe(4); // length LSB
  });

  it('computes correct CRC over type+data', () => {
    const type = 'IHDR';
    const data = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const chunk = writePngChunk(type, data);
    const typeBytes = new TextEncoder().encode(type);
    const expectedCrc = crc32Two(typeBytes, data);
    const storedCrc =
      ((chunk[8 + data.length] ?? 0) << 24) |
      ((chunk[8 + data.length + 1] ?? 0) << 16) |
      ((chunk[8 + data.length + 2] ?? 0) << 8) |
      (chunk[8 + data.length + 3] ?? 0);
    expect(storedCrc >>> 0).toBe(expectedCrc);
  });
});

describe('readPngChunk', () => {
  it('reads back a chunk written by writePngChunk', () => {
    const data = new Uint8Array([10, 20, 30]);
    const written = writePngChunk('tEXt', data);
    const result = readPngChunk(written, 0);
    expect(result.type).toBe('tEXt');
    expect(Array.from(result.data)).toEqual([10, 20, 30]);
    expect(result.nextOffset).toBe(written.length);
  });

  it('reads IEND (zero-length chunk)', () => {
    const chunk = writePngChunk('IEND', new Uint8Array(0));
    const result = readPngChunk(chunk, 0);
    expect(result.type).toBe('IEND');
    expect(result.data.length).toBe(0);
    expect(result.nextOffset).toBe(12);
  });

  it('reads a chunk at a non-zero offset', () => {
    const prefix = new Uint8Array(5).fill(0);
    const data = new Uint8Array([7, 8, 9]);
    const chunkBytes = writePngChunk('IDAT', data);
    const combined = new Uint8Array([...prefix, ...chunkBytes]);
    const result = readPngChunk(combined, 5);
    expect(result.type).toBe('IDAT');
    expect(Array.from(result.data)).toEqual([7, 8, 9]);
    expect(result.offset).toBe(5);
    expect(result.nextOffset).toBe(5 + chunkBytes.length);
  });

  it('throws ApngBadCrcError when CRC is corrupt', () => {
    const data = new Uint8Array([1, 2]);
    const chunk = writePngChunk('IHDR', data);
    // Corrupt the CRC byte
    const corrupted = new Uint8Array(chunk);
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(() => readPngChunk(corrupted, 0)).toThrowError(ApngBadCrcError);
  });

  it('throws ApngChunkTooLargeError when length exceeds cap', () => {
    // Build a chunk with a very large declared length in the length field
    const fakeChunk = new Uint8Array(12);
    // Set length to 200MB + 1
    const big = 200 * 1024 * 1024 + 1;
    fakeChunk[0] = (big >> 24) & 0xff;
    fakeChunk[1] = (big >> 16) & 0xff;
    fakeChunk[2] = (big >> 8) & 0xff;
    fakeChunk[3] = big & 0xff;
    fakeChunk[4] = 0x49; // 'I'
    fakeChunk[5] = 0x44; // 'D'
    fakeChunk[6] = 0x41; // 'A'
    fakeChunk[7] = 0x54; // 'T'
    expect(() => readPngChunk(fakeChunk, 0)).toThrowError(ApngChunkTooLargeError);
  });

  it('throws when stream is too short', () => {
    const tooShort = new Uint8Array([0, 0, 0, 5, 0x49, 0x44, 0x41, 0x54]); // says 5 bytes but none present
    expect(() => readPngChunk(tooShort, 0)).toThrow();
  });

  it('throws when fewer than 8 bytes remain at offset (cannot read chunk header)', () => {
    // Only 4 bytes: cannot read the 8-byte chunk header (length + type)
    const tooShort = new Uint8Array([0x00, 0x00, 0x00, 0x04]);
    expect(() => readPngChunk(tooShort, 0)).toThrow(/unexpected end of stream/);
  });

  it('throws when offset is past end of buffer', () => {
    const chunk = writePngChunk('IEND', new Uint8Array(0));
    // Offset beyond end of valid buffer
    expect(() => readPngChunk(chunk, chunk.length)).toThrow(/unexpected end of stream/);
  });

  it('throws when offset+8 exceeds buffer length (partial header)', () => {
    // 6 bytes at offset 0: not enough for 8-byte chunk header
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x49, 0x48]);
    expect(() => readPngChunk(buf, 0)).toThrow(/unexpected end of stream/);
  });

  it('throws truncated-stream error when declared length exceeds remaining bytes', () => {
    // Chunk declares 10 bytes of data but only 2 bytes follow the type
    const buf = new Uint8Array(14);
    buf[3] = 10; // length = 10 (big-endian)
    buf[4] = 0x49;
    buf[5] = 0x44;
    buf[6] = 0x41;
    buf[7] = 0x54; // 'IDAT'
    // Only 6 bytes after the type field (index 8..13) — not enough for 10+4
    expect(() => readPngChunk(buf, 0)).toThrow();
  });

  it('round-trips multiple chunks consecutively', () => {
    const chunk1 = writePngChunk('IHDR', new Uint8Array([1, 2, 3]));
    const chunk2 = writePngChunk('IDAT', new Uint8Array([4, 5]));
    const chunk3 = writePngChunk('IEND', new Uint8Array(0));
    const combined = new Uint8Array([...chunk1, ...chunk2, ...chunk3]);

    const r1 = readPngChunk(combined, 0);
    const r2 = readPngChunk(combined, r1.nextOffset);
    const r3 = readPngChunk(combined, r2.nextOffset);

    expect(r1.type).toBe('IHDR');
    expect(r2.type).toBe('IDAT');
    expect(r3.type).toBe('IEND');
    expect(r3.nextOffset).toBe(combined.length);
  });
});
