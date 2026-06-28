/**
 * vi.mock factory for @jsquash/oxipng.
 *
 * Matches the actual @jsquash/oxipng ^2.3.0 API:
 * - optimise(data: ArrayBuffer | ImageData, options?): Promise<ArrayBuffer>
 *
 * Usage:
 * ```ts
 * import { setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
 * vi.mock('@jsquash/oxipng', () => setupMockJsquash());
 * ```
 */

import { vi } from 'vitest';

export const mockOptimise = vi.fn(
  async (
    _data: ArrayBuffer | ImageData,
    _options?: Partial<Record<string, unknown>>,
  ): Promise<ArrayBuffer> => {
    // Default: a fake PNG byte sequence (8-byte PNG signature) as ArrayBuffer.
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
  },
);

/** Returns the mock module factory for vi.mock('@jsquash/oxipng', () => setupMockJsquash()). */
export function setupMockJsquash(): { optimise: typeof mockOptimise } {
  return { optimise: mockOptimise };
}

/** Resets the mock to its default implementation. */
export function resetMockJsquash(): void {
  mockOptimise.mockReset();
  mockOptimise.mockImplementation(
    async (
      _data: ArrayBuffer | ImageData,
      _options?: Partial<Record<string, unknown>>,
    ): Promise<ArrayBuffer> => {
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
    },
  );
}
