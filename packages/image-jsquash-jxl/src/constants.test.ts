/**
 * Tests for constants.ts.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ENCODE, JXL_MIME, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';

describe('constants', () => {
  it('JXL_MIME is image/jxl', () => {
    expect(JXL_MIME).toBe('image/jxl');
  });

  it('MAX_INPUT_BYTES is 256 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
  });

  it('MAX_PIXELS is 25 million', () => {
    expect(MAX_PIXELS).toBe(25_000_000);
  });

  it('DEFAULT_ENCODE has sensible defaults', () => {
    expect(DEFAULT_ENCODE.quality).toBe(75);
    expect(DEFAULT_ENCODE.effort).toBe(7);
    expect(DEFAULT_ENCODE.lossless).toBe(false);
    expect(DEFAULT_ENCODE.progressive).toBe(false);
  });
});
