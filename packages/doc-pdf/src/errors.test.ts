import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  DocPdfDecodeError,
  DocPdfDimensionsTooLargeError,
  DocPdfInputTooLargeError,
  DocPdfNoImagesError,
  DocPdfParseError,
  DocPdfTooManyPagesError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';

describe('errors', () => {
  it('all subclasses extend WebcvtError with UPPER_SNAKE codes', () => {
    const all = [
      new DocPdfInputTooLargeError(10, 5),
      new DocPdfNoImagesError(),
      new DocPdfTooManyPagesError(11, 10),
      new DocPdfDimensionsTooLargeError(4, 4, 8),
      new DocPdfDecodeError('bad'),
      new DocPdfUnsupportedSourceError('nope'),
      new DocPdfParseError('huh'),
    ];
    for (const err of all) {
      expect(err).toBeInstanceOf(WebcvtError);
      expect(err.code).toMatch(/^[A-Z_]+$/);
      expect(err.name).not.toBe('WebcvtError');
    }
  });

  it('carries structured fields', () => {
    const big = new DocPdfInputTooLargeError(100, 50);
    expect(big.code).toBe('DOC_PDF_INPUT_TOO_LARGE');
    expect(big.actualBytes).toBe(100);
    expect(big.limitBytes).toBe(50);

    const pages = new DocPdfTooManyPagesError(11, 10);
    expect(pages.code).toBe('DOC_PDF_TOO_MANY_PAGES');
    expect(pages.count).toBe(11);
    expect(pages.limit).toBe(10);

    const dims = new DocPdfDimensionsTooLargeError(4, 4, 8);
    expect(dims.code).toBe('DOC_PDF_DIMENSIONS_TOO_LARGE');
    expect(dims.pixels).toBe(16);
    expect(dims.limitPixels).toBe(8);
  });

  it('preserves the error cause chain', () => {
    const root = new Error('root');
    const wrapped = new DocPdfDecodeError('wrap', { cause: root });
    expect(wrapped.cause).toBe(root);
  });
});
