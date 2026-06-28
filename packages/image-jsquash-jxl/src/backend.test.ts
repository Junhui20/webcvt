/**
 * Tests for backend.ts — mocks @jsquash/jxl and pixel-bridge for Node env.
 *
 * Covers: canHandle matrix (bridge available + unavailable), convert JXL→JXL,
 * JXL→PNG (bridge), PNG→JXL (bridge), AbortSignal, input-size / pixel caps,
 * quality override, and registerJxlBackend.
 */

import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockEncode, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { JXL_MIME, MAX_INPUT_BYTES } from './constants.ts';
import { JxlDimensionsTooLargeError, JxlInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/jxl', () => setupMockJsquash());

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

import { JxlBackend, registerJxlBackend } from './backend.ts';
import { disposeJxl } from './loader.ts';

const JXL: FormatDescriptor = { ext: 'jxl', mime: 'image/jxl', category: 'image' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const JPEG: FormatDescriptor = { ext: 'jpg', mime: 'image/jpeg', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

function opts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return partial as ConvertOptions;
}

beforeEach(() => {
  disposeJxl();
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

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('JxlBackend.canHandle — bridge available', () => {
  const backend = new JxlBackend();

  it('JXL → JXL: true', async () => expect(await backend.canHandle(JXL, JXL)).toBe(true));
  it('JXL → PNG: true', async () => expect(await backend.canHandle(JXL, PNG)).toBe(true));
  it('JXL → JPEG: true', async () => expect(await backend.canHandle(JXL, JPEG)).toBe(true));
  it('JXL → WebP: true', async () => expect(await backend.canHandle(JXL, WEBP)).toBe(true));
  it('PNG → JXL: true', async () => expect(await backend.canHandle(PNG, JXL)).toBe(true));
  it('JPEG → JXL: true', async () => expect(await backend.canHandle(JPEG, JXL)).toBe(true));
  it('PNG → PNG: false (no JXL side)', async () =>
    expect(await backend.canHandle(PNG, PNG)).toBe(false));
  it('MP4 → JXL: false (not canvas-decodable)', async () =>
    expect(await backend.canHandle(MP4, JXL)).toBe(false));
  it('JXL → GIF: false (not canvas-encodable here)', async () =>
    expect(await backend.canHandle(JXL, GIF)).toBe(false));
});

describe('JxlBackend.canHandle — bridge unavailable (Node)', () => {
  const backend = new JxlBackend();

  beforeEach(() => mockHasPixelBridge.mockReturnValue(false));

  it('JXL → JXL still true (no bridge needed)', async () =>
    expect(await backend.canHandle(JXL, JXL)).toBe(true));
  it('JXL → PNG: false (needs bridge)', async () =>
    expect(await backend.canHandle(JXL, PNG)).toBe(false));
  it('PNG → JXL: false (needs bridge)', async () =>
    expect(await backend.canHandle(PNG, JXL)).toBe(false));
});

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

describe('JxlBackend.convert — JXL → JXL', () => {
  it('decodes then re-encodes, returning a JXL blob', async () => {
    const backend = new JxlBackend();
    const input = new Blob([new Uint8Array([1, 2, 3, 4])], { type: JXL_MIME });
    const result = await backend.convert(input, JXL, opts(), JXL);
    expect(result.blob.type).toBe(JXL_MIME);
    expect(result.backend).toBe('image-jsquash-jxl');
    expect(result.format).toBe(JXL);
    expect(mockEncode).toHaveBeenCalledOnce();
  });

  it('reports progress through the onProgress callback', async () => {
    const backend = new JxlBackend();
    const onProgress = vi.fn();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: JXL_MIME });
    await backend.convert(input, JXL, opts({ onProgress }), JXL);
    expect(onProgress).toHaveBeenCalled();
    const last = onProgress.mock.calls.at(-1)?.[0] as { percent: number };
    expect(last.percent).toBe(100);
  });
});

describe('JxlBackend.convert — JXL → PNG (bridge)', () => {
  it('decodes JXL then bridges to PNG', async () => {
    const backend = new JxlBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: JXL_MIME });
    const result = await backend.convert(input, PNG, opts(), JXL);
    expect(mockBlobToImageData).not.toHaveBeenCalled();
    expect(mockImageDataToBlob).toHaveBeenCalledOnce();
    expect(result.blob.type).toBe('image/png');
  });
});

describe('JxlBackend.convert — PNG → JXL (bridge)', () => {
  it('bridges PNG to ImageData then encodes JXL', async () => {
    const backend = new JxlBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await backend.convert(input, JXL, opts(), PNG);
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    expect(mockEncode).toHaveBeenCalledOnce();
    expect(result.blob.type).toBe(JXL_MIME);
  });

  it('maps ConvertOptions.quality (0–1) into the encoder', async () => {
    const backend = new JxlBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await backend.convert(input, JXL, opts({ quality: 0.4 }), PNG);
    const [, encOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, unknown>];
    expect(encOpts.quality).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Caps and abort
// ---------------------------------------------------------------------------

describe('JxlBackend.convert — limits & abort', () => {
  it('throws JxlInputTooLargeError when input exceeds the cap', async () => {
    const backend = new JxlBackend({ maxInputBytes: 8 });
    const input = new Blob([new Uint8Array(64)], { type: JXL_MIME });
    expect(input.size).toBeGreaterThan(8);
    await expect(backend.convert(input, JXL, opts(), JXL)).rejects.toBeInstanceOf(
      JxlInputTooLargeError,
    );
  });

  it('respects a custom maxPixels via assertPixelCount', async () => {
    // Decoded mock image is 8×8 = 64 px; maxPixels = 10 → JxlDimensionsTooLargeError
    const backend = new JxlBackend({ maxPixels: 10 });
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: JXL_MIME });
    await expect(backend.convert(input, JXL, opts(), JXL)).rejects.toBeInstanceOf(
      JxlDimensionsTooLargeError,
    );
  });

  it('throws an AbortError when the signal is already aborted', async () => {
    const backend = new JxlBackend();
    const controller = new AbortController();
    controller.abort();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: JXL_MIME });
    await expect(
      backend.convert(input, JXL, opts({ signal: controller.signal }), JXL),
    ).rejects.toThrow();
  });

  it('falls back to Blob.type when no inputFormat is supplied', async () => {
    const backend = new JxlBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: JXL_MIME });
    const result = await backend.convert(input, JXL, opts());
    expect(result.blob.type).toBe(JXL_MIME);
  });
});

// ---------------------------------------------------------------------------
// registerJxlBackend
// ---------------------------------------------------------------------------

describe('registerJxlBackend', () => {
  it('registers a JxlBackend in the given registry', () => {
    const registry = new BackendRegistry();
    registerJxlBackend(registry);
    expect(registry.list().some((b) => b.name === 'image-jsquash-jxl')).toBe(true);
  });

  it('rejects double registration', () => {
    const registry = new BackendRegistry();
    registerJxlBackend(registry);
    expect(() => registerJxlBackend(registry)).toThrow();
  });
});
