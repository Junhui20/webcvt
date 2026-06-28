/**
 * Tests for decode.ts — mocks @jsquash/jpeg for fast unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDecode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegInputTooLargeError,
} from './errors.ts';

vi.mock('@jsquash/jpeg', () => setupMockJsquash());

import { decodeMozjpeg } from './decode.ts';
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

describe('decodeMozjpeg — input size validation', () => {
  it('throws MozjpegInputTooLargeError when input exceeds MAX_INPUT_BYTES', async () => {
    const fakeBytes = {
      byteLength: MAX_INPUT_BYTES + 1,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    await expect(decodeMozjpeg(fakeBytes)).rejects.toBeInstanceOf(MozjpegInputTooLargeError);
  });

  it('accepts ArrayBuffer input', async () => {
    const result = await decodeMozjpeg(new ArrayBuffer(16));
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });
});

describe('decodeMozjpeg — success path', () => {
  it('returns ImageData-compatible object from the mock', async () => {
    const result = await decodeMozjpeg(new Uint8Array([1, 2, 3, 4]));
    expect(result.width).toBe(8);
    expect(result.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('delegates to @jsquash/jpeg decode', async () => {
    await decodeMozjpeg(new Uint8Array([1, 2, 3]));
    expect(mockDecode).toHaveBeenCalledOnce();
  });
});

describe('decodeMozjpeg — error propagation', () => {
  it('wraps jsquash decode error as MozjpegDecodeError with generic message', async () => {
    const original = new Error('/node_modules/@jsquash/jpeg/codec.js: decode failed');
    mockDecode.mockRejectedValueOnce(original);
    const err = await decodeMozjpeg(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MozjpegDecodeError);
    if (err instanceof MozjpegDecodeError) {
      expect(err.message).not.toContain('/node_modules');
      expect(err.cause).toBe(original);
    }
  });
});

describe('decodeMozjpeg — MAX_PIXELS validation', () => {
  it('throws when decoded image exceeds MAX_PIXELS', async () => {
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5001, 5001));
    await expect(decodeMozjpeg(new Uint8Array([1]))).rejects.toBeInstanceOf(
      MozjpegDimensionsTooLargeError,
    );
  });

  it('accepts a decoded image at exactly MAX_PIXELS', async () => {
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5000, 5000));
    const result = await decodeMozjpeg(new Uint8Array([1]));
    expect(result.width).toBe(5000);
    expect(MAX_PIXELS).toBe(25_000_000);
  });
});
