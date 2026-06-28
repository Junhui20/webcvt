/**
 * Tests for constants.ts.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ENCODE, MAX_INPUT_BYTES, MAX_PIXELS, MOZJPEG_MIME } from './constants.ts';

describe('constants', () => {
  it('MOZJPEG_MIME is image/jpeg', () => {
    expect(MOZJPEG_MIME).toBe('image/jpeg');
  });

  it('MAX_INPUT_BYTES is 256 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(256 * 1024 * 1024);
  });

  it('MAX_PIXELS is 25 million', () => {
    expect(MAX_PIXELS).toBe(25_000_000);
  });

  it('DEFAULT_ENCODE has sensible defaults', () => {
    expect(DEFAULT_ENCODE.quality).toBe(75);
    expect(DEFAULT_ENCODE.progressive).toBe(false);
    expect(DEFAULT_ENCODE.baseline).toBe(false);
  });
});
