/**
 * vi.mock factory for libheif-js/wasm-bundle.
 *
 * Models the small surface the loader/decoder use:
 * - new HeifDecoder().decode(bytes) -> HeifImage[]
 * - image.get_width() / get_height() / display(target, cb) / free()
 *
 * Usage:
 * ```ts
 * import { setupMockLibheif } from './_test-helpers/mock-libheif.ts';
 * vi.mock('libheif-js/wasm-bundle', () => setupMockLibheif());
 * ```
 */

import { vi } from 'vitest';

export interface FakeImage {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    cb: (out: unknown) => void,
  ): void;
  free: ReturnType<typeof vi.fn>;
}

/** Build a fake decoded image that fills its target with opaque red on display(). */
export function makeFakeImage(width: number, height: number, failDisplay = false): FakeImage {
  return {
    get_width: () => width,
    get_height: () => height,
    display: (target, cb) => {
      if (failDisplay) {
        cb(null);
        return;
      }
      for (let i = 0; i < target.data.length; i += 4) {
        target.data[i] = 255; // R
        target.data[i + 3] = 255; // A
      }
      cb(target);
    },
    free: vi.fn(),
  };
}

/** Decode mock — override per test (e.g. return [] for invalid input). */
export const mockDecode = vi.fn((_data: ArrayBuffer | Uint8Array): FakeImage[] => [
  makeFakeImage(8, 8),
]);

/** Returns the mock module factory for vi.mock('libheif-js/wasm-bundle', () => setupMockLibheif()).
 *
 * The real `libheif-js/wasm-bundle` is CJS with a `default` export, so vitest
 * requires the mock to provide `default` too. The loader reads `imported.default
 * ?? imported`, so we expose the same decoder under both `default` and top-level. */
export function setupMockLibheif(): {
  default: { HeifDecoder: new () => { decode: typeof mockDecode } };
  HeifDecoder: new () => { decode: typeof mockDecode };
} {
  class HeifDecoder {
    decode = mockDecode;
  }
  return { default: { HeifDecoder }, HeifDecoder };
}

/** Resets the decode mock to its default (one 8×8 image). */
export function resetMockLibheif(): void {
  mockDecode.mockReset();
  mockDecode.mockImplementation((_data: ArrayBuffer | Uint8Array): FakeImage[] => [
    makeFakeImage(8, 8),
  ]);
}
