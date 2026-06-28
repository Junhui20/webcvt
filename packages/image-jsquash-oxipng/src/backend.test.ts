/**
 * Tests for backend.ts — mocks @jsquash/oxipng and pixel-bridge for Node env.
 */

import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockOptimise, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { OXIPNG_MIME } from './constants.ts';
import { OxipngDimensionsTooLargeError, OxipngInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/oxipng', () => setupMockJsquash());

const { mockHasPixelBridge, mockBlobToImageData } = vi.hoisted(() => ({
  mockHasPixelBridge: vi.fn(() => true),
  mockBlobToImageData: vi.fn(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  }),
}));

vi.mock('./pixel-bridge.ts', () => ({
  hasPixelBridge: mockHasPixelBridge,
  blobToImageData: mockBlobToImageData,
}));

import { OxipngBackend, registerOxipngBackend } from './backend.ts';
import { disposeOxipng } from './loader.ts';

const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const JPEG: FormatDescriptor = { ext: 'jpeg', mime: 'image/jpeg', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

function opts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return partial as ConvertOptions;
}

beforeEach(() => {
  disposeOxipng();
  resetMockJsquash();
  vi.clearAllMocks();
  mockHasPixelBridge.mockReturnValue(true);
  mockBlobToImageData.mockImplementation(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  });
});

describe('OxipngBackend.canHandle — bridge available', () => {
  const backend = new OxipngBackend();

  it('PNG → PNG: true', async () => expect(await backend.canHandle(PNG, PNG)).toBe(true));
  it('JPEG → PNG: true (bridge)', async () =>
    expect(await backend.canHandle(JPEG, PNG)).toBe(true));
  it('WebP → PNG: true (bridge)', async () =>
    expect(await backend.canHandle(WEBP, PNG)).toBe(true));
  it('PNG → JPEG: false (output not PNG)', async () =>
    expect(await backend.canHandle(PNG, JPEG)).toBe(false));
  it('JPEG → JPEG: false (output not PNG)', async () =>
    expect(await backend.canHandle(JPEG, JPEG)).toBe(false));
  it('MP4 → PNG: false (not canvas-decodable)', async () =>
    expect(await backend.canHandle(MP4, PNG)).toBe(false));
  it('GIF → PNG: false (gif not in decodable set)', async () =>
    expect(await backend.canHandle(GIF, PNG)).toBe(false));
});

describe('OxipngBackend.canHandle — bridge unavailable (Node)', () => {
  const backend = new OxipngBackend();
  beforeEach(() => mockHasPixelBridge.mockReturnValue(false));

  it('PNG → PNG still true (no bridge needed)', async () =>
    expect(await backend.canHandle(PNG, PNG)).toBe(true));
  it('JPEG → PNG: false (needs bridge)', async () =>
    expect(await backend.canHandle(JPEG, PNG)).toBe(false));
});

describe('OxipngBackend.convert — PNG → PNG (optimise bytes)', () => {
  it('re-optimises the PNG bytes directly, no bridge', async () => {
    const backend = new OxipngBackend();
    const input = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: OXIPNG_MIME });
    const result = await backend.convert(input, PNG, opts(), PNG);
    expect(result.blob.type).toBe(OXIPNG_MIME);
    expect(result.backend).toBe('image-jsquash-oxipng');
    expect(mockBlobToImageData).not.toHaveBeenCalled();
    expect(mockOptimise).toHaveBeenCalledOnce();
    const [data] = mockOptimise.mock.calls[0] as [unknown];
    expect(data).toBeInstanceOf(ArrayBuffer);
  });

  it('reports terminal progress', async () => {
    const backend = new OxipngBackend();
    const onProgress = vi.fn();
    await backend.convert(
      new Blob([new Uint8Array([1])], { type: OXIPNG_MIME }),
      PNG,
      opts({ onProgress }),
      PNG,
    );
    const last = onProgress.mock.calls.at(-1)?.[0] as { percent: number };
    expect(last.percent).toBe(100);
  });

  it('falls back to Blob.type when no inputFormat is supplied', async () => {
    const backend = new OxipngBackend();
    const result = await backend.convert(
      new Blob([new Uint8Array([1])], { type: OXIPNG_MIME }),
      PNG,
      opts(),
    );
    expect(result.blob.type).toBe(OXIPNG_MIME);
  });
});

describe('OxipngBackend.convert — JPEG → PNG (bridge then optimise)', () => {
  it('bridges to ImageData then optimises to PNG', async () => {
    const backend = new OxipngBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const result = await backend.convert(input, PNG, opts(), JPEG);
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    expect(mockOptimise).toHaveBeenCalledOnce();
    const [data] = mockOptimise.mock.calls[0] as [unknown];
    expect((data as ImageData).width).toBe(8);
    expect(result.blob.type).toBe(OXIPNG_MIME);
  });
});

describe('OxipngBackend.convert — limits & abort', () => {
  it('throws OxipngInputTooLargeError when input exceeds the cap', async () => {
    const backend = new OxipngBackend({ maxInputBytes: 8 });
    await expect(
      backend.convert(new Blob([new Uint8Array(64)], { type: OXIPNG_MIME }), PNG, opts(), PNG),
    ).rejects.toBeInstanceOf(OxipngInputTooLargeError);
  });

  it('respects a custom maxPixels on the bridge path', async () => {
    const backend = new OxipngBackend({ maxPixels: 10 });
    await expect(
      backend.convert(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), PNG, opts(), JPEG),
    ).rejects.toBeInstanceOf(OxipngDimensionsTooLargeError);
  });

  it('throws when the signal is already aborted', async () => {
    const backend = new OxipngBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(
      backend.convert(
        new Blob([new Uint8Array([1])], { type: OXIPNG_MIME }),
        PNG,
        opts({ signal: controller.signal }),
        PNG,
      ),
    ).rejects.toThrow();
  });
});

describe('registerOxipngBackend', () => {
  it('registers an OxipngBackend in the given registry', () => {
    const registry = new BackendRegistry();
    registerOxipngBackend(registry);
    expect(registry.list().some((b) => b.name === 'image-jsquash-oxipng')).toBe(true);
  });

  it('rejects double registration', () => {
    const registry = new BackendRegistry();
    registerOxipngBackend(registry);
    expect(() => registerOxipngBackend(registry)).toThrow();
  });
});
