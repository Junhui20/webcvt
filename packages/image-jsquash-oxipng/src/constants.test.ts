/**
 * Tests for constants.ts.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, MAX_INPUT_BYTES, MAX_PIXELS, OXIPNG_MIME } from './constants.ts';

describe('constants', () => {
  it('OXIPNG_MIME is image/png', () => {
    expect(OXIPNG_MIME).toBe('image/png');
  });

  it('MAX_INPUT_BYTES is 256 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
  });

  it('MAX_PIXELS is 25 million', () => {
    expect(MAX_PIXELS).toBe(25_000_000);
  });

  it('DEFAULT_OPTIONS matches @jsquash/oxipng defaults', () => {
    expect(DEFAULT_OPTIONS.level).toBe(2);
    expect(DEFAULT_OPTIONS.interlace).toBe(false);
    expect(DEFAULT_OPTIONS.optimiseAlpha).toBe(false);
  });
});
