import { describe, expect, it } from 'vitest';
import { writeBmp } from './bmp-writer.ts';

// ---------------------------------------------------------------------------
// BMP file format constants (uncompressed 24-bit RGB)
// ---------------------------------------------------------------------------
// FILE HEADER (14 bytes):
//   Offset  0: bfType      (2 bytes) — 'BM' = 0x424D
//   Offset  2: bfSize      (4 bytes) — total file size in bytes
//   Offset  6: bfReserved1 (2 bytes) — 0
//   Offset  8: bfReserved2 (2 bytes) — 0
//   Offset 10: bfOffBits   (4 bytes) — offset to pixel data = 54
//
// DIB HEADER / BITMAPINFOHEADER (40 bytes, starting at offset 14):
//   Offset 14: biSize          (4 bytes) — 40
//   Offset 18: biWidth         (4 bytes)
//   Offset 22: biHeight        (4 bytes) — positive = bottom-up
//   Offset 26: biPlanes        (2 bytes) — 1
//   Offset 28: biBitCount      (2 bytes) — 24
//   Offset 30: biCompression   (4 bytes) — 0 (BI_RGB)
//   Offset 34: biSizeImage     (4 bytes) — 0 or padded pixel data size
//   Offset 38: biXPelsPerMeter (4 bytes) — 0
//   Offset 42: biYPelsPerMeter (4 bytes) — 0
//   Offset 46: biClrUsed       (4 bytes) — 0
//   Offset 50: biClrImportant  (4 bytes) — 0
//
// Pixel data starts at offset 54. Each row is padded to a 4-byte boundary.
// Rows are stored bottom-to-top. Each pixel is stored as BGR (no alpha).
// ---------------------------------------------------------------------------

function readUint16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | (((buf[offset + 1] ?? 0)) << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readInt32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] ?? 0) |
    ((buf[offset + 1] ?? 0) << 8) |
    ((buf[offset + 2] ?? 0) << 16) |
    ((buf[offset + 3] ?? 0) << 24)
  );
}

// ---------------------------------------------------------------------------
// 2×2 test pixel data (RGBA, row-major, top-to-bottom)
// Row 0: red(255,0,0,255), green(0,255,0,255)
// Row 1: blue(0,0,255,255), white(255,255,255,255)
// ---------------------------------------------------------------------------
const TWO_BY_TWO = new Uint8ClampedArray([
  255, 0, 0, 255, // (0,0) red
  0, 255, 0, 255, // (0,1) green
  0, 0, 255, 255, // (1,0) blue
  255, 255, 255, 255, // (1,1) white
]);

describe('writeBmp', () => {
  describe('file header', () => {
    it("writes magic bytes 'BM'", () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(result[0]).toBe(0x42); // 'B'
      expect(result[1]).toBe(0x4d); // 'M'
    });

    it('writes correct total file size', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      // 2×2, each row = 6 bytes RGB + 2 bytes padding = 8 bytes per row
      // pixel data = 2 rows × 8 bytes = 16 bytes
      // total = 54 (header) + 16 = 70
      expect(readUint32LE(result, 2)).toBe(70);
    });

    it('writes bfReserved1 = 0', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint16LE(result, 6)).toBe(0);
    });

    it('writes bfReserved2 = 0', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint16LE(result, 8)).toBe(0);
    });

    it('writes bfOffBits = 54', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint32LE(result, 10)).toBe(54);
    });
  });

  describe('DIB header (BITMAPINFOHEADER)', () => {
    it('writes biSize = 40', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint32LE(result, 14)).toBe(40);
    });

    it('writes biWidth = 2', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readInt32LE(result, 18)).toBe(2);
    });

    it('writes biHeight = 2 (positive = bottom-up)', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readInt32LE(result, 22)).toBe(2);
    });

    it('writes biPlanes = 1', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint16LE(result, 26)).toBe(1);
    });

    it('writes biBitCount = 24', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint16LE(result, 28)).toBe(24);
    });

    it('writes biCompression = 0 (BI_RGB)', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint32LE(result, 30)).toBe(0);
    });

    it('writes biClrUsed = 0', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint32LE(result, 46)).toBe(0);
    });

    it('writes biClrImportant = 0', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(readUint32LE(result, 50)).toBe(0);
    });
  });

  describe('pixel data', () => {
    it('total buffer size is 70 bytes for 2×2 image', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(result.byteLength).toBe(70);
    });

    it('stores rows bottom-to-top: last row of input is first in file', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      // Bottom row of file (row 0 in BMP = last row of source = row 1: blue, white)
      // blue pixel at file offset 54: BGR = 255, 0, 0
      expect(result[54]).toBe(255); // B
      expect(result[55]).toBe(0); // G
      expect(result[56]).toBe(0); // R
      // white pixel at file offset 57: BGR = 255, 255, 255
      expect(result[57]).toBe(255); // B
      expect(result[58]).toBe(255); // G
      expect(result[59]).toBe(255); // R
    });

    it('second row in file is top row of input (red, green)', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      // Row 1 in file (row 2 of source = row 0: red, green)
      // row stride = 8 bytes (6 RGB + 2 padding)
      const row1Start = 54 + 8;
      // red pixel: BGR = 0, 0, 255
      expect(result[row1Start]).toBe(0); // B
      expect(result[row1Start + 1]).toBe(0); // G
      expect(result[row1Start + 2]).toBe(255); // R
      // green pixel: BGR = 0, 255, 0
      expect(result[row1Start + 3]).toBe(0); // B
      expect(result[row1Start + 4]).toBe(255); // G
      expect(result[row1Start + 5]).toBe(0); // R
    });

    it('row is padded to 4-byte boundary', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      // Row stride = ceil(2*3 / 4) * 4 = 8 bytes
      // padding bytes at positions 60, 61 (after first row of BGR data)
      expect(result[60]).toBe(0);
      expect(result[61]).toBe(0);
    });

    it('produces a Uint8Array', () => {
      const result = writeBmp(TWO_BY_TWO, 2, 2);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('1×1 image', () => {
    it('handles single pixel correctly', () => {
      // Single red pixel
      const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
      const result = writeBmp(pixels, 1, 1);
      // 1 pixel = 3 bytes RGB, padded to 4 bytes = 4 bytes per row
      // total = 54 + 4 = 58
      expect(result.byteLength).toBe(58);
      // pixel at offset 54: BGR = 0, 0, 255
      expect(result[54]).toBe(0); // B
      expect(result[55]).toBe(0); // G
      expect(result[56]).toBe(255); // R
    });
  });

  describe('4×1 image (no padding needed)', () => {
    it('row stride is exactly 12 bytes with no padding', () => {
      // 4 pixels × 3 bytes = 12 bytes, already 4-byte aligned
      const pixels = new Uint8ClampedArray(4 * 4); // 4 pixels RGBA
      const result = writeBmp(pixels, 4, 1);
      // total = 54 + 12 = 66
      expect(result.byteLength).toBe(66);
    });
  });
});
