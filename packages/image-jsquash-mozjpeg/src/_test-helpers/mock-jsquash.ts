/**
 * vi.mock factory for @jsquash/jpeg (MozJPEG).
 *
 * Matches the actual @jsquash/jpeg ^1.6.0 API:
 * - decode(buffer: ArrayBuffer): Promise<ImageData>
 * - encode(data: ImageData, options?: Partial<EncodeOptions>): Promise<ArrayBuffer>
 *
 * Usage:
 * ```ts
 * import { setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
 * vi.mock('@jsquash/jpeg', () => setupMockJsquash());
 * ```
 */

import { vi } from 'vitest';

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

export const mockDecode = vi.fn(async (_data: ArrayBuffer): Promise<ImageData> => {
  return makeImageDataLike(8, 8);
});

export const mockEncode = vi.fn(
  async (_image: ImageData, _options?: Partial<Record<string, unknown>>): Promise<ArrayBuffer> => {
    // Default: a fake JPEG byte sequence (SOI marker FF D8 FF) as ArrayBuffer.
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).buffer;
  },
);

/** Returns the mock module factory for vi.mock('@jsquash/jpeg', () => setupMockJsquash()). */
export function setupMockJsquash(): {
  decode: typeof mockDecode;
  encode: typeof mockEncode;
} {
  return {
    decode: mockDecode,
    encode: mockEncode,
  };
}

/** Resets all mock functions to their default implementations. */
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
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).buffer;
    },
  );
}
