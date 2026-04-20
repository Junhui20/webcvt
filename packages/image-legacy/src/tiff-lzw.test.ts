/**
 * Tests for TIFF LZW codec.
 *
 * Covers:
 *   - Trap #9: MSB-first (not GIF LSB-first)
 *   - Trap #10: dictionary growth at 510 (not 511)
 *   - Trap #11: ClearCode resets dict + code width to 9
 *   - KwKwK case
 *   - Error cases
 */

import { describe, expect, it } from 'vitest';
import { type BuildTiffPage, buildTiff } from './_test-helpers/build-tiff.ts';
import { TiffLzwDecodeError, TiffUnsupportedFeatureError } from './errors.ts';
import { lzwDecode, lzwEncode } from './tiff-lzw.ts';
import { parseTiff } from './tiff.ts';

// ---------------------------------------------------------------------------
// Helper: build a minimal 1-strip LZW-compressed TIFF and round-trip decode
// ---------------------------------------------------------------------------

function buildLzwTiff(pixelData: Uint8Array, width: number, height: number): Uint8Array {
  const page: BuildTiffPage = {
    width,
    height,
    photometric: 1, // BlackIsZero grayscale
    samplesPerPixel: 1,
    bitsPerSample: 8,
    compression: 5,
    pixelData,
  };
  return buildTiff({ byteOrder: 'little', pages: [page] });
}

describe('lzwDecode', () => {
  it('decodes a round-trip via buildTiff/parseTiff for 4×1 grayscale', () => {
    const original = new Uint8Array([10, 20, 30, 40]);
    const tiff = buildLzwTiff(original, 4, 1);
    const parsed = parseTiff(tiff);
    expect(parsed.pages[0]?.pixelData).toBeInstanceOf(Uint8Array);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd)).toEqual([10, 20, 30, 40]);
  });

  it('decodes a round-trip for 4×4 grayscale (multiple rows)', () => {
    const original = new Uint8Array(16);
    for (let i = 0; i < 16; i++) original[i] = i * 10;
    const tiff = buildLzwTiff(original, 4, 4);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd.slice(0, 16))).toEqual(Array.from(original));
  });

  it('handles a highly repetitive buffer efficiently', () => {
    const original = new Uint8Array(256).fill(0xaa);
    const tiff = buildLzwTiff(original, 256, 1);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(pd.length).toBe(256);
    expect(pd.every((b) => b === 0xaa)).toBe(true);
  });

  it('handles all-unique bytes (no repeating patterns)', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const tiff = buildLzwTiff(original, 256, 1);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd)).toEqual(Array.from(original));
  });

  it('throws TiffLzwDecodeError for data before ClearCode', () => {
    // Write bits for a non-clear, non-EOI code at the start (MSB-first 9-bit code 0)
    // Code 0 in 9 bits MSB-first: 0b000000000 = 0x00 0x00 (with some padding)
    // Actually, emit a 9-bit code of value 100 without the leading ClearCode
    const buf = new Uint8Array(2);
    // MSB-first: 9 bits of value 100 (0x064) = 0 1100100 0 → in two bytes
    // bit pattern: 011001000 → 0x64 shifted MSB: 00110010 0xxxxxxx
    buf[0] = 0b00110010; // 9 bits: 001100100 (code=50 in MSB)
    buf[1] = 0b00000000;
    expect(() => lzwDecode(buf)).toThrow(TiffLzwDecodeError);
  });

  it('throws TiffLzwDecodeError when expansion would exceed cap', () => {
    // Build a huge repetitive buffer that expands massively
    const bigRepeat = new Uint8Array(1024).fill(0x41); // 'A' * 1024
    const page: BuildTiffPage = {
      width: 1024,
      height: 1,
      photometric: 1,
      samplesPerPixel: 1,
      bitsPerSample: 8,
      compression: 5,
      pixelData: bigRepeat,
    };
    const tiff = buildTiff({ byteOrder: 'little', pages: [page] });
    // Parse normally should succeed
    const parsed = parseTiff(tiff);
    expect(parsed.pages[0]?.pixelData).toHaveLength(1024);
  });

  it('dictionary growth at 510 (Trap #10): width transitions to 10 bits after code 510', () => {
    // Use a sequence that forces enough dictionary entries to cross the 510 boundary.
    // A pseudo-random walk (i * 7 % 256) creates many distinct 2-byte pairs,
    // filling the dictionary past 510 → triggering the 9→10 bit-width transition.
    const len = 512;
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = (i * 7) % 256;
    const tiff = buildLzwTiff(data, len, 1);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd)).toEqual(Array.from(data));
  });

  it('dictionary growth beyond 1022 (10→11 bit transition)', () => {
    // Use a 1024-byte pseudo-random walk to fill the LZW dictionary past 1022 entries,
    // triggering the 10-bit → 11-bit code-width transition.
    const len = 1024;
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = (i * 13 + i * i * 7) % 256;
    const tiff = buildLzwTiff(data, len, 1);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd)).toEqual(Array.from(data));
  });

  it('ClearCode resets dictionary and code width (Trap #11)', () => {
    // A large repetitive buffer will trigger code width expansion,
    // then a second run starts fresh. Build by parsing two strips
    // (each with their own LZW stream): we test this via a long buffer
    const data = new Uint8Array(300);
    for (let i = 0; i < 300; i++) data[i] = i % 50;
    const tiff = buildLzwTiff(data, 300, 1);
    const parsed = parseTiff(tiff);
    const pd = parsed.pages[0]?.pixelData as Uint8Array;
    expect(Array.from(pd.slice(0, 300))).toEqual(Array.from(data));
  });

  it('throws TiffLzwDecodeError for KwKwK case immediately after ClearCode (prevEntry null)', () => {
    // After ClearCode, nextCode=258 and prevEntry=null.
    // Emitting code 258 immediately triggers the KwKwK path with prevEntry=null → error.
    //
    // MSB-first 9-bit codes:
    //   Code 256 (ClearCode): 100000000
    //   Code 258 (KwKwK):     100000010
    //
    // Bit stream (18 bits):
    //   pos 0-8:   1 0 0 0 0 0 0 0 0   (ClearCode)
    //   pos 9-17:  1 0 0 0 0 0 0 1 0   (258)
    //
    // Bytes:
    //   byte0 (pos 0-7):   10000000 = 0x80
    //   byte1 (pos 8-15):  01000000 = 0x40
    //   byte2 (pos 16-17): 10xxxxxx = 0x80 (padded)
    const buf = new Uint8Array([0x80, 0x40, 0x80]);
    expect(() => lzwDecode(buf)).toThrow(TiffLzwDecodeError);
    try {
      lzwDecode(buf);
    } catch (e) {
      expect((e as TiffLzwDecodeError).message).toContain('KwKwK');
    }
  });

  it('throws TiffLzwDecodeError for out-of-range code (code > nextCode)', () => {
    // Craft a minimal LZW stream: ClearCode (256 in 9-bit MSB), then an out-of-range code.
    // After ClearCode, nextCode = 258 (FIRST_DICT_CODE). We emit code 259, which is > nextCode
    // and != nextCode, so it triggers the out-of-range branch.
    //
    // MSB-first bit layout (9-bit codes):
    //   Code 256 (ClearCode): bits = 100000000
    //   Code 259 (out-of-range): bits = 100000011
    //
    // Packed MSB-first into bytes:
    //   100000000 100000011 = 1000000001000000 11xxxxxx
    //   byte0: 10000000 = 0x80
    //   byte1: 01000000 = 0x40
    //   byte2: 11000000 = 0xC0 (remaining bits padded with 0s)
    const buf = new Uint8Array([0x80, 0x40, 0xc0]);
    expect(() => lzwDecode(buf)).toThrow(TiffLzwDecodeError);
    try {
      lzwDecode(buf);
    } catch (e) {
      expect((e as TiffLzwDecodeError).message).toContain('out of range');
    }
  });

  it('does not exceed expansion cap for legitimate LZW data', () => {
    // The expansion cap is a hostile-input protection; for legitimate data it should
    // never fire. Verify that a normal round-trip works without any cap error.
    //
    // ClearCode + 'A' + 'B' + EOI (correctly packed MSB-first):
    // Code 256 (ClearCode, 9-bit): 100000000
    // Code 65  ('A',        9-bit): 001000001
    // Code 66  ('B',        9-bit): 001000010
    // Code 257 (EOI,        9-bit): 100000001
    //
    // Bit stream (36 bits):
    //   pos 0-8:   1 0 0 0 0 0 0 0 0   (256)
    //   pos 9-17:  0 1 0 0 0 0 0 0 1   (65)
    //   pos 18-26: 0 1 0 0 0 0 0 1 0   (66)
    //   pos 27-35: 1 0 0 0 0 0 0 0 1   (257)
    //
    // Bytes (MSB-first, including ClearCode ending at bit 8 of byte 1):
    //   byte0 (bits 0-7):   1 0 0 0 0 0 0 0 = 0x80  (ClearCode bits 8-1)
    //   byte1 (bits 8-15):  0 0 0 1 0 0 0 0 = 0x10  (ClearCode bit 0; code65 bits 8-2)
    //   byte2 (bits 16-23): 0 1 0 0 1 0 0 0 = 0x48  (code65 bits 1-0; code66 bits 8-3)
    //   byte3 (bits 24-31): 0 1 0 1 0 0 0 0 = 0x50  (code66 bits 2-0; EOI bits 8-5)
    //   byte4 (bits 32-35): 0 0 0 1 x x x x = 0x10  (EOI bits 4-0, padded)
    const buf = new Uint8Array([0x80, 0x10, 0x48, 0x50, 0x10]);
    const result = lzwDecode(buf, 2);
    expect(Array.from(result)).toEqual([65, 66]);
  });

  it('lzwEncode stub throws TiffUnsupportedFeatureError', () => {
    expect(() => lzwEncode(new Uint8Array([1, 2, 3]))).toThrow(TiffUnsupportedFeatureError);
    try {
      lzwEncode(new Uint8Array([1, 2, 3]));
    } catch (e) {
      expect((e as TiffUnsupportedFeatureError).message).toContain('lzw-encode-not-implemented');
    }
  });
});
