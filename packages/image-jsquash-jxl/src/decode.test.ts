/**
 * Tests for decode.ts — mocks @jsquash/jxl for fast unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDecode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { JxlDecodeError, JxlDimensionsTooLargeError, JxlInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/jxl', () => setupMockJsquash());

import { decodeJxl } from './decode.ts';
import { disposeJxl } from './loader.ts';

beforeEach(() => {
  disposeJxl();
  resetMockJsquash();
  vi.clearAllMocks();
});

/** Creates a plain ImageData-compatible object without requiring DOM. */
function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('decodeJxl — input size validation', () => {
  it('throws JxlInputTooLargeError when input exceeds MAX_INPUT_BYTES', async () => {
    const fakeBytes = {
      byteLength: MAX_INPUT_BYTES + 1,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    await expect(decodeJxl(fakeBytes)).rejects.toBeInstanceOf(JxlInputTooLargeError);
  });

  it('records accurate byte counts on the error', async () => {
    const size = MAX_INPUT_BYTES + 100;
    const fakeBytes = {
      byteLength: size,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    const err = await decodeJxl(fakeBytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JxlInputTooLargeError);
    if (err instanceof JxlInputTooLargeError) {
      expect(err.actualBytes).toBe(size);
      expect(err.limitBytes).toBe(MAX_INPUT_BYTES);
    }
  });

  it('accepts ArrayBuffer input', async () => {
    const buffer = new ArrayBuffer(16);
    const result = await decodeJxl(buffer);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });
});

describe('decodeJxl — success path', () => {
  it('returns ImageData-compatible object from the mock', async () => {
    const result = await decodeJxl(new Uint8Array([1, 2, 3, 4]));
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('delegates to @jsquash/jxl decode', async () => {
    await decodeJxl(new Uint8Array([1, 2, 3]));
    expect(mockDecode).toHaveBeenCalledOnce();
  });
});

describe('decodeJxl — error propagation', () => {
  it('wraps jsquash decode error as JxlDecodeError', async () => {
    mockDecode.mockRejectedValueOnce(new Error('malformed JXL'));
    await expect(decodeJxl(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(JxlDecodeError);
  });

  it('preserves original error as cause and uses a generic message (no path leak)', async () => {
    const original = new Error('/node_modules/@jsquash/jxl/internal/codec.js: decode failed');
    mockDecode.mockRejectedValueOnce(original);
    const err = await decodeJxl(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JxlDecodeError);
    if (err instanceof JxlDecodeError) {
      expect(err.message).not.toContain('/node_modules');
      expect(err.message).toContain('error.cause');
      expect(err.cause).toBe(original);
    }
  });
});

describe('decodeJxl — MAX_PIXELS validation', () => {
  it('throws JxlDimensionsTooLargeError when decoded image exceeds MAX_PIXELS', async () => {
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5001, 5001)); // 25,010,001 > 25M
    await expect(decodeJxl(new Uint8Array([1]))).rejects.toBeInstanceOf(JxlDimensionsTooLargeError);
  });

  it('accepts a decoded image at exactly MAX_PIXELS', async () => {
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5000, 5000)); // 25,000,000
    const result = await decodeJxl(new Uint8Array([1]));
    expect(result.width).toBe(5000);
    expect(result.height).toBe(5000);
  });

  it('reports the MAX_PIXELS limit on the error', async () => {
    mockDecode.mockResolvedValueOnce(makeImageDataLike(10000, 10000)); // 100M
    const err = await decodeJxl(new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JxlDimensionsTooLargeError);
    if (err instanceof JxlDimensionsTooLargeError) {
      expect(err.limitPixels).toBe(MAX_PIXELS);
      expect(err.pixels).toBeGreaterThan(MAX_PIXELS);
    }
  });
});
