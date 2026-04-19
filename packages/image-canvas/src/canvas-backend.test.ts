import type { FormatDescriptor } from '@webcvt/core';
import { UnsupportedFormatError } from '@webcvt/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasBackend } from './canvas-backend.ts';

// ---------------------------------------------------------------------------
// Format descriptors under test
// ---------------------------------------------------------------------------

const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const JPEG: FormatDescriptor = { ext: 'jpeg', mime: 'image/jpeg', category: 'image' };
const JPG: FormatDescriptor = { ext: 'jpg', mime: 'image/jpeg', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const BMP: FormatDescriptor = { ext: 'bmp', mime: 'image/bmp', category: 'image' };
const ICO: FormatDescriptor = { ext: 'ico', mime: 'image/x-icon', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Creates a mock ImageBitmap with given dimensions. */
function makeImageBitmap(width = 16, height = 16): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** Creates a mock OffscreenCanvas that returns the given blob from convertToBlob. */
function makeOffscreenCanvas(blobResult: Blob, pixelData?: Uint8ClampedArray) {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: pixelData ?? new Uint8ClampedArray(16 * 16 * 4),
    }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(ctx),
    convertToBlob: vi.fn().mockResolvedValue(blobResult),
  };
  return { canvas, ctx };
}

/** A minimal real Blob for testing. */
function makeBlob(mime = 'image/png'): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type: mime });
}

/** Stub globalThis.createImageBitmap to return a mock bitmap. */
function stubCreateImageBitmap(bitmap: ImageBitmap): void {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
}

// ---------------------------------------------------------------------------
// Tests — canHandle
// ---------------------------------------------------------------------------

describe('CanvasBackend.canHandle', () => {
  const backend = new CanvasBackend();

  it('returns true for PNG → WebP', async () => {
    expect(await backend.canHandle(PNG, WEBP)).toBe(true);
  });

  it('returns true for PNG → JPEG', async () => {
    expect(await backend.canHandle(PNG, JPEG)).toBe(true);
  });

  it('returns true for PNG → JPG', async () => {
    expect(await backend.canHandle(PNG, JPG)).toBe(true);
  });

  it('returns true for PNG → BMP', async () => {
    expect(await backend.canHandle(PNG, BMP)).toBe(true);
  });

  it('returns true for PNG → ICO', async () => {
    expect(await backend.canHandle(PNG, ICO)).toBe(true);
  });

  it('returns true for PNG → PNG', async () => {
    expect(await backend.canHandle(PNG, PNG)).toBe(true);
  });

  it('returns true for GIF → PNG (GIF input allowed)', async () => {
    expect(await backend.canHandle(GIF, PNG)).toBe(true);
  });

  it('returns true for WebP → PNG', async () => {
    expect(await backend.canHandle(WEBP, PNG)).toBe(true);
  });

  it('returns true for JPEG → PNG', async () => {
    expect(await backend.canHandle(JPEG, PNG)).toBe(true);
  });

  it('returns false for GIF → GIF (GIF output not supported)', async () => {
    expect(await backend.canHandle(GIF, GIF)).toBe(false);
  });

  it('returns false for PNG → GIF (GIF output not supported)', async () => {
    expect(await backend.canHandle(PNG, GIF)).toBe(false);
  });

  it('returns false for MP4 → PNG (video input not supported)', async () => {
    expect(await backend.canHandle(MP4, PNG)).toBe(false);
  });

  it('returns false for PNG → MP4 (video output not supported)', async () => {
    expect(await backend.canHandle(PNG, MP4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — convert
// ---------------------------------------------------------------------------

describe('CanvasBackend.convert', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('PNG → WebP', () => {
    it('returns a Blob with image/webp mime type', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/webp');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, WEBP, { format: WEBP });

      expect(result.blob.type).toBe('image/webp');
      expect(result.format).toBe(WEBP);
      expect(result.backend).toBe('canvas');
    });

    it('passes quality option to convertToBlob', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/webp');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      await backend.convert(inputBlob, WEBP, { format: WEBP, quality: 0.75 });

      expect(canvas.convertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.75 });
    });
  });

  describe('PNG → JPEG', () => {
    it('returns a Blob with image/jpeg mime type', async () => {
      const bitmap = makeImageBitmap(32, 32);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/jpeg');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, JPEG, { format: JPEG, quality: 0.9 });

      expect(result.blob.type).toBe('image/jpeg');
    });

    it('uses default quality 0.92 when quality is not specified', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/jpeg');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      await backend.convert(inputBlob, JPEG, { format: JPEG });

      expect(canvas.convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.92 });
    });
  });

  describe('WebP → PNG', () => {
    it('converts WebP input to PNG output', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/webp');
      const result = await backend.convert(inputBlob, PNG, { format: PNG });

      expect(result.blob.type).toBe('image/png');
    });
  });

  describe('JPEG → PNG', () => {
    it('converts JPEG input to PNG output', async () => {
      const bitmap = makeImageBitmap(24, 24);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/jpeg');
      const result = await backend.convert(inputBlob, PNG, { format: PNG });

      expect(result.blob.type).toBe('image/png');
      expect(result.hardwareAccelerated).toBe(false);
    });
  });

  describe('PNG → ICO', () => {
    it('wraps PNG output in an ICO container', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      // convertToBlob returns a PNG that gets wrapped in ICO
      const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
      const { canvas } = makeOffscreenCanvas(pngBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, ICO, { format: ICO });

      expect(result.format).toBe(ICO);
      expect(result.blob.type).toBe('image/x-icon');
    });

    it('ICO blob is larger than raw PNG payload by 22 header bytes', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const pngPayload = new Uint8Array(100);
      const pngBlob = new Blob([pngPayload], { type: 'image/png' });
      const { canvas } = makeOffscreenCanvas(pngBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, ICO, { format: ICO });

      expect(result.blob.size).toBe(100 + 22);
    });
  });

  describe('PNG → BMP fallback', () => {
    it('uses BMP writer fallback when convertToBlob returns non-bmp mime', async () => {
      const bitmap = makeImageBitmap(2, 2);
      stubCreateImageBitmap(bitmap);

      // Browser doesn't support image/bmp — returns image/png instead
      const fallbackBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
      const pixelData = new Uint8ClampedArray(2 * 2 * 4);
      const { canvas } = makeOffscreenCanvas(fallbackBlob, pixelData);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, BMP, { format: BMP });

      expect(result.format).toBe(BMP);
      expect(result.blob.type).toBe('image/bmp');
    });

    it('BMP output is at least 54 bytes for a 1×1 image', async () => {
      const bitmap = makeImageBitmap(1, 1);
      stubCreateImageBitmap(bitmap);

      const fallbackBlob = new Blob([new Uint8Array([1])], { type: 'image/png' });
      const pixelData = new Uint8ClampedArray(1 * 1 * 4);
      pixelData[0] = 255; // R
      pixelData[1] = 0; // G
      pixelData[2] = 0; // B
      pixelData[3] = 255; // A
      const { canvas } = makeOffscreenCanvas(fallbackBlob, pixelData);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');
      const result = await backend.convert(inputBlob, BMP, { format: BMP });

      expect(result.blob.size).toBeGreaterThanOrEqual(54);
    });
  });

  describe('unsupported formats', () => {
    it('throws UnsupportedFormatError for GIF output', async () => {
      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');

      await expect(backend.convert(inputBlob, GIF, { format: GIF })).rejects.toThrow(
        UnsupportedFormatError,
      );
    });

    it('throws UnsupportedFormatError for video output', async () => {
      const backend = new CanvasBackend();
      const inputBlob = makeBlob('image/png');

      await expect(backend.convert(inputBlob, MP4, { format: MP4 })).rejects.toThrow(
        UnsupportedFormatError,
      );
    });

    it('throws UnsupportedFormatError for video input', async () => {
      const backend = new CanvasBackend();
      const inputBlob = makeBlob('video/mp4');

      await expect(backend.convert(inputBlob, PNG, { format: PNG })).rejects.toThrow(
        UnsupportedFormatError,
      );
    });
  });

  describe('result metadata', () => {
    it('result.backend is "canvas"', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const result = await backend.convert(makeBlob(), PNG, { format: PNG });

      expect(result.backend).toBe('canvas');
    });

    it('result.durationMs is a non-negative number', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const result = await backend.convert(makeBlob(), PNG, { format: PNG });

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('result.hardwareAccelerated is false', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      const result = await backend.convert(makeBlob(), PNG, { format: PNG });

      expect(result.hardwareAccelerated).toBe(false);
    });

    it('closes the ImageBitmap after conversion', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const { canvas } = makeOffscreenCanvas(outputBlob);
      vi.stubGlobal(
        'OffscreenCanvas',
        vi.fn().mockImplementation(() => canvas),
      );

      const backend = new CanvasBackend();
      await backend.convert(makeBlob(), PNG, { format: PNG });

      expect(bitmap.close).toHaveBeenCalledOnce();
    });
  });

  describe('HTMLCanvasElement fallback', () => {
    beforeEach(() => {
      // Remove OffscreenCanvas to trigger the HTMLCanvasElement path
      vi.stubGlobal('OffscreenCanvas', undefined);
    });

    it('falls back to HTMLCanvasElement when OffscreenCanvas is unavailable', async () => {
      const bitmap = makeImageBitmap(16, 16);
      stubCreateImageBitmap(bitmap);

      const outputBlob = makeBlob('image/png');
      const ctx = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(16 * 16 * 4) }),
      };
      const htmlCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(ctx),
        toBlob: vi.fn().mockImplementation((cb: (b: Blob) => void) => cb(outputBlob)),
      };
      vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(htmlCanvas) });

      const backend = new CanvasBackend();
      const result = await backend.convert(makeBlob(), PNG, { format: PNG });

      expect(result.blob.type).toBe('image/png');
    });
  });
});
