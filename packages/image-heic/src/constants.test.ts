/**
 * Tests for constants.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  CANVAS_ENCODABLE_MIMES,
  HEIC_MIME,
  HEIF_MIME,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
} from './constants.ts';

describe('constants', () => {
  it('HEIC/HEIF mimes', () => {
    expect(HEIC_MIME).toBe('image/heic');
    expect(HEIF_MIME).toBe('image/heif');
  });

  it('limits', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_PIXELS).toBe(40_000_000);
  });

  it('canvas-encodable output set', () => {
    expect(CANVAS_ENCODABLE_MIMES.has('image/png')).toBe(true);
    expect(CANVAS_ENCODABLE_MIMES.has('image/jpeg')).toBe(true);
    expect(CANVAS_ENCODABLE_MIMES.has('image/webp')).toBe(true);
    expect(CANVAS_ENCODABLE_MIMES.has('image/heic')).toBe(false);
  });
});
