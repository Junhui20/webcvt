/**
 * Tests for errors.ts — typed error classes.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegEncodeError,
  MozjpegInputTooLargeError,
  MozjpegLoadError,
} from './errors.ts';

describe('MozjpegLoadError', () => {
  it('has code MOZJPEG_LOAD_FAILED and extends WebcvtError', () => {
    const err = new MozjpegLoadError('boom');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('MOZJPEG_LOAD_FAILED');
    expect(err.name).toBe('MozjpegLoadError');
  });

  it('preserves cause', () => {
    const cause = new Error('inner');
    expect(new MozjpegLoadError('boom', { cause }).cause).toBe(cause);
  });
});

describe('MozjpegDecodeError', () => {
  it('has code MOZJPEG_DECODE_FAILED', () => {
    const err = new MozjpegDecodeError('bad');
    expect(err.code).toBe('MOZJPEG_DECODE_FAILED');
    expect(err.name).toBe('MozjpegDecodeError');
  });
});

describe('MozjpegEncodeError', () => {
  it('has code MOZJPEG_ENCODE_FAILED', () => {
    const err = new MozjpegEncodeError('bad');
    expect(err.code).toBe('MOZJPEG_ENCODE_FAILED');
    expect(err.name).toBe('MozjpegEncodeError');
  });
});

describe('MozjpegInputTooLargeError', () => {
  it('records actual and limit bytes and formats a MiB message', () => {
    const err = new MozjpegInputTooLargeError(300_000_000, 256 * 1024 * 1024);
    expect(err.code).toBe('MOZJPEG_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300_000_000);
    expect(err.limitBytes).toBe(256 * 1024 * 1024);
    expect(err.message).toContain('256 MiB');
  });
});

describe('MozjpegDimensionsTooLargeError', () => {
  it('computes pixels and records dimensions and limit', () => {
    const err = new MozjpegDimensionsTooLargeError(6000, 5000, 25_000_000);
    expect(err.code).toBe('MOZJPEG_DIMENSIONS_TOO_LARGE');
    expect(err.pixels).toBe(30_000_000);
    expect(err.limitPixels).toBe(25_000_000);
  });
});
