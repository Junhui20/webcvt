/**
 * Tests for errors.ts — typed error classes.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  HeicDecodeError,
  HeicDimensionsTooLargeError,
  HeicEncodeError,
  HeicInputTooLargeError,
  HeicLoadError,
} from './errors.ts';

describe('HEIC error classes', () => {
  it('HeicLoadError has code HEIC_LOAD_FAILED and extends WebcvtError', () => {
    const err = new HeicLoadError('boom');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('HEIC_LOAD_FAILED');
    expect(err.name).toBe('HeicLoadError');
  });

  it('HeicDecodeError has code HEIC_DECODE_FAILED and preserves cause', () => {
    const cause = new Error('inner');
    const err = new HeicDecodeError('bad', { cause });
    expect(err.code).toBe('HEIC_DECODE_FAILED');
    expect(err.cause).toBe(cause);
  });

  it('HeicEncodeError has code HEIC_ENCODE_FAILED', () => {
    expect(new HeicEncodeError('x').code).toBe('HEIC_ENCODE_FAILED');
  });

  it('HeicInputTooLargeError records bytes + MiB message', () => {
    const err = new HeicInputTooLargeError(300_000_000, 256 * 1024 * 1024);
    expect(err.code).toBe('HEIC_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300_000_000);
    expect(err.message).toContain('256 MiB');
  });

  it('HeicDimensionsTooLargeError computes pixels', () => {
    const err = new HeicDimensionsTooLargeError(8000, 6000, 40_000_000);
    expect(err.code).toBe('HEIC_DIMENSIONS_TOO_LARGE');
    expect(err.pixels).toBe(48_000_000);
    expect(err.limitPixels).toBe(40_000_000);
  });
});
