/**
 * Tests for encode.ts — option resolution/clamping + encode path (mocked jsquash).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockEncode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { JxlDimensionsTooLargeError, JxlEncodeError } from './errors.ts';

vi.mock('@jsquash/jxl', () => setupMockJsquash());

import { encodeJxl, resolveOptions } from './encode.ts';
import { disposeJxl } from './loader.ts';

beforeEach(() => {
  disposeJxl();
  resetMockJsquash();
  vi.clearAllMocks();
});

/** Creates a valid 8-bit RGBA ImageData-compatible object. */
function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

// ---------------------------------------------------------------------------
// resolveOptions
// ---------------------------------------------------------------------------

describe('resolveOptions — defaults', () => {
  it('returns DEFAULT_ENCODE values when no options given', () => {
    const r = resolveOptions();
    expect(r.quality).toBe(DEFAULT_ENCODE.quality);
    expect(r.effort).toBe(DEFAULT_ENCODE.effort);
    expect(r.lossless).toBe(DEFAULT_ENCODE.lossless);
    expect(r.progressive).toBe(DEFAULT_ENCODE.progressive);
  });

  it('maps our quality directly to jsquash quality (no inversion)', () => {
    expect(resolveOptions({ quality: 90 }).quality).toBe(90);
    expect(resolveOptions({ quality: 10 }).quality).toBe(10);
  });
});

describe('resolveOptions — clamping', () => {
  it('clamps quality to [0, 100]', () => {
    expect(resolveOptions({ quality: -5 }).quality).toBe(0);
    expect(resolveOptions({ quality: 250 }).quality).toBe(100);
  });

  it('clamps effort to [1, 9]', () => {
    expect(resolveOptions({ effort: 0 }).effort).toBe(1);
    expect(resolveOptions({ effort: 99 }).effort).toBe(9);
  });

  it('rounds fractional numeric options', () => {
    expect(resolveOptions({ quality: 80.6 }).quality).toBe(81);
    expect(resolveOptions({ effort: 4.4 }).effort).toBe(4);
  });

  it('passes lossless and progressive through', () => {
    const r = resolveOptions({ lossless: true, progressive: true });
    expect(r.lossless).toBe(true);
    expect(r.progressive).toBe(true);
  });
});

describe('resolveOptions — invalid numeric options', () => {
  it('throws JxlEncodeError for non-finite quality', () => {
    expect(() => resolveOptions({ quality: Number.NaN })).toThrow(JxlEncodeError);
    expect(() => resolveOptions({ quality: Number.POSITIVE_INFINITY })).toThrow(JxlEncodeError);
  });

  it('throws JxlEncodeError for non-finite effort', () => {
    expect(() => resolveOptions({ effort: Number.NaN })).toThrow(JxlEncodeError);
  });
});

// ---------------------------------------------------------------------------
// encodeJxl
// ---------------------------------------------------------------------------

describe('encodeJxl — success', () => {
  it('returns a Uint8Array from the mocked encoder', async () => {
    const result = await encodeJxl(makeImageDataLike(8, 8));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('passes resolved options to jsquash encode', async () => {
    await encodeJxl(makeImageDataLike(8, 8), { quality: 40, effort: 3 });
    expect(mockEncode).toHaveBeenCalledOnce();
    const [, opts] = mockEncode.mock.calls[0] as [ImageData, Record<string, unknown>];
    expect(opts.quality).toBe(40);
    expect(opts.effort).toBe(3);
  });
});

describe('encodeJxl — validation', () => {
  it('throws JxlDimensionsTooLargeError when pixel count exceeds MAX_PIXELS', async () => {
    const oversized = { data: new Uint8ClampedArray(4), width: 5001, height: 5001 } as ImageData;
    await expect(encodeJxl(oversized)).rejects.toBeInstanceOf(JxlDimensionsTooLargeError);
  });

  it('throws JxlEncodeError when ImageData.data length does not match dimensions', async () => {
    const corrupt = { data: new Uint8ClampedArray(10), width: 8, height: 8 } as ImageData;
    await expect(encodeJxl(corrupt)).rejects.toBeInstanceOf(JxlEncodeError);
  });

  it('wraps a jsquash encode failure as JxlEncodeError', async () => {
    mockEncode.mockRejectedValueOnce(new Error('wasm OOM'));
    const err = await encodeJxl(makeImageDataLike(4, 4)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JxlEncodeError);
    if (err instanceof JxlEncodeError) {
      expect(err.message).toContain('error.cause');
    }
  });

  it('accepts an image exactly at MAX_PIXELS', async () => {
    // 5000×5000 = MAX_PIXELS; data length must match width*height*4
    const data = new Uint8ClampedArray(5000 * 5000 * 4);
    const img = { data, width: 5000, height: 5000 } as ImageData;
    const result = await encodeJxl(img);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(MAX_PIXELS).toBe(25_000_000);
  });
});
