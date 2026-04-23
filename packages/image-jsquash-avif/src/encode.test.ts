/**
 * Tests for encode.ts — mocks @jsquash/avif for fast unit tests.
 *
 * Option mapping note:
 * - Our quality (0-100) → jsquash cqLevel (0-62; lower=better quality)
 * - Our qualityAlpha (-1..100) → jsquash cqAlphaLevel (-1..62)
 * - speed and subsample are passed through directly
 * - bitDepth is v1-only validated (8 accepted, 10/12 rejected)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSolidRedImageData } from './_test-helpers/fixtures.ts';
import { mockEncode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { AvifDimensionsTooLargeError, AvifEncodeError } from './errors.ts';

vi.mock('@jsquash/avif', () => setupMockJsquash());

import { encodeAvif, resolveOptions } from './encode.ts';
import { disposeAvif } from './loader.ts';

beforeEach(() => {
  disposeAvif();
  resetMockJsquash();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolveOptions — quality → cqLevel mapping
// ---------------------------------------------------------------------------

describe('resolveOptions — quality clamping and mapping', () => {
  it('quality 100 maps to cqLevel 0 (best quality)', () => {
    const opts = resolveOptions({ quality: 100 });
    expect(opts.cqLevel).toBe(0);
  });

  it('quality 0 maps to cqLevel 62 (worst quality)', () => {
    const opts = resolveOptions({ quality: 0 });
    expect(opts.cqLevel).toBe(62);
  });

  it('quality 50 maps to cqLevel 31 (middle)', () => {
    const opts = resolveOptions({ quality: 50 });
    expect(opts.cqLevel).toBe(31);
  });

  it('clamps quality below 0 to 0 → cqLevel 62', () => {
    const opts = resolveOptions({ quality: -10 });
    expect(opts.cqLevel).toBe(62);
  });

  it('clamps quality above 100 to 100 → cqLevel 0', () => {
    const opts = resolveOptions({ quality: 150 });
    expect(opts.cqLevel).toBe(0);
  });

  it('uses default quality from DEFAULT_ENCODE when not specified → cqLevel 31', () => {
    const opts = resolveOptions();
    // DEFAULT_ENCODE.quality = 50 → cqLevel 31
    expect(opts.cqLevel).toBe(31);
    // MEDIUM-2 regression: verify the default matches DEFAULT_ENCODE constant
    expect(DEFAULT_ENCODE.quality).toBe(50);
  });
});

describe('resolveOptions — speed clamping', () => {
  it('clamps speed below 0 to 0', () => {
    const opts = resolveOptions({ speed: -5 });
    expect(opts.speed).toBe(0);
  });

  it('clamps speed above 10 to 10', () => {
    const opts = resolveOptions({ speed: 20 });
    expect(opts.speed).toBe(10);
  });

  it('uses default speed from DEFAULT_ENCODE when not specified', () => {
    const opts = resolveOptions();
    expect(opts.speed).toBe(DEFAULT_ENCODE.speed);
  });
});

describe('resolveOptions — subsample validation', () => {
  it('accepts valid subsample values 0, 1, 2, 3', () => {
    for (const s of [0, 1, 2, 3] as const) {
      expect(() => resolveOptions({ subsample: s })).not.toThrow();
    }
  });

  it('throws AvifEncodeError for invalid subsample', () => {
    expect(() => resolveOptions({ subsample: 4 as unknown as 0 })).toThrow(AvifEncodeError);
  });

  it('uses default subsample from DEFAULT_ENCODE when not specified', () => {
    const opts = resolveOptions();
    expect(opts.subsample).toBe(DEFAULT_ENCODE.subsample);
  });
});

describe('resolveOptions — qualityAlpha → cqAlphaLevel mapping', () => {
  it('qualityAlpha -1 maps to cqAlphaLevel -1 (use main quality)', () => {
    const opts = resolveOptions({ qualityAlpha: -1 });
    expect(opts.cqAlphaLevel).toBe(-1);
  });

  it('qualityAlpha 100 maps to cqAlphaLevel 0 (best alpha quality)', () => {
    const opts = resolveOptions({ qualityAlpha: 100 });
    expect(opts.cqAlphaLevel).toBe(0);
  });

  it('qualityAlpha 0 maps to cqAlphaLevel 62 (worst alpha quality)', () => {
    const opts = resolveOptions({ qualityAlpha: 0 });
    expect(opts.cqAlphaLevel).toBe(62);
  });

  it('clamps qualityAlpha below -1 to -1', () => {
    const opts = resolveOptions({ qualityAlpha: -50 });
    expect(opts.cqAlphaLevel).toBe(-1);
  });

  it('clamps qualityAlpha above 100 to 100 → cqAlphaLevel 0', () => {
    const opts = resolveOptions({ qualityAlpha: 200 });
    expect(opts.cqAlphaLevel).toBe(0);
  });

  it('uses default qualityAlpha from DEFAULT_ENCODE when not specified → cqAlphaLevel -1', () => {
    const opts = resolveOptions();
    expect(opts.cqAlphaLevel).toBe(-1);
    expect(DEFAULT_ENCODE.qualityAlpha).toBe(-1);
  });
});

describe('resolveOptions — bitDepth validation', () => {
  it('accepts bitDepth 8', () => {
    expect(() => resolveOptions({ bitDepth: 8 })).not.toThrow();
  });

  it('throws AvifEncodeError for bitDepth 10 (Trap §7)', () => {
    expect(() => resolveOptions({ bitDepth: 10 })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for bitDepth 12 (Trap §7)', () => {
    expect(() => resolveOptions({ bitDepth: 12 })).toThrow(AvifEncodeError);
  });

  it('error message for bitDepth 10 mentions Canvas', () => {
    const err = (() => {
      try {
        resolveOptions({ bitDepth: 10 });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AvifEncodeError);
    if (err instanceof AvifEncodeError) {
      expect(err.message).toContain('Canvas');
    }
  });
});

// ---------------------------------------------------------------------------
// HIGH-3 regression: clamp rejects non-finite values
// ---------------------------------------------------------------------------

describe('resolveOptions — HIGH-3 regression: NaN/Infinity rejected', () => {
  it('throws AvifEncodeError for quality = NaN', () => {
    expect(() => resolveOptions({ quality: Number.NaN })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for quality = Infinity', () => {
    expect(() => resolveOptions({ quality: Number.POSITIVE_INFINITY })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for quality = -Infinity', () => {
    expect(() => resolveOptions({ quality: Number.NEGATIVE_INFINITY })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for speed = NaN', () => {
    expect(() => resolveOptions({ speed: Number.NaN })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for speed = Infinity', () => {
    expect(() => resolveOptions({ speed: Number.POSITIVE_INFINITY })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for speed = -Infinity', () => {
    expect(() => resolveOptions({ speed: Number.NEGATIVE_INFINITY })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for qualityAlpha = NaN', () => {
    expect(() => resolveOptions({ qualityAlpha: Number.NaN })).toThrow(AvifEncodeError);
  });

  it('throws AvifEncodeError for qualityAlpha = Infinity', () => {
    expect(() => resolveOptions({ qualityAlpha: Number.POSITIVE_INFINITY })).toThrow(
      AvifEncodeError,
    );
  });

  it('throws AvifEncodeError for qualityAlpha = -Infinity', () => {
    expect(() => resolveOptions({ qualityAlpha: Number.NEGATIVE_INFINITY })).toThrow(
      AvifEncodeError,
    );
  });

  it('error message names the offending option', () => {
    const err = (() => {
      try {
        resolveOptions({ quality: Number.NaN });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AvifEncodeError);
    if (err instanceof AvifEncodeError) {
      expect(err.message).toContain('quality');
    }
  });
});

// ---------------------------------------------------------------------------
// HIGH-2 regression: encodeAvif validates ImageData before calling wasm
// ---------------------------------------------------------------------------

describe('encodeAvif — HIGH-2 regression: input validation', () => {
  it('throws AvifDimensionsTooLargeError for oversized ImageData (width×height > MAX_PIXELS)', async () => {
    // 5001×5001 = 25,010,001 > 25,000,000 (MAX_PIXELS)
    const data = new Uint8ClampedArray(5001 * 5001 * 4);
    const image = { data, width: 5001, height: 5001, colorSpace: 'srgb' } as ImageData;
    await expect(encodeAvif(image)).rejects.toBeInstanceOf(AvifDimensionsTooLargeError);
    // wasm encode must NOT have been called
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('throws AvifDimensionsTooLargeError for image exactly over MAX_PIXELS', async () => {
    // MAX_PIXELS + 1 pixel: use 1×(MAX_PIXELS+1) for simplicity
    const pixels = MAX_PIXELS + 1;
    const data = new Uint8ClampedArray(pixels * 4);
    const image = { data, width: pixels, height: 1, colorSpace: 'srgb' } as ImageData;
    await expect(encodeAvif(image)).rejects.toBeInstanceOf(AvifDimensionsTooLargeError);
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('throws AvifEncodeError for corrupted ImageData (data.byteLength mismatch)', async () => {
    // data is too short relative to width×height×4
    const data = new Uint8ClampedArray(10); // too short for 8×8
    const image = { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
    const err = await encodeAvif(image).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifEncodeError);
    if (err instanceof AvifEncodeError) {
      expect(err.message).toContain('byteLength');
    }
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('throws AvifEncodeError for corrupted ImageData (data.byteLength too large)', async () => {
    // data is too long relative to width×height×4
    const data = new Uint8ClampedArray(8 * 8 * 4 + 100); // extra bytes
    const image = { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
    const err = await encodeAvif(image).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifEncodeError);
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('accepts valid ImageData at exactly MAX_PIXELS', async () => {
    // 5000×5000 = 25,000,000 = MAX_PIXELS — must NOT throw
    const data = new Uint8ClampedArray(5000 * 5000 * 4);
    const image = { data, width: 5000, height: 5000, colorSpace: 'srgb' } as ImageData;
    const result = await encodeAvif(image);
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// encodeAvif — success path
// ---------------------------------------------------------------------------

describe('encodeAvif — success path', () => {
  it('returns Uint8Array from mock (ArrayBuffer wrapped)', async () => {
    const image = makeSolidRedImageData();
    const result = await encodeAvif(image);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('delegates to @jsquash/avif encode with cqLevel', async () => {
    const image = makeSolidRedImageData();
    await encodeAvif(image, { quality: 75, speed: 8 });
    expect(mockEncode).toHaveBeenCalledOnce();
    const [calledImage, calledOpts] = mockEncode.mock.calls[0] as [
      ImageData,
      Record<string, number>,
    ];
    expect(calledImage).toBe(image);
    // quality 75 → cqLevel = round((1 - 75/100) * 62) = round(0.25 * 62) = round(15.5) = 16
    expect(calledOpts.cqLevel).toBe(16);
    expect(calledOpts.speed).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// encodeAvif — error propagation
// ---------------------------------------------------------------------------

describe('encodeAvif — error propagation', () => {
  it('wraps jsquash encode error as AvifEncodeError', async () => {
    mockEncode.mockRejectedValueOnce(new Error('wasm OOM'));
    const image = makeSolidRedImageData();
    await expect(encodeAvif(image)).rejects.toBeInstanceOf(AvifEncodeError);
  });

  it('preserves original error as cause', async () => {
    const original = new Error('wasm OOM');
    mockEncode.mockRejectedValueOnce(original);
    const err = await encodeAvif(makeSolidRedImageData()).catch((e: unknown) => e);
    if (err instanceof AvifEncodeError) {
      expect(err.cause).toBe(original);
    }
  });

  // LOW-4 regression: error message must not embed raw jsquash message
  it('LOW-4 regression: uses generic error message, not raw jsquash message', async () => {
    const original = new Error('/node_modules/@jsquash/avif/path/encode.js: OOM');
    mockEncode.mockRejectedValueOnce(original);
    const err = await encodeAvif(makeSolidRedImageData()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifEncodeError);
    if (err instanceof AvifEncodeError) {
      expect(err.message).not.toContain('/node_modules');
      expect(err.message).toContain('error.cause');
      expect(err.cause).toBe(original);
    }
  });
});

// ---------------------------------------------------------------------------
// encodeAvif — default options (MEDIUM-2: use DEFAULT_ENCODE as source of truth)
// ---------------------------------------------------------------------------

describe('encodeAvif — default options', () => {
  it('uses defaults when no options provided', async () => {
    const image = makeSolidRedImageData();
    await encodeAvif(image);
    const [, calledOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, number>];
    // quality 50 → cqLevel 31, speed 6, subsample 1, qualityAlpha -1 → cqAlphaLevel -1
    expect(calledOpts.cqLevel).toBe(31);
    expect(calledOpts.speed).toBe(6);
    expect(calledOpts.subsample).toBe(1);
    expect(calledOpts.cqAlphaLevel).toBe(-1);
  });

  // MEDIUM-2 regression: defaults must match DEFAULT_ENCODE constant, not hardcoded values
  it('MEDIUM-2 regression: defaults match DEFAULT_ENCODE constant', async () => {
    const image = makeSolidRedImageData();
    await encodeAvif(image);
    const [, calledOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, number>];
    // Derive expected cqLevel from DEFAULT_ENCODE.quality
    const expectedCqLevel = Math.round((1 - DEFAULT_ENCODE.quality / 100) * 62);
    expect(calledOpts.cqLevel).toBe(expectedCqLevel);
    expect(calledOpts.speed).toBe(DEFAULT_ENCODE.speed);
    expect(calledOpts.subsample).toBe(DEFAULT_ENCODE.subsample);
  });
});
