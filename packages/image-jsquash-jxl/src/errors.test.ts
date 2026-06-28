/**
 * Tests for errors.ts — typed error classes.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  JxlDecodeError,
  JxlDimensionsTooLargeError,
  JxlEncodeError,
  JxlInputTooLargeError,
  JxlLoadError,
} from './errors.ts';

describe('JxlLoadError', () => {
  it('has code JXL_LOAD_FAILED and extends WebcvtError', () => {
    const err = new JxlLoadError('boom');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JXL_LOAD_FAILED');
    expect(err.name).toBe('JxlLoadError');
    expect(err.message).toBe('boom');
  });

  it('preserves cause', () => {
    const cause = new Error('inner');
    const err = new JxlLoadError('boom', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('JxlDecodeError', () => {
  it('has code JXL_DECODE_FAILED', () => {
    const err = new JxlDecodeError('bad');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JXL_DECODE_FAILED');
    expect(err.name).toBe('JxlDecodeError');
  });
});

describe('JxlEncodeError', () => {
  it('has code JXL_ENCODE_FAILED', () => {
    const err = new JxlEncodeError('bad');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JXL_ENCODE_FAILED');
    expect(err.name).toBe('JxlEncodeError');
  });
});

describe('JxlInputTooLargeError', () => {
  it('records actual and limit bytes and formats a MiB message', () => {
    const err = new JxlInputTooLargeError(300_000_000, 256 * 1024 * 1024);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JXL_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300_000_000);
    expect(err.limitBytes).toBe(256 * 1024 * 1024);
    expect(err.message).toContain('256 MiB');
  });
});

describe('JxlDimensionsTooLargeError', () => {
  it('computes pixels and records dimensions and limit', () => {
    const err = new JxlDimensionsTooLargeError(6000, 5000, 25_000_000);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('JXL_DIMENSIONS_TOO_LARGE');
    expect(err.width).toBe(6000);
    expect(err.height).toBe(5000);
    expect(err.pixels).toBe(30_000_000);
    expect(err.limitPixels).toBe(25_000_000);
  });
});
