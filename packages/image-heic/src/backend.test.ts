/**
 * Tests for backend.ts — mocks ./decode.ts and ./pixel-bridge.ts for Node env.
 *
 * Covers: canHandle matrix (bridge available + unavailable), convert HEIC→PNG/JPEG,
 * progress, input-size / pixel caps, AbortSignal, and registerHeicBackend.
 */

import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeicDimensionsTooLargeError, HeicInputTooLargeError } from './errors.ts';

const { mockDecodeHeic, mockHasPixelBridge, mockImageDataToBlob } = vi.hoisted(() => ({
  mockDecodeHeic: vi.fn(async (): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  }),
  mockHasPixelBridge: vi.fn(() => true),
  mockImageDataToBlob: vi.fn(
    async (_imageData: ImageData, mime: string) => new Blob(['fake output'], { type: mime }),
  ),
}));

vi.mock('./decode.ts', () => ({ decodeHeic: mockDecodeHeic }));
vi.mock('./pixel-bridge.ts', () => ({
  hasPixelBridge: mockHasPixelBridge,
  imageDataToBlob: mockImageDataToBlob,
}));

import { HeicBackend, registerHeicBackend } from './backend.ts';

const HEIC: FormatDescriptor = { ext: 'heic', mime: 'image/heic', category: 'image' };
const HEIF: FormatDescriptor = { ext: 'heif', mime: 'image/heif', category: 'image' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const JPEG: FormatDescriptor = { ext: 'jpg', mime: 'image/jpeg', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

function opts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return partial as ConvertOptions;
}

function heicBlob(bytes = 16): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/heic' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPixelBridge.mockReturnValue(true);
  mockDecodeHeic.mockImplementation(async (): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  });
  mockImageDataToBlob.mockImplementation(
    async (_imageData: ImageData, mime: string) => new Blob(['fake output'], { type: mime }),
  );
});

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('HeicBackend.canHandle — bridge available', () => {
  const backend = new HeicBackend();

  it('HEIC → PNG: true', async () => expect(await backend.canHandle(HEIC, PNG)).toBe(true));
  it('HEIC → JPEG: true', async () => expect(await backend.canHandle(HEIC, JPEG)).toBe(true));
  it('HEIC → WebP: true', async () => expect(await backend.canHandle(HEIC, WEBP)).toBe(true));
  it('HEIF → PNG: true', async () => expect(await backend.canHandle(HEIF, PNG)).toBe(true));
  it('HEIC → HEIC: false (no HEIC encoder)', async () =>
    expect(await backend.canHandle(HEIC, HEIC)).toBe(false));
  it('HEIC → GIF: false (not canvas-encodable here)', async () =>
    expect(await backend.canHandle(HEIC, GIF)).toBe(false));
  it('PNG → PNG: false (input not HEIC/HEIF)', async () =>
    expect(await backend.canHandle(PNG, PNG)).toBe(false));
  it('MP4 → PNG: false (input not HEIC/HEIF)', async () =>
    expect(await backend.canHandle(MP4, PNG)).toBe(false));

  it('canHandle never loads wasm — no decode call', async () => {
    await backend.canHandle(HEIC, PNG);
    expect(mockDecodeHeic).not.toHaveBeenCalled();
  });
});

describe('HeicBackend.canHandle — bridge unavailable (Node)', () => {
  const backend = new HeicBackend();

  beforeEach(() => mockHasPixelBridge.mockReturnValue(false));

  it('HEIC → PNG: false (needs bridge)', async () =>
    expect(await backend.canHandle(HEIC, PNG)).toBe(false));
});

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

describe('HeicBackend.convert — HEIC → PNG', () => {
  it('decodes then bridges to PNG', async () => {
    const backend = new HeicBackend();
    const result = await backend.convert(heicBlob(), PNG, opts());
    expect(mockDecodeHeic).toHaveBeenCalledOnce();
    expect(mockImageDataToBlob).toHaveBeenCalledOnce();
    expect(result.blob.type).toBe('image/png');
    expect(result.backend).toBe('image-heic');
    expect(result.format).toBe(PNG);
    expect(result.hardwareAccelerated).toBe(false);
  });

  it('passes the quality option through to the bridge', async () => {
    const backend = new HeicBackend();
    await backend.convert(heicBlob(), JPEG, opts({ quality: 0.6 }));
    const [, mime, quality] = mockImageDataToBlob.mock.calls[0] as [ImageData, string, number];
    expect(mime).toBe('image/jpeg');
    expect(quality).toBe(0.6);
  });

  it('reports progress, ending at 100', async () => {
    const backend = new HeicBackend();
    const onProgress = vi.fn();
    await backend.convert(heicBlob(), PNG, opts({ onProgress }));
    expect(onProgress).toHaveBeenCalled();
    const last = onProgress.mock.calls.at(-1)?.[0] as { percent: number };
    expect(last.percent).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Caps and abort
// ---------------------------------------------------------------------------

describe('HeicBackend.convert — limits & abort', () => {
  it('throws HeicInputTooLargeError when input exceeds the cap', async () => {
    const backend = new HeicBackend({ maxInputBytes: 8 });
    const input = heicBlob(64);
    expect(input.size).toBeGreaterThan(8);
    await expect(backend.convert(input, PNG, opts())).rejects.toBeInstanceOf(
      HeicInputTooLargeError,
    );
    expect(mockDecodeHeic).not.toHaveBeenCalled();
  });

  it('throws HeicDimensionsTooLargeError when decoded pixels exceed the cap', async () => {
    // Decoded mock is 8×8 = 64 px; maxPixels = 10 → too large.
    const backend = new HeicBackend({ maxPixels: 10 });
    await expect(backend.convert(heicBlob(), PNG, opts())).rejects.toBeInstanceOf(
      HeicDimensionsTooLargeError,
    );
  });

  it('throws an AbortError when the signal is already aborted', async () => {
    const backend = new HeicBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(
      backend.convert(heicBlob(), PNG, opts({ signal: controller.signal })),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// registerHeicBackend
// ---------------------------------------------------------------------------

describe('registerHeicBackend', () => {
  it('registers a HeicBackend in the given registry', () => {
    const registry = new BackendRegistry();
    registerHeicBackend(registry);
    expect(registry.list().some((b) => b.name === 'image-heic')).toBe(true);
  });

  it('rejects double registration', () => {
    const registry = new BackendRegistry();
    registerHeicBackend(registry);
    expect(() => registerHeicBackend(registry)).toThrow();
  });
});
