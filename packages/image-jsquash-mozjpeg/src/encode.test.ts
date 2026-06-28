/**
 * Tests for encode.ts — option resolution/clamping + encode path (mocked jsquash).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockEncode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { MozjpegDimensionsTooLargeError, MozjpegEncodeError } from './errors.ts';

vi.mock('@jsquash/jpeg', () => setupMockJsquash());

import { encodeMozjpeg, resolveOptions } from './encode.ts';
import { disposeMozjpeg } from './loader.ts';

beforeEach(() => {
  disposeMozjpeg();
  resetMockJsquash();
  vi.clearAllMocks();
});

function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('resolveOptions — defaults', () => {
  it('returns DEFAULT_ENCODE values when no options given', () => {
    const r = resolveOptions();
    expect(r.quality).toBe(DEFAULT_ENCODE.quality);
    expect(r.progressive).toBe(DEFAULT_ENCODE.progressive);
    expect(r.baseline).toBe(DEFAULT_ENCODE.baseline);
  });

  it('maps quality directly (no inversion)', () => {
    expect(resolveOptions({ quality: 90 }).quality).toBe(90);
  });
});

describe('resolveOptions — clamping & flags', () => {
  it('clamps quality to [0, 100]', () => {
    expect(resolveOptions({ quality: -5 }).quality).toBe(0);
    expect(resolveOptions({ quality: 250 }).quality).toBe(100);
  });

  it('rounds fractional quality', () => {
    expect(resolveOptions({ quality: 80.6 }).quality).toBe(81);
  });

  it('passes progressive and baseline through', () => {
    const r = resolveOptions({ progressive: true, baseline: true });
    expect(r.progressive).toBe(true);
    expect(r.baseline).toBe(true);
  });

  it('throws MozjpegEncodeError for non-finite quality', () => {
    expect(() => resolveOptions({ quality: Number.NaN })).toThrow(MozjpegEncodeError);
    expect(() => resolveOptions({ quality: Number.POSITIVE_INFINITY })).toThrow(MozjpegEncodeError);
  });
});

describe('encodeMozjpeg — success', () => {
  it('returns a Uint8Array from the mocked encoder', async () => {
    const result = await encodeMozjpeg(makeImageDataLike(8, 8));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('passes resolved options to jsquash encode', async () => {
    await encodeMozjpeg(makeImageDataLike(8, 8), { quality: 40, progressive: true });
    const [, opts] = mockEncode.mock.calls[0] as [ImageData, Record<string, unknown>];
    expect(opts.quality).toBe(40);
    expect(opts.progressive).toBe(true);
  });
});

describe('encodeMozjpeg — validation', () => {
  it('throws MozjpegDimensionsTooLargeError when pixel count exceeds MAX_PIXELS', async () => {
    const oversized = { data: new Uint8ClampedArray(4), width: 5001, height: 5001 } as ImageData;
    await expect(encodeMozjpeg(oversized)).rejects.toBeInstanceOf(MozjpegDimensionsTooLargeError);
  });

  it('throws MozjpegEncodeError when ImageData.data length mismatches dimensions', async () => {
    const corrupt = { data: new Uint8ClampedArray(10), width: 8, height: 8 } as ImageData;
    await expect(encodeMozjpeg(corrupt)).rejects.toBeInstanceOf(MozjpegEncodeError);
  });

  it('wraps a jsquash encode failure as MozjpegEncodeError', async () => {
    mockEncode.mockRejectedValueOnce(new Error('wasm OOM'));
    await expect(encodeMozjpeg(makeImageDataLike(4, 4))).rejects.toBeInstanceOf(MozjpegEncodeError);
  });

  it('accepts an image exactly at MAX_PIXELS', async () => {
    const data = new Uint8ClampedArray(5000 * 5000 * 4);
    const img = { data, width: 5000, height: 5000 } as ImageData;
    expect(await encodeMozjpeg(img)).toBeInstanceOf(Uint8Array);
    expect(MAX_PIXELS).toBe(25_000_000);
  });
});
