/**
 * Tests for errors.ts — typed error classes.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  PdfDecodeError,
  PdfDimensionsTooLargeError,
  PdfEncodeError,
  PdfInputTooLargeError,
  PdfUnsupportedSourceError,
} from './errors.ts';

describe('PDF error classes', () => {
  it('PdfEncodeError has code PDF_ENCODE_FAILED', () => {
    const err = new PdfEncodeError('boom');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('PDF_ENCODE_FAILED');
    expect(err.name).toBe('PdfEncodeError');
  });

  it('PdfDecodeError has code PDF_DECODE_FAILED', () => {
    expect(new PdfDecodeError('bad').code).toBe('PDF_DECODE_FAILED');
  });

  it('PdfUnsupportedSourceError has code PDF_UNSUPPORTED_SOURCE', () => {
    expect(new PdfUnsupportedSourceError('nope').code).toBe('PDF_UNSUPPORTED_SOURCE');
  });

  it('PdfInputTooLargeError records bytes and formats a MiB message', () => {
    const err = new PdfInputTooLargeError(300_000_000, 256 * 1024 * 1024);
    expect(err.code).toBe('PDF_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300_000_000);
    expect(err.message).toContain('256 MiB');
  });

  it('PdfDimensionsTooLargeError computes pixels', () => {
    const err = new PdfDimensionsTooLargeError(6000, 5000, 25_000_000);
    expect(err.code).toBe('PDF_DIMENSIONS_TOO_LARGE');
    expect(err.pixels).toBe(30_000_000);
  });
});
