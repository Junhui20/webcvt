/**
 * Unit tests for header.ts chunk reader / writer primitives.
 */

import { describe, expect, it } from 'vitest';
import { DATA_ID, FMT_ID, RIFF_ID, readChunkHeader, writeChunkHeader } from './header.ts';

describe('readChunkHeader', () => {
  it('reads a RIFF chunk header correctly', () => {
    // "RIFF" + LE uint32 1234
    const buf = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // "RIFF"
      0xd2,
      0x04,
      0x00,
      0x00, // 1234 LE
    ]);
    const result = readChunkHeader(buf, 0);
    expect(result.id).toBe(RIFF_ID);
    expect(result.size).toBe(1234);
    expect(result.bodyOffset).toBe(8);
  });

  it('reads "fmt " id including trailing space', () => {
    const buf = new Uint8Array([
      0x66,
      0x6d,
      0x74,
      0x20, // "fmt "
      0x10,
      0x00,
      0x00,
      0x00, // 16 LE
    ]);
    const result = readChunkHeader(buf, 0);
    expect(result.id).toBe(FMT_ID);
    expect(result.id).toHaveLength(4);
    expect(result.id.charCodeAt(3)).toBe(0x20); // trailing space
    expect(result.size).toBe(16);
  });

  it('reads "data" chunk header', () => {
    // 0x00015880 = 88192 in LE: 0x80, 0x58, 0x01, 0x00
    const buf = new Uint8Array([
      0x64,
      0x61,
      0x74,
      0x61, // "data"
      0x80,
      0x58,
      0x01,
      0x00, // 88192 LE
    ]);
    const result = readChunkHeader(buf, 0);
    expect(result.id).toBe(DATA_ID);
    expect(result.size).toBe(88192);
  });

  it('respects a non-zero start offset', () => {
    const prefix = new Uint8Array(12); // 12 bytes of padding
    const header = new Uint8Array([
      0x64,
      0x61,
      0x74,
      0x61, // "data"
      0x04,
      0x00,
      0x00,
      0x00, // 4 LE
    ]);
    const buf = new Uint8Array([...prefix, ...header]);
    const result = readChunkHeader(buf, 12);
    expect(result.id).toBe(DATA_ID);
    expect(result.size).toBe(4);
    expect(result.bodyOffset).toBe(20);
  });

  it('throws RangeError when fewer than 8 bytes remain', () => {
    const buf = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]); // only 5 bytes
    expect(() => readChunkHeader(buf, 0)).toThrow(RangeError);
  });

  it('throws RangeError when offset is at the end', () => {
    const buf = new Uint8Array(8);
    expect(() => readChunkHeader(buf, 8)).toThrow(RangeError);
  });

  it('reads maximum uint32 size correctly (little-endian)', () => {
    const buf = new Uint8Array([
      0x4a,
      0x55,
      0x4e,
      0x4b, // "JUNK"
      0xff,
      0xff,
      0xff,
      0xff, // 4294967295 LE
    ]);
    const result = readChunkHeader(buf, 0);
    expect(result.id).toBe('JUNK');
    expect(result.size).toBe(4294967295);
  });
});

describe('writeChunkHeader', () => {
  it('writes RIFF header bytes correctly', () => {
    const result = writeChunkHeader(RIFF_ID, 1234);
    expect(result.length).toBe(8);
    // "RIFF"
    expect(result[0]).toBe(0x52);
    expect(result[1]).toBe(0x49);
    expect(result[2]).toBe(0x46);
    expect(result[3]).toBe(0x46);
    // 1234 LE = 0xD2, 0x04, 0x00, 0x00
    expect(result[4]).toBe(0xd2);
    expect(result[5]).toBe(0x04);
    expect(result[6]).toBe(0x00);
    expect(result[7]).toBe(0x00);
  });

  it('writes fmt  header with trailing space', () => {
    const result = writeChunkHeader(FMT_ID, 16);
    expect(result[3]).toBe(0x20); // trailing space in "fmt "
    expect(result[4]).toBe(16);
    expect(result[5]).toBe(0);
  });

  it('round-trips: write then read produces the same values', () => {
    const written = writeChunkHeader('LIST', 9999);
    const back = readChunkHeader(written, 0);
    expect(back.id).toBe('LIST');
    expect(back.size).toBe(9999);
    expect(back.bodyOffset).toBe(8);
  });

  it('writes zero size correctly', () => {
    const result = writeChunkHeader(DATA_ID, 0);
    const back = readChunkHeader(result, 0);
    expect(back.id).toBe(DATA_ID);
    expect(back.size).toBe(0);
  });
});
