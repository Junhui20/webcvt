/**
 * Tests for decode.ts — mocks libheif-js for fast, deterministic unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeFakeImage,
  mockDecode,
  resetMockLibheif,
  setupMockLibheif,
} from './_test-helpers/mock-libheif.ts';
import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { HeicDecodeError, HeicDimensionsTooLargeError, HeicInputTooLargeError } from './errors.ts';

vi.mock('libheif-js/wasm-bundle', () => setupMockLibheif());

import { decodeHeic } from './decode.ts';
import { disposeHeic } from './loader.ts';

beforeEach(() => {
  disposeHeic();
  resetMockLibheif();
  vi.clearAllMocks();
});

describe('decodeHeic — input validation', () => {
  it('throws HeicInputTooLargeError when input exceeds MAX_INPUT_BYTES', async () => {
    const fake = { byteLength: MAX_INPUT_BYTES + 1 } as unknown as Uint8Array;
    await expect(decodeHeic(fake)).rejects.toBeInstanceOf(HeicInputTooLargeError);
  });

  it('accepts ArrayBuffer input', async () => {
    const result = await decodeHeic(new ArrayBuffer(32));
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });
});

describe('decodeHeic — success path', () => {
  it('returns RGBA ImageData filled by libheif display()', async () => {
    const result = await decodeHeic(new Uint8Array([1, 2, 3, 4]));
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.data[0]).toBe(255); // red filled by the fake display
    expect(result.data[3]).toBe(255); // alpha
  });

  it('frees every decoded image handle', async () => {
    const img = makeFakeImage(8, 8);
    mockDecode.mockReturnValueOnce([img]);
    await decodeHeic(new Uint8Array([1]));
    expect(img.free).toHaveBeenCalledOnce();
  });
});

describe('decodeHeic — error paths', () => {
  it('throws HeicDecodeError when libheif returns no images (invalid file)', async () => {
    mockDecode.mockReturnValueOnce([]);
    await expect(decodeHeic(new Uint8Array([0, 0, 0, 0]))).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it('wraps a thrown libheif decode error as HeicDecodeError', async () => {
    mockDecode.mockImplementationOnce(() => {
      throw new Error('wasm panic');
    });
    const err = await decodeHeic(new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HeicDecodeError);
    if (err instanceof HeicDecodeError) expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws HeicDecodeError on invalid (zero) dimensions', async () => {
    mockDecode.mockReturnValueOnce([makeFakeImage(0, 0)]);
    await expect(decodeHeic(new Uint8Array([1]))).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it('throws HeicDimensionsTooLargeError when decoded image exceeds MAX_PIXELS', async () => {
    // 7000×7000 = 49M > 40M; the check fires BEFORE allocating the RGBA buffer.
    mockDecode.mockReturnValueOnce([makeFakeImage(7000, 7000)]);
    await expect(decodeHeic(new Uint8Array([1]))).rejects.toBeInstanceOf(
      HeicDimensionsTooLargeError,
    );
    expect(MAX_PIXELS).toBe(40_000_000);
  });

  it('throws HeicDecodeError when display() reports failure (null)', async () => {
    mockDecode.mockReturnValueOnce([makeFakeImage(8, 8, true)]);
    await expect(decodeHeic(new Uint8Array([1]))).rejects.toBeInstanceOf(HeicDecodeError);
  });
});
