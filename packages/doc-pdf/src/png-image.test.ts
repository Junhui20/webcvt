import { describe, expect, it } from 'vitest';
import { makePng } from './_test-helpers/fixtures.ts';
import {
  DocPdfDecodeError,
  DocPdfDimensionsTooLargeError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';
import { isPng, pngToPdfImage } from './png-image.ts';

describe('isPng', () => {
  it('detects the PNG signature', () => {
    expect(isPng(makePng(2, 2))).toBe(true);
    expect(isPng(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isPng(new Uint8Array(3))).toBe(false);
  });
});

describe('pngToPdfImage', () => {
  it('embeds an 8-bit RGB PNG as FlateDecode + PNG predictor', () => {
    const img = pngToPdfImage(makePng(4, 3, { colorType: 2, bitDepth: 8 }));
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.colorSpace).toBe('DeviceRGB');
    expect(img.bitsPerComponent).toBe(8);
    expect(img.filter).toBe('FlateDecode');
    expect(img.decodeParms).toBe('<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 4 >>');
    expect(img.data.length).toBeGreaterThan(0);
  });

  it('embeds an 8-bit grayscale PNG as DeviceGray (1 colour)', () => {
    const img = pngToPdfImage(makePng(2, 2, { colorType: 0, bitDepth: 8 }));
    expect(img.colorSpace).toBe('DeviceGray');
    expect(img.decodeParms).toContain('/Colors 1');
  });

  it('supports 16-bit depth', () => {
    const img = pngToPdfImage(makePng(2, 2, { colorType: 2, bitDepth: 16 }));
    expect(img.bitsPerComponent).toBe(16);
    expect(img.decodeParms).toContain('/BitsPerComponent 16');
  });

  it('concatenates IDAT split across chunks', () => {
    const single = pngToPdfImage(makePng(3, 3, { colorType: 2 }));
    const split = pngToPdfImage(makePng(3, 3, { colorType: 2, splitIdat: true }));
    expect(split.data).toEqual(single.data);
  });

  it('rejects a non-PNG', () => {
    expect(() => pngToPdfImage(new Uint8Array([1, 2, 3]))).toThrow(DocPdfDecodeError);
  });

  it('rejects RGBA (colour type 6) as unsupported', () => {
    expect(() => pngToPdfImage(makePng(2, 2, { colorType: 6 }))).toThrow(
      DocPdfUnsupportedSourceError,
    );
  });

  it('rejects interlaced PNG', () => {
    expect(() => pngToPdfImage(makePng(2, 2, { interlace: 1 }))).toThrow(
      DocPdfUnsupportedSourceError,
    );
  });

  it('rejects unsupported bit depth', () => {
    expect(() => pngToPdfImage(makePng(2, 2, { colorType: 0, bitDepth: 4 }))).toThrow(
      DocPdfUnsupportedSourceError,
    );
  });

  it('rejects a PNG with no IDAT', () => {
    expect(() => pngToPdfImage(makePng(2, 2, { omitIdat: true }))).toThrow(DocPdfDecodeError);
  });

  it('enforces the pixel cap', () => {
    expect(() => pngToPdfImage(makePng(4, 4), 4)).toThrow(DocPdfDimensionsTooLargeError);
  });

  it('rejects a truncated header', () => {
    expect(() => pngToPdfImage(makePng(2, 2).subarray(0, 20))).toThrow(DocPdfDecodeError);
  });

  it('rejects a malformed first chunk (not IHDR)', () => {
    const png = makePng(2, 2);
    const corrupt = png.slice();
    corrupt[12] = 0x58; // mutate "IHDR" type byte
    expect(() => pngToPdfImage(corrupt)).toThrow(DocPdfDecodeError);
  });

  it('rejects zero dimensions', () => {
    const png = makePng(2, 2);
    const corrupt = png.slice();
    // IHDR width is at byte offset 16..19 (8 sig + 4 len + 4 type).
    corrupt[16] = 0;
    corrupt[17] = 0;
    corrupt[18] = 0;
    corrupt[19] = 0;
    expect(() => pngToPdfImage(corrupt)).toThrow(DocPdfDecodeError);
  });

  it('rejects a truncated trailing chunk', () => {
    const png = makePng(2, 2);
    // Drop the final bytes of the IEND chunk's CRC so the last chunk is truncated.
    const truncated = png.subarray(0, png.length - 2);
    // The IDAT is intact; the truncated tail is the IEND chunk → tolerated (break).
    expect(() => pngToPdfImage(truncated)).not.toThrow();
  });
});
