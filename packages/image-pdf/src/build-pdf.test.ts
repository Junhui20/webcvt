/**
 * Tests for build-pdf.ts — jpegToPdf (sync, no canvas) and imageDataToPdf
 * (async, uses CompressionStream). Both run in Node.
 */

import { describe, expect, it } from 'vitest';
import { makeImageData, makeJpegHeader } from './_test-helpers/fixtures.ts';
import { imageDataToPdf, jpegToPdf } from './build-pdf.ts';
import { PdfDimensionsTooLargeError, PdfUnsupportedSourceError } from './errors.ts';

const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('jpegToPdf', () => {
  it('wraps an RGB JPEG into a DCTDecode PDF with matching MediaBox', () => {
    const pdf = jpegToPdf(makeJpegHeader(100, 50, 3));
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s).toContain('/MediaBox [0 0 100 50]');
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/ColorSpace /DeviceRGB');
    expect(s).toContain('%%EOF');
  });

  it('uses DeviceGray for a 1-component JPEG', () => {
    const s = text(jpegToPdf(makeJpegHeader(20, 10, 1)));
    expect(s).toContain('/ColorSpace /DeviceGray');
  });

  it('rejects a CMYK (4-component) JPEG', () => {
    expect(() => jpegToPdf(makeJpegHeader(20, 10, 4))).toThrow(PdfUnsupportedSourceError);
  });

  it('enforces the pixel cap', () => {
    expect(() => jpegToPdf(makeJpegHeader(100, 100, 3), { maxPixels: 100 })).toThrow(
      PdfDimensionsTooLargeError,
    );
  });
});

describe('imageDataToPdf', () => {
  it('wraps opaque RGBA into a FlateDecode PDF with no soft mask', async () => {
    const pdf = await imageDataToPdf(makeImageData(8, 8, 255));
    const s = text(pdf);
    expect(s).toContain('/Filter /FlateDecode');
    expect(s).toContain('/ColorSpace /DeviceRGB');
    expect(s).toContain('/MediaBox [0 0 8 8]');
    expect(s).not.toContain('/SMask');
  });

  it('attaches a soft mask when the image has transparency', async () => {
    const pdf = await imageDataToPdf(makeImageData(8, 8, 128));
    expect(text(pdf)).toContain('/SMask 6 0 R');
  });

  it('enforces the pixel cap', async () => {
    await expect(imageDataToPdf(makeImageData(8, 8), { maxPixels: 10 })).rejects.toBeInstanceOf(
      PdfDimensionsTooLargeError,
    );
  });

  it('rejects ImageData whose byte length is inconsistent', async () => {
    const corrupt = { data: new Uint8ClampedArray(10), width: 8, height: 8 } as ImageData;
    await expect(imageDataToPdf(corrupt)).rejects.toBeInstanceOf(PdfUnsupportedSourceError);
  });
});
