/**
 * Tests for constants.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  CANVAS_SOURCE_MIMES,
  JPEG_MIME,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  PDF_MIME,
  SUPPORTED_SOURCE_MIMES,
} from './constants.ts';

describe('constants', () => {
  it('PDF_MIME and JPEG_MIME are correct', () => {
    expect(PDF_MIME).toBe('application/pdf');
    expect(JPEG_MIME).toBe('image/jpeg');
  });

  it('limits are 256 MiB and 25 MP', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_PIXELS).toBe(25_000_000);
  });

  it('SUPPORTED_SOURCE_MIMES includes jpeg + the canvas formats', () => {
    expect(SUPPORTED_SOURCE_MIMES.has('image/jpeg')).toBe(true);
    expect(SUPPORTED_SOURCE_MIMES.has('image/png')).toBe(true);
    expect(SUPPORTED_SOURCE_MIMES.has('image/webp')).toBe(true);
  });

  it('CANVAS_SOURCE_MIMES excludes jpeg', () => {
    expect(CANVAS_SOURCE_MIMES.has('image/jpeg')).toBe(false);
    expect(CANVAS_SOURCE_MIMES.has('image/png')).toBe(true);
  });
});
