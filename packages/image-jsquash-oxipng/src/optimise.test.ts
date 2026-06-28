/**
 * Tests for optimise.ts — option resolution + the optimise/encode path (mocked jsquash).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockOptimise, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { DEFAULT_OPTIONS, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import {
  OxipngDimensionsTooLargeError,
  OxipngInputTooLargeError,
  OxipngOptimiseError,
} from './errors.ts';

vi.mock('@jsquash/oxipng', () => setupMockJsquash());

import { disposeOxipng } from './loader.ts';
import { optimisePng, resolveOptions } from './optimise.ts';

beforeEach(() => {
  disposeOxipng();
  resetMockJsquash();
  vi.clearAllMocks();
});

function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('resolveOptions', () => {
  it('returns DEFAULT_OPTIONS when no options given', () => {
    const r = resolveOptions();
    expect(r.level).toBe(DEFAULT_OPTIONS.level);
    expect(r.interlace).toBe(DEFAULT_OPTIONS.interlace);
    expect(r.optimiseAlpha).toBe(DEFAULT_OPTIONS.optimiseAlpha);
  });

  it('clamps level to [0, 6] and rounds', () => {
    expect(resolveOptions({ level: -1 }).level).toBe(0);
    expect(resolveOptions({ level: 99 }).level).toBe(6);
    expect(resolveOptions({ level: 3.6 }).level).toBe(4);
  });

  it('passes interlace and optimiseAlpha through', () => {
    const r = resolveOptions({ interlace: true, optimiseAlpha: true });
    expect(r.interlace).toBe(true);
    expect(r.optimiseAlpha).toBe(true);
  });

  it('throws OxipngOptimiseError for a non-finite level', () => {
    expect(() => resolveOptions({ level: Number.NaN })).toThrow(OxipngOptimiseError);
  });
});

describe('optimisePng — byte (PNG → PNG) path', () => {
  it('returns a Uint8Array from the mocked optimiser', async () => {
    const result = await optimisePng(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('accepts an ArrayBuffer and forwards an ArrayBuffer to jsquash', async () => {
    await optimisePng(new ArrayBuffer(16));
    const [data] = mockOptimise.mock.calls[0] as [unknown];
    expect(data).toBeInstanceOf(ArrayBuffer);
  });

  it('throws OxipngInputTooLargeError when bytes exceed MAX_INPUT_BYTES', async () => {
    const fakeBytes = {
      byteLength: MAX_INPUT_BYTES + 1,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    // mark it as a Uint8Array instance for the isBytes() branch
    Object.setPrototypeOf(fakeBytes, Uint8Array.prototype);
    await expect(optimisePng(fakeBytes)).rejects.toBeInstanceOf(OxipngInputTooLargeError);
  });

  it('forwards resolved options to jsquash optimise', async () => {
    await optimisePng(new Uint8Array([1, 2, 3]), { level: 5, interlace: true });
    const [, opts] = mockOptimise.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(opts.level).toBe(5);
    expect(opts.interlace).toBe(true);
  });
});

describe('optimisePng — ImageData (raw pixels → PNG) path', () => {
  it('encodes ImageData and forwards ImageData to jsquash', async () => {
    const img = makeImageDataLike(8, 8);
    const result = await optimisePng(img);
    expect(result).toBeInstanceOf(Uint8Array);
    const [data] = mockOptimise.mock.calls[0] as [unknown];
    expect(data).toBe(img);
  });

  it('throws OxipngDimensionsTooLargeError when pixels exceed MAX_PIXELS', async () => {
    const oversized = { data: new Uint8ClampedArray(4), width: 5001, height: 5001 } as ImageData;
    await expect(optimisePng(oversized)).rejects.toBeInstanceOf(OxipngDimensionsTooLargeError);
  });

  it('throws OxipngOptimiseError when ImageData.data length mismatches dimensions', async () => {
    const corrupt = { data: new Uint8ClampedArray(10), width: 8, height: 8 } as ImageData;
    await expect(optimisePng(corrupt)).rejects.toBeInstanceOf(OxipngOptimiseError);
  });

  it('accepts an ImageData at exactly MAX_PIXELS', async () => {
    const data = new Uint8ClampedArray(5000 * 5000 * 4);
    const img = { data, width: 5000, height: 5000 } as ImageData;
    expect(await optimisePng(img)).toBeInstanceOf(Uint8Array);
    expect(MAX_PIXELS).toBe(25_000_000);
  });
});

describe('optimisePng — error wrapping', () => {
  it('wraps a jsquash optimise failure as OxipngOptimiseError', async () => {
    mockOptimise.mockRejectedValueOnce(new Error('wasm OOM'));
    const err = await optimisePng(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OxipngOptimiseError);
    if (err instanceof OxipngOptimiseError) {
      expect(err.message).toContain('error.cause');
    }
  });
});
