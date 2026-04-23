/**
 * Tests for decode.ts — mocks @jsquash/avif for fast unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDecode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { AvifDecodeError, AvifDimensionsTooLargeError, AvifInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/avif', () => setupMockJsquash());

import { decodeAvif } from './decode.ts';
import { disposeAvif } from './loader.ts';

beforeEach(() => {
  disposeAvif();
  resetMockJsquash();
  vi.clearAllMocks();
});

/** Creates a plain ImageData-compatible object without requiring DOM. */
function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

// ---------------------------------------------------------------------------
// Input size validation
// ---------------------------------------------------------------------------

describe('decodeAvif — input size validation', () => {
  it('throws AvifInputTooLargeError when input exceeds MAX_INPUT_BYTES', async () => {
    const fakeBytes = {
      byteLength: MAX_INPUT_BYTES + 1,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    await expect(decodeAvif(fakeBytes)).rejects.toBeInstanceOf(AvifInputTooLargeError);
  });

  it('throws AvifInputTooLargeError with correct byte counts', async () => {
    const size = MAX_INPUT_BYTES + 100;
    const fakeBytes = {
      byteLength: size,
      buffer: new ArrayBuffer(1),
      byteOffset: 0,
    } as unknown as Uint8Array;
    const err = await decodeAvif(fakeBytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifInputTooLargeError);
    if (err instanceof AvifInputTooLargeError) {
      expect(err.actualBytes).toBe(size);
      expect(err.limitBytes).toBe(MAX_INPUT_BYTES);
    }
  });

  it('accepts input exactly at MAX_INPUT_BYTES', async () => {
    // Must succeed without throwing (mock decode returns 8×8 ImageData)
    const bytes = new Uint8Array(MAX_INPUT_BYTES);
    const result = await decodeAvif(bytes);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });

  it('accepts ArrayBuffer input', async () => {
    const buffer = new ArrayBuffer(16);
    const result = await decodeAvif(buffer);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Decode success
// ---------------------------------------------------------------------------

describe('decodeAvif — success path', () => {
  it('returns ImageData-compatible object with correct dimensions from mock', async () => {
    const result = await decodeAvif(new Uint8Array([1, 2, 3, 4]));
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('delegates to @jsquash/avif decode', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await decodeAvif(bytes);
    expect(mockDecode).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// jsquash error propagation
// ---------------------------------------------------------------------------

describe('decodeAvif — error propagation', () => {
  it('wraps jsquash decode error as AvifDecodeError', async () => {
    mockDecode.mockRejectedValueOnce(new Error('malformed AVIF'));
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(decodeAvif(bytes)).rejects.toBeInstanceOf(AvifDecodeError);
  });

  it('preserves original error as cause', async () => {
    const original = new Error('malformed AVIF');
    mockDecode.mockRejectedValueOnce(original);
    const err = await decodeAvif(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifDecodeError);
    if (err instanceof AvifDecodeError) {
      expect(err.cause).toBe(original);
    }
  });

  // LOW-4 regression: error message must NOT embed raw jsquash message (path leak prevention)
  it('uses generic error message, not raw jsquash message (LOW-4)', async () => {
    const original = new Error('/node_modules/@jsquash/avif/internal/path/codec.js: decode failed');
    mockDecode.mockRejectedValueOnce(original);
    const err = await decodeAvif(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifDecodeError);
    if (err instanceof AvifDecodeError) {
      expect(err.message).not.toContain('/node_modules');
      expect(err.message).toContain('error.cause');
      expect(err.cause).toBe(original);
    }
  });
});

// ---------------------------------------------------------------------------
// Decoded dimension cap (HIGH-1 regression)
// ---------------------------------------------------------------------------

describe('decodeAvif — MAX_PIXELS validation', () => {
  it('throws AvifDimensionsTooLargeError when decoded image exceeds MAX_PIXELS', async () => {
    // 5001 × 5001 = 25,010,001 > 25,000,000 (new lower MAX_PIXELS)
    const width = 5001;
    const height = 5001;
    mockDecode.mockResolvedValueOnce(makeImageDataLike(width, height));

    await expect(decodeAvif(new Uint8Array([1]))).rejects.toBeInstanceOf(
      AvifDimensionsTooLargeError,
    );
  });

  it('accepts decoded image at exactly MAX_PIXELS', async () => {
    // 5000×5000 = 25_000_000 = MAX_PIXELS exactly (should pass)
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5000, 5000));

    const result = await decodeAvif(new Uint8Array([1]));
    expect(result.width).toBe(5000);
    expect(result.height).toBe(5000);
  });

  it('throws for 5001×5001 (just over new MAX_PIXELS of 25M)', async () => {
    // 5001*5001 = 25,010,001 > 25,000,000
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5001, 5001));

    const err = await decodeAvif(new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifDimensionsTooLargeError);
    if (err instanceof AvifDimensionsTooLargeError) {
      expect(err.limitPixels).toBe(MAX_PIXELS);
    }
  });

  // HIGH-1 regression: ensure the pixel check fires (even if post-allocation)
  it('HIGH-1 regression: mock returning oversized ImageData (>MAX_PIXELS) is rejected', async () => {
    // Simulate jsquash returning a 100M-pixel image (old limit, now over new 25M limit)
    mockDecode.mockResolvedValueOnce(makeImageDataLike(10000, 10000)); // 100M > 25M
    const err = await decodeAvif(new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvifDimensionsTooLargeError);
    if (err instanceof AvifDimensionsTooLargeError) {
      expect(err.pixels).toBeGreaterThan(MAX_PIXELS);
    }
  });
});
