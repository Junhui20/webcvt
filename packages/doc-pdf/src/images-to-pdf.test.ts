import { describe, expect, it } from 'vitest';
import { makeJpegHeader, makePng } from './_test-helpers/fixtures.ts';
import { JPEG_MIME, PNG_MIME } from './constants.ts';
import {
  DocPdfDimensionsTooLargeError,
  DocPdfInputTooLargeError,
  DocPdfNoImagesError,
  DocPdfTooManyPagesError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';
import { imagesToPdf } from './images-to-pdf.ts';
import { parsePdfInfo } from './pdf-info.ts';

const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('imagesToPdf', () => {
  it('builds a multi-page PDF whose parsePdfInfo reports the right page count', () => {
    const pdf = imagesToPdf([
      { bytes: makeJpegHeader(100, 50, 3), mime: JPEG_MIME },
      { bytes: makePng(8, 8, { colorType: 2 }), mime: PNG_MIME },
      { bytes: makeJpegHeader(40, 40, 1), mime: JPEG_MIME },
    ]);
    const info = parsePdfInfo(pdf);
    expect(info.version).toBe('1.7');
    expect(info.pageCount).toBe(3);
    expect(info.producer).toBe('webcvt-doc-pdf');
  });

  it('embeds JPEG via DCTDecode and PNG via FlateDecode + predictor', () => {
    const s = text(
      imagesToPdf([
        { bytes: makeJpegHeader(10, 10, 3), mime: JPEG_MIME },
        { bytes: makePng(4, 4, { colorType: 0 }), mime: PNG_MIME },
      ]),
    );
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/Filter /FlateDecode /DecodeParms << /Predictor 15');
    expect(s).toContain('/ColorSpace /DeviceGray');
  });

  it('dispatches on the content signature even with a wrong/blank MIME', () => {
    const pdf = imagesToPdf([{ bytes: makePng(2, 2), mime: 'application/octet-stream' }]);
    expect(parsePdfInfo(pdf).pageCount).toBe(1);
  });

  it('honours a custom producer', () => {
    const pdf = imagesToPdf([{ bytes: makeJpegHeader(5, 5, 3), mime: JPEG_MIME }], {
      producer: 'comic-pipeline',
    });
    expect(parsePdfInfo(pdf).producer).toBe('comic-pipeline');
  });

  it('rejects an empty image list', () => {
    expect(() => imagesToPdf([])).toThrow(DocPdfNoImagesError);
  });

  it('enforces the page cap', () => {
    const images = [
      { bytes: makeJpegHeader(5, 5, 3), mime: JPEG_MIME },
      { bytes: makeJpegHeader(5, 5, 3), mime: JPEG_MIME },
    ];
    expect(() => imagesToPdf(images, { maxPages: 1 })).toThrow(DocPdfTooManyPagesError);
  });

  it('enforces the cumulative input-bytes cap', () => {
    const images = [{ bytes: makeJpegHeader(5, 5, 3), mime: JPEG_MIME }];
    expect(() => imagesToPdf(images, { maxInputBytes: 4 })).toThrow(DocPdfInputTooLargeError);
  });

  it('enforces the per-image pixel cap', () => {
    const images = [{ bytes: makeJpegHeader(100, 100, 3), mime: JPEG_MIME }];
    expect(() => imagesToPdf(images, { maxPixels: 100 })).toThrow(DocPdfDimensionsTooLargeError);
  });

  it('rejects an unsupported source format', () => {
    expect(() =>
      imagesToPdf([{ bytes: new Uint8Array([0x42, 0x4d, 0, 0]), mime: 'image/bmp' }]),
    ).toThrow(DocPdfUnsupportedSourceError);
  });

  it('rejects a CMYK (4-component) JPEG', () => {
    expect(() => imagesToPdf([{ bytes: makeJpegHeader(10, 10, 4), mime: JPEG_MIME }])).toThrow(
      DocPdfUnsupportedSourceError,
    );
  });

  it('wraps a malformed JPEG as a decode error', () => {
    expect(() =>
      imagesToPdf([{ bytes: new Uint8Array([0xff, 0xd8, 0x00]), mime: JPEG_MIME }]),
    ).toThrow(/Invalid JPEG/);
  });
});
