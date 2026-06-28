/**
 * Tests for backend.ts — mocks @jsquash/jpeg and pixel-bridge for Node env.
 */

import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockEncode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { MOZJPEG_MIME } from './constants.ts';
import { MozjpegDimensionsTooLargeError, MozjpegInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/jpeg', () => setupMockJsquash());

const { mockHasPixelBridge, mockImageDataToBlob, mockBlobToImageData } = vi.hoisted(() => ({
  mockHasPixelBridge: vi.fn(() => true),
  mockImageDataToBlob: vi.fn(
    async (_imageData: ImageData, mime: string) => new Blob(['fake output'], { type: mime }),
  ),
  mockBlobToImageData: vi.fn(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  }),
}));

vi.mock('./pixel-bridge.ts', () => ({
  hasPixelBridge: mockHasPixelBridge,
  imageDataToBlob: mockImageDataToBlob,
  blobToImageData: mockBlobToImageData,
}));

import { MozjpegBackend, registerMozjpegBackend } from './backend.ts';
import { disposeMozjpeg } from './loader.ts';

const JPEG: FormatDescriptor = { ext: 'jpeg', mime: 'image/jpeg', category: 'image' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

function opts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return partial as ConvertOptions;
}

beforeEach(() => {
  disposeMozjpeg();
  resetMockJsquash();
  vi.clearAllMocks();
  mockHasPixelBridge.mockReturnValue(true);
  mockImageDataToBlob.mockImplementation(
    async (_imageData: ImageData, mime: string) => new Blob(['fake output'], { type: mime }),
  );
  mockBlobToImageData.mockImplementation(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  });
});

describe('MozjpegBackend.canHandle — bridge available', () => {
  const backend = new MozjpegBackend();

  it('JPEG → JPEG: true', async () => expect(await backend.canHandle(JPEG, JPEG)).toBe(true));
  it('JPEG → PNG: true', async () => expect(await backend.canHandle(JPEG, PNG)).toBe(true));
  it('JPEG → WebP: true', async () => expect(await backend.canHandle(JPEG, WEBP)).toBe(true));
  it('PNG → JPEG: true', async () => expect(await backend.canHandle(PNG, JPEG)).toBe(true));
  it('WebP → JPEG: true', async () => expect(await backend.canHandle(WEBP, JPEG)).toBe(true));
  it('PNG → PNG: false (no JPEG side)', async () =>
    expect(await backend.canHandle(PNG, PNG)).toBe(false));
  it('MP4 → JPEG: false (not canvas-decodable)', async () =>
    expect(await backend.canHandle(MP4, JPEG)).toBe(false));
  it('JPEG → GIF: false (not canvas-encodable here)', async () =>
    expect(await backend.canHandle(JPEG, GIF)).toBe(false));
});

describe('MozjpegBackend.canHandle — bridge unavailable (Node)', () => {
  const backend = new MozjpegBackend();
  beforeEach(() => mockHasPixelBridge.mockReturnValue(false));

  it('JPEG → JPEG still true', async () => expect(await backend.canHandle(JPEG, JPEG)).toBe(true));
  it('JPEG → PNG: false', async () => expect(await backend.canHandle(JPEG, PNG)).toBe(false));
  it('PNG → JPEG: false', async () => expect(await backend.canHandle(PNG, JPEG)).toBe(false));
});

describe('MozjpegBackend.convert — JPEG → JPEG', () => {
  it('decodes then re-encodes, returning a JPEG blob', async () => {
    const backend = new MozjpegBackend();
    const input = new Blob([new Uint8Array([1, 2, 3, 4])], { type: MOZJPEG_MIME });
    const result = await backend.convert(input, JPEG, opts(), JPEG);
    expect(result.blob.type).toBe(MOZJPEG_MIME);
    expect(result.backend).toBe('image-jsquash-mozjpeg');
    expect(mockEncode).toHaveBeenCalledOnce();
  });

  it('reports terminal progress', async () => {
    const backend = new MozjpegBackend();
    const onProgress = vi.fn();
    await backend.convert(
      new Blob([new Uint8Array([1])], { type: MOZJPEG_MIME }),
      JPEG,
      opts({ onProgress }),
      JPEG,
    );
    const last = onProgress.mock.calls.at(-1)?.[0] as { percent: number };
    expect(last.percent).toBe(100);
  });
});

describe('MozjpegBackend.convert — bridge paths', () => {
  it('JPEG → PNG decodes then bridges', async () => {
    const backend = new MozjpegBackend();
    const result = await backend.convert(
      new Blob([new Uint8Array([1])], { type: MOZJPEG_MIME }),
      PNG,
      opts(),
      JPEG,
    );
    expect(mockImageDataToBlob).toHaveBeenCalledOnce();
    expect(result.blob.type).toBe('image/png');
  });

  it('PNG → JPEG bridges then encodes, and maps quality 0–1', async () => {
    const backend = new MozjpegBackend();
    const result = await backend.convert(
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      JPEG,
      opts({ quality: 0.4 }),
      PNG,
    );
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    const [, encOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, unknown>];
    expect(encOpts.quality).toBe(40);
    expect(result.blob.type).toBe(MOZJPEG_MIME);
  });
});

describe('MozjpegBackend.convert — limits & abort', () => {
  it('throws MozjpegInputTooLargeError when input exceeds the cap', async () => {
    const backend = new MozjpegBackend({ maxInputBytes: 8 });
    await expect(
      backend.convert(new Blob([new Uint8Array(64)], { type: MOZJPEG_MIME }), JPEG, opts(), JPEG),
    ).rejects.toBeInstanceOf(MozjpegInputTooLargeError);
  });

  it('respects a custom maxPixels', async () => {
    const backend = new MozjpegBackend({ maxPixels: 10 });
    await expect(
      backend.convert(new Blob([new Uint8Array([1])], { type: MOZJPEG_MIME }), JPEG, opts(), JPEG),
    ).rejects.toBeInstanceOf(MozjpegDimensionsTooLargeError);
  });

  it('throws when the signal is already aborted', async () => {
    const backend = new MozjpegBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(
      backend.convert(
        new Blob([new Uint8Array([1])], { type: MOZJPEG_MIME }),
        JPEG,
        opts({ signal: controller.signal }),
        JPEG,
      ),
    ).rejects.toThrow();
  });

  it('falls back to Blob.type when no inputFormat is supplied', async () => {
    const backend = new MozjpegBackend();
    const result = await backend.convert(
      new Blob([new Uint8Array([1])], { type: MOZJPEG_MIME }),
      JPEG,
      opts(),
    );
    expect(result.blob.type).toBe(MOZJPEG_MIME);
  });
});

describe('registerMozjpegBackend', () => {
  it('registers a MozjpegBackend in the given registry', () => {
    const registry = new BackendRegistry();
    registerMozjpegBackend(registry);
    expect(registry.list().some((b) => b.name === 'image-jsquash-mozjpeg')).toBe(true);
  });

  it('rejects double registration', () => {
    const registry = new BackendRegistry();
    registerMozjpegBackend(registry);
    expect(() => registerMozjpegBackend(registry)).toThrow();
  });
});
