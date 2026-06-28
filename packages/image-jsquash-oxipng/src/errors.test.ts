/**
 * Tests for errors.ts — typed error classes.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  OxipngDecodeError,
  OxipngDimensionsTooLargeError,
  OxipngInputTooLargeError,
  OxipngLoadError,
  OxipngOptimiseError,
} from './errors.ts';

describe('OxipngLoadError', () => {
  it('has code OXIPNG_LOAD_FAILED and extends WebcvtError', () => {
    const err = new OxipngLoadError('boom');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.code).toBe('OXIPNG_LOAD_FAILED');
    expect(err.name).toBe('OxipngLoadError');
  });

  it('preserves cause', () => {
    const cause = new Error('inner');
    expect(new OxipngLoadError('boom', { cause }).cause).toBe(cause);
  });
});

describe('OxipngOptimiseError', () => {
  it('has code OXIPNG_OPTIMISE_FAILED', () => {
    expect(new OxipngOptimiseError('bad').code).toBe('OXIPNG_OPTIMISE_FAILED');
  });
});

describe('OxipngDecodeError', () => {
  it('has code OXIPNG_DECODE_FAILED', () => {
    expect(new OxipngDecodeError('bad').code).toBe('OXIPNG_DECODE_FAILED');
  });
});

describe('OxipngInputTooLargeError', () => {
  it('records actual and limit bytes and formats a MiB message', () => {
    const err = new OxipngInputTooLargeError(300_000_000, 256 * 1024 * 1024);
    expect(err.code).toBe('OXIPNG_INPUT_TOO_LARGE');
    expect(err.actualBytes).toBe(300_000_000);
    expect(err.message).toContain('256 MiB');
  });
});

describe('OxipngDimensionsTooLargeError', () => {
  it('computes pixels and records limit', () => {
    const err = new OxipngDimensionsTooLargeError(6000, 5000, 25_000_000);
    expect(err.code).toBe('OXIPNG_DIMENSIONS_TOO_LARGE');
    expect(err.pixels).toBe(30_000_000);
    expect(err.limitPixels).toBe(25_000_000);
  });
});
