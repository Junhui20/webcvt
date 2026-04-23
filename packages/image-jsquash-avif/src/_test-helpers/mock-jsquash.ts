/**
 * vi.mock factory for @jsquash/avif.
 *
 * Matches the actual @jsquash/avif ^1.3.0 API:
 * - decode(buffer: ArrayBuffer): Promise<ImageData>
 * - encode(data: ImageData, options?: Partial<EncodeOptions>): Promise<ArrayBuffer>
 *
 * Usage in test files:
 * ```ts
 * import { setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
 * vi.mock('@jsquash/avif', () => setupMockJsquash());
 * ```
 *
 * Individual mock functions are exported so tests can override them:
 * ```ts
 * mockDecode.mockRejectedValueOnce(new Error('bad avif'));
 * ```
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// ImageData-compatible plain object (avoids new ImageData() requiring DOM)
// ---------------------------------------------------------------------------

/** Creates a plain object that satisfies the ImageData interface. */
function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; // R
    data[i + 1] = 0; // G
    data[i + 2] = 0; // B
    data[i + 3] = 255; // A
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

// ---------------------------------------------------------------------------
// Individual mock functions (exported for per-test overrides)
// ---------------------------------------------------------------------------

export const mockDecode = vi.fn(async (_data: ArrayBuffer): Promise<ImageData> => {
  // Default: return an 8×8 solid-red ImageData-compatible object
  return makeImageDataLike(8, 8);
});

export const mockEncode = vi.fn(
  async (_image: ImageData, _options?: Partial<Record<string, unknown>>): Promise<ArrayBuffer> => {
    // Default: return a fake AVIF byte sequence (ftyp box magic) as ArrayBuffer
    return new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]).buffer;
  },
);

// ---------------------------------------------------------------------------
// Factory function — pass to vi.mock
// ---------------------------------------------------------------------------

/**
 * Returns the mock module factory for vi.mock('@jsquash/avif', () => setupMockJsquash()).
 *
 * The returned object matches the actual @jsquash/avif ^1.3.0 exports.
 */
export function setupMockJsquash(): {
  decode: typeof mockDecode;
  encode: typeof mockEncode;
} {
  return {
    decode: mockDecode,
    encode: mockEncode,
  };
}

/**
 * Resets all mock functions to their default implementations.
 * Call in beforeEach to ensure test isolation.
 */
export function resetMockJsquash(): void {
  mockDecode.mockReset();
  mockDecode.mockImplementation(async (_data: ArrayBuffer): Promise<ImageData> => {
    return makeImageDataLike(8, 8);
  });

  mockEncode.mockReset();
  mockEncode.mockImplementation(
    async (
      _image: ImageData,
      _options?: Partial<Record<string, unknown>>,
    ): Promise<ArrayBuffer> => {
      return new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]).buffer;
    },
  );
}
