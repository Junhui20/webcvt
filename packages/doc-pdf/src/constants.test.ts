import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCER,
  JPEG_MIME,
  JSON_MIME,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  MAX_PDF_OBJECTS,
  MAX_PIXELS,
  MAX_PNG_CHUNKS,
  PDF_MIME,
  PNG_MIME,
} from './constants.ts';

describe('constants', () => {
  it('exposes the documented caps and identifiers', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_PAGES).toBe(10_000);
    expect(MAX_PIXELS).toBe(25_000_000);
    expect(MAX_PDF_OBJECTS).toBe(1_000_000);
    expect(MAX_PNG_CHUNKS).toBe(100_000);
    expect(PDF_MIME).toBe('application/pdf');
    expect(JSON_MIME).toBe('application/json');
    expect(JPEG_MIME).toBe('image/jpeg');
    expect(PNG_MIME).toBe('image/png');
    expect(DEFAULT_PRODUCER).toBe('webcvt-doc-pdf');
  });
});
