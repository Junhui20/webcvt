/**
 * Tests for backend.ts — mocks @jsquash/avif and pixel-bridge for Node env.
 *
 * Covers:
 * - canHandle matrix (all true/false cells)
 * - canHandle in Node (no OffscreenCanvas → bridge paths false)
 * - convert AVIF→AVIF
 * - convert AVIF→PNG (bridge)
 * - convert PNG→AVIF (bridge)
 * - AbortSignal support
 * - Input size / pixel count caps
 * - registerAvifBackend
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockDecode,
  mockEncode,
  resetMockJsquash,
  setupMockJsquash,
} from './_test-helpers/mock-jsquash.ts';
import { AVIF_MIME, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { AvifDimensionsTooLargeError, AvifInputTooLargeError } from './errors.ts';

vi.mock('@jsquash/avif', () => setupMockJsquash());

// vi.hoisted() runs before vi.mock() factories, so these variables are safely
// accessible inside the vi.mock('./pixel-bridge.ts') factory below.
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

import { AvifBackend, registerAvifBackend } from './backend.ts';
import { disposeAvif } from './loader.ts';

// ---------------------------------------------------------------------------
// Format descriptors for testing
// ---------------------------------------------------------------------------

const AVIF = { ext: 'avif', mime: 'image/avif', category: 'image' as const };
const PNG = { ext: 'png', mime: 'image/png', category: 'image' as const };
const JPEG = { ext: 'jpg', mime: 'image/jpeg', category: 'image' as const };
const WEBP = { ext: 'webp', mime: 'image/webp', category: 'image' as const };
const GIF = { ext: 'gif', mime: 'image/gif', category: 'image' as const };
const MP4 = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };

/** Creates a plain ImageData-compatible object without requiring DOM. */
function makeImageDataLike(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

beforeEach(() => {
  disposeAvif();
  resetMockJsquash();
  vi.clearAllMocks();
  // Restore mocked pixel bridge defaults
  mockHasPixelBridge.mockReturnValue(true);
  mockImageDataToBlob.mockImplementation(async (_imageData: ImageData, mime: string) => {
    return new Blob(['fake output'], { type: mime });
  });
  mockBlobToImageData.mockImplementation(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  });
});

// ---------------------------------------------------------------------------
// canHandle matrix
// ---------------------------------------------------------------------------

describe('AvifBackend.canHandle — matrix (bridge available)', () => {
  const backend = new AvifBackend();

  it('AVIF → AVIF: true', async () => {
    expect(await backend.canHandle(AVIF, AVIF)).toBe(true);
  });

  it('AVIF → PNG: true (pixel bridge)', async () => {
    expect(await backend.canHandle(AVIF, PNG)).toBe(true);
  });

  it('AVIF → JPEG: true (pixel bridge)', async () => {
    expect(await backend.canHandle(AVIF, JPEG)).toBe(true);
  });

  it('AVIF → WebP: true (pixel bridge)', async () => {
    expect(await backend.canHandle(AVIF, WEBP)).toBe(true);
  });

  it('PNG → AVIF: true (pixel bridge)', async () => {
    expect(await backend.canHandle(PNG, AVIF)).toBe(true);
  });

  it('JPEG → AVIF: true (pixel bridge)', async () => {
    expect(await backend.canHandle(JPEG, AVIF)).toBe(true);
  });

  it('WebP → AVIF: true (pixel bridge)', async () => {
    expect(await backend.canHandle(WEBP, AVIF)).toBe(true);
  });

  it('PNG → PNG: false (no AVIF on either side)', async () => {
    expect(await backend.canHandle(PNG, PNG)).toBe(false);
  });

  it('PNG → JPEG: false (no AVIF on either side)', async () => {
    expect(await backend.canHandle(PNG, JPEG)).toBe(false);
  });

  it('AVIF → GIF: false (GIF not in canvas-encodable set)', async () => {
    expect(await backend.canHandle(AVIF, GIF)).toBe(false);
  });

  it('GIF → AVIF: false (GIF not in canvas-decodable set)', async () => {
    expect(await backend.canHandle(GIF, AVIF)).toBe(false);
  });

  it('AVIF → MP4: false (video output not supported)', async () => {
    expect(await backend.canHandle(AVIF, MP4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canHandle — Node env (no OffscreenCanvas)
// ---------------------------------------------------------------------------

describe('AvifBackend.canHandle — no pixel bridge (Node env)', () => {
  it('AVIF → AVIF: true even without bridge', async () => {
    mockHasPixelBridge.mockReturnValue(false);
    const backend = new AvifBackend();
    expect(await backend.canHandle(AVIF, AVIF)).toBe(true);
  });

  it('AVIF → PNG: false without bridge', async () => {
    mockHasPixelBridge.mockReturnValue(false);
    const backend = new AvifBackend();
    expect(await backend.canHandle(AVIF, PNG)).toBe(false);
  });

  it('PNG → AVIF: false without bridge', async () => {
    mockHasPixelBridge.mockReturnValue(false);
    const backend = new AvifBackend();
    expect(await backend.canHandle(PNG, AVIF)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canHandle — does NOT trigger wasm load (Trap §1)
// ---------------------------------------------------------------------------

describe('AvifBackend.canHandle — no wasm load', () => {
  it('canHandle does not call decode or encode', async () => {
    const backend = new AvifBackend();
    await backend.canHandle(AVIF, AVIF);
    expect(mockDecode).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// convert — AVIF → AVIF
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — AVIF → AVIF', () => {
  it('round-trips AVIF data through decode + encode', async () => {
    const backend = new AvifBackend();
    const fakeAvif = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]);
    const input = new Blob([fakeAvif], { type: AVIF_MIME });

    const result = await backend.convert(input, AVIF, { format: 'avif' });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe(AVIF_MIME);
    expect(result.backend).toBe('image-jsquash-avif');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockDecode).toHaveBeenCalledOnce();
    expect(mockEncode).toHaveBeenCalledOnce();
  });

  it('maps ConvertOptions.quality (0–1) to jsquash cqLevel (0–62)', async () => {
    const backend = new AvifBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: AVIF_MIME });
    // quality 0.75 → quality 75 → cqLevel = round((1 - 0.75) * 62) = round(15.5) = 16
    await backend.convert(input, AVIF, { format: 'avif', quality: 0.75 });

    const [, calledOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, number>];
    expect(calledOpts.cqLevel).toBe(16);
  });

  it('merges constructor encode defaults with per-call quality', async () => {
    const backend = new AvifBackend({ encode: { speed: 3 } });
    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });
    // quality 0.8 → quality 80 → cqLevel = round((1 - 0.8) * 62) = round(12.4) = 12
    await backend.convert(input, AVIF, { format: 'avif', quality: 0.8 });

    const [, calledOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, number>];
    expect(calledOpts.cqLevel).toBe(12);
    expect(calledOpts.speed).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// convert — AVIF → PNG (pixel bridge)
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — AVIF → PNG', () => {
  it('decodes AVIF then returns a PNG blob via bridge', async () => {
    const backend = new AvifBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: AVIF_MIME });
    const result = await backend.convert(input, PNG, { format: 'png' });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(mockDecode).toHaveBeenCalledOnce();
    expect(mockImageDataToBlob).toHaveBeenCalledOnce();
    // encode should NOT be called for AVIF→PNG path
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// convert — PNG → AVIF (pixel bridge)
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — PNG → AVIF', () => {
  it('decodes PNG via bridge then encodes to AVIF', async () => {
    const backend = new AvifBackend();
    const pngBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

    const result = await backend.convert(pngBlob, AVIF, { format: 'avif' });

    expect(result.blob.type).toBe(AVIF_MIME);
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    expect(mockEncode).toHaveBeenCalledOnce();
    // decode should NOT be called for PNG→AVIF path
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Input size cap
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — input size cap', () => {
  it('throws AvifInputTooLargeError before any wasm call', async () => {
    const backend = new AvifBackend();
    const oversized = new Blob([new Uint8Array(1)], { type: AVIF_MIME });
    // Mock size property to exceed limit
    Object.defineProperty(oversized, 'size', { value: MAX_INPUT_BYTES + 1 });

    await expect(backend.convert(oversized, AVIF, { format: 'avif' })).rejects.toBeInstanceOf(
      AvifInputTooLargeError,
    );
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MAX_PIXELS cap
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — MAX_PIXELS cap', () => {
  it('throws AvifDimensionsTooLargeError after decode when pixels > MAX_PIXELS', async () => {
    const backend = new AvifBackend();
    // Mock decode to return a huge ImageData-like object
    mockDecode.mockResolvedValueOnce(makeImageDataLike(10001, 10001));

    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });
    await expect(backend.convert(input, AVIF, { format: 'avif' })).rejects.toBeInstanceOf(
      AvifDimensionsTooLargeError,
    );
  });

  it('respects custom maxPixels constructor option', async () => {
    const backend = new AvifBackend({ maxPixels: 16 }); // tiny limit
    mockDecode.mockResolvedValueOnce(makeImageDataLike(5, 5)); // 25 > 16

    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });
    await expect(backend.convert(input, AVIF, { format: 'avif' })).rejects.toBeInstanceOf(
      AvifDimensionsTooLargeError,
    );
  });
});

// ---------------------------------------------------------------------------
// AbortSignal
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — AbortSignal', () => {
  it('throws AbortError when signal is already aborted before convert', async () => {
    const backend = new AvifBackend();
    const ac = new AbortController();
    ac.abort();

    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });
    await expect(
      backend.convert(input, AVIF, { format: 'avif', signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ---------------------------------------------------------------------------
// onProgress
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — onProgress', () => {
  it('calls onProgress with increasing percent values', async () => {
    const backend = new AvifBackend();
    const percents: number[] = [];
    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });

    await backend.convert(input, AVIF, {
      format: 'avif',
      onProgress: (ev) => percents.push(ev.percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(percents[percents.length - 1]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// registerAvifBackend
// ---------------------------------------------------------------------------

describe('registerAvifBackend', () => {
  it('registers the backend with the provided registry', () => {
    const registry = new BackendRegistry();
    registerAvifBackend(registry);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.name).toBe('image-jsquash-avif');
  });

  it('throws when registering the same backend name twice', () => {
    const registry = new BackendRegistry();
    registerAvifBackend(registry);
    expect(() => registerAvifBackend(registry)).toThrow();
  });

  it('passes constructor options to the backend', async () => {
    const registry = new BackendRegistry();
    registerAvifBackend(registry, { encode: { quality: 90, speed: 2 } });
    const backend = registry.list()[0];
    expect(backend?.name).toBe('image-jsquash-avif');
    // Verify the options were forwarded by checking encode calls
    const input = new Blob([new Uint8Array([1])], { type: AVIF_MIME });
    await backend?.convert(input, AVIF, { format: 'avif' });
    const [, calledOpts] = mockEncode.mock.calls[0] as [ImageData, Record<string, number>];
    // quality 90 → cqLevel = round((1 - 0.9) * 62) = round(6.2) = 6
    expect(calledOpts.cqLevel).toBe(6);
    expect(calledOpts.speed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// HIGH-6 regression: convert() routing uses FormatDescriptor.mime, not Blob.type
// ---------------------------------------------------------------------------

describe('AvifBackend.convert — HIGH-6 regression: empty Blob.type routing', () => {
  it('AVIF blob with empty Blob.type takes AVIF→AVIF path when inputFormat.mime = AVIF', async () => {
    const backend = new AvifBackend();
    // AVIF bytes, but Blob.type is '' (caller forgot to set it)
    const emptyTypeBlob = new Blob([new Uint8Array([1, 2, 3])]);
    expect(emptyTypeBlob.type).toBe(''); // confirm type is empty

    // Pass inputFormat with the authoritative MIME
    const result = await backend.convert(emptyTypeBlob, AVIF, { format: 'avif' }, AVIF);

    expect(result.blob.type).toBe(AVIF_MIME);
    // decode + encode both called → AVIF→AVIF path was taken, not canvas path
    expect(mockDecode).toHaveBeenCalledOnce();
    expect(mockEncode).toHaveBeenCalledOnce();
    expect(mockBlobToImageData).not.toHaveBeenCalled();
  });

  it('AVIF blob with empty Blob.type + no inputFormat falls back to Blob.type (canvas path)', async () => {
    const backend = new AvifBackend();
    // Empty type blob, output is AVIF — with no inputFormat, Blob.type='' → isAvifIn=false → canvas path
    const emptyTypeBlob = new Blob([new Uint8Array([1, 2, 3])]);
    expect(emptyTypeBlob.type).toBe('');

    // Without inputFormat, routing falls back to Blob.type (empty) → not AVIF → canvas→AVIF path
    const result = await backend.convert(emptyTypeBlob, AVIF, { format: 'avif' });
    expect(result.blob.type).toBe(AVIF_MIME);
    // canvas path was taken (blobToImageData called, decode was not)
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('PNG blob with AVIF output uses bridge path (inputFormat=PNG)', async () => {
    const backend = new AvifBackend();
    const pngBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

    const result = await backend.convert(pngBlob, AVIF, { format: 'avif' }, PNG);
    expect(result.blob.type).toBe(AVIF_MIME);
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HIGH-4 regression: AvifBackendOptions no longer has 'load' field
// ---------------------------------------------------------------------------

describe('AvifBackend — HIGH-4 regression: no load option in constructor', () => {
  it('AvifBackend can be instantiated without any options', () => {
    expect(() => new AvifBackend()).not.toThrow();
  });

  it('AvifBackend options only accept encode, maxInputBytes, maxPixels', async () => {
    // This should compile and work correctly
    const backend = new AvifBackend({
      encode: { quality: 80 },
      maxInputBytes: 1024 * 1024,
      maxPixels: 1000,
    });
    expect(backend.name).toBe('image-jsquash-avif');
  });
});

// ---------------------------------------------------------------------------
// name property
// ---------------------------------------------------------------------------

describe('AvifBackend.name', () => {
  it('is "image-jsquash-avif"', () => {
    const backend = new AvifBackend();
    expect(backend.name).toBe('image-jsquash-avif');
  });
});
