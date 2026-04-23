/**
 * Tests for errors.ts — verifies all 5 error subclasses extend WebcvtError
 * correctly and expose the expected fields.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  AvifDecodeError,
  AvifDimensionsTooLargeError,
  AvifEncodeError,
  AvifInputTooLargeError,
  AvifLoadError,
} from './errors.ts';

describe('AvifLoadError', () => {
  it('extends WebcvtError', () => {
    const err = new AvifLoadError('test');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(AvifLoadError);
  });

  it('sets name and code', () => {
    const err = new AvifLoadError('failed to load');
    expect(err.name).toBe('AvifLoadError');
    expect(err.code).toBe('AVIF_LOAD_FAILED');
    expect(err.message).toBe('failed to load');
  });

  it('preserves cause option', () => {
    const cause = new Error('network');
    const err = new AvifLoadError('failed', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('AvifDecodeError', () => {
  it('extends WebcvtError', () => {
    expect(new AvifDecodeError('x')).toBeInstanceOf(WebcvtError);
  });

  it('sets name and code', () => {
    const err = new AvifDecodeError('bad data');
    expect(err.name).toBe('AvifDecodeError');
    expect(err.code).toBe('AVIF_DECODE_FAILED');
  });
});

describe('AvifEncodeError', () => {
  it('extends WebcvtError', () => {
    expect(new AvifEncodeError('x')).toBeInstanceOf(WebcvtError);
  });

  it('sets name and code', () => {
    const err = new AvifEncodeError('encode failed');
    expect(err.name).toBe('AvifEncodeError');
    expect(err.code).toBe('AVIF_ENCODE_FAILED');
  });
});

describe('AvifInputTooLargeError', () => {
  it('extends WebcvtError', () => {
    expect(new AvifInputTooLargeError(300, 256)).toBeInstanceOf(WebcvtError);
  });

  it('sets name, code, and exposes byte counts', () => {
    const err = new AvifInputTooLargeError(300 * 1024 * 1024, 256 * 1024 * 1024);
    expect(err.name).toBe('AvifInputTooLargeError');
    expect(err.code).toBe('AVIF_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300 * 1024 * 1024);
    expect(err.limitBytes).toBe(256 * 1024 * 1024);
    expect(err.message).toContain('256 MiB');
  });
});

describe('AvifDimensionsTooLargeError', () => {
  it('extends WebcvtError', () => {
    expect(new AvifDimensionsTooLargeError(10000, 10001, 100_000_000)).toBeInstanceOf(WebcvtError);
  });

  it('sets name, code, and exposes dimension fields', () => {
    const err = new AvifDimensionsTooLargeError(10000, 10001, 100_000_000);
    expect(err.name).toBe('AvifDimensionsTooLargeError');
    expect(err.code).toBe('AVIF_DIMENSIONS_TOO_LARGE');
    expect(err.width).toBe(10000);
    expect(err.height).toBe(10001);
    expect(err.pixels).toBe(10000 * 10001);
    expect(err.limitPixels).toBe(100_000_000);
    expect(err.message).toContain('10000×10001');
  });
});
