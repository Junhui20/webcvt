/**
 * Tests for backend.ts — the JPEG path runs natively in Node; the canvas path
 * uses a mocked pixel-bridge (and the real CompressionStream-backed deflate).
 */

import type { ConvertOptions, FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeImageData, makeJpegHeader } from './_test-helpers/fixtures.ts';
import { PdfDimensionsTooLargeError, PdfInputTooLargeError } from './errors.ts';

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

import { PdfBackend, registerPdfBackend } from './backend.ts';

const PDF: FormatDescriptor = { ext: 'pdf', mime: 'application/pdf', category: 'document' };
const JPEG: FormatDescriptor = { ext: 'jpeg', mime: 'image/jpeg', category: 'image' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };
const WEBP: FormatDescriptor = { ext: 'webp', mime: 'image/webp', category: 'image' };
const GIF: FormatDescriptor = { ext: 'gif', mime: 'image/gif', category: 'image' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };

function opts(partial: Partial<ConvertOptions> = {}): ConvertOptions {
  return partial as ConvertOptions;
}
const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPixelBridge.mockReturnValue(true);
  mockBlobToImageData.mockImplementation(async (_blob: Blob): Promise<ImageData> => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    return { data, width: 8, height: 8, colorSpace: 'srgb' } as ImageData;
  });
});

describe('PdfBackend.canHandle — bridge available', () => {
  const backend = new PdfBackend();

  it('JPEG → PDF: true', async () => expect(await backend.canHandle(JPEG, PDF)).toBe(true));
  it('PNG → PDF: true (bridge)', async () => expect(await backend.canHandle(PNG, PDF)).toBe(true));
  it('WebP → PDF: true (bridge)', async () =>
    expect(await backend.canHandle(WEBP, PDF)).toBe(true));
  it('GIF → PDF: true (bridge)', async () => expect(await backend.canHandle(GIF, PDF)).toBe(true));
  it('PNG → PNG: false (output not PDF)', async () =>
    expect(await backend.canHandle(PNG, PNG)).toBe(false));
  it('MP4 → PDF: false (unsupported source)', async () =>
    expect(await backend.canHandle(MP4, PDF)).toBe(false));
});

describe('PdfBackend.canHandle — bridge unavailable (Node)', () => {
  const backend = new PdfBackend();
  beforeEach(() => mockHasPixelBridge.mockReturnValue(false));

  it('JPEG → PDF still true (no bridge needed)', async () =>
    expect(await backend.canHandle(JPEG, PDF)).toBe(true));
  it('PNG → PDF: false (needs bridge)', async () =>
    expect(await backend.canHandle(PNG, PDF)).toBe(false));
});

describe('PdfBackend.convert — JPEG → PDF (native, no bridge)', () => {
  it('produces a real PDF embedding the JPEG via DCTDecode', async () => {
    const backend = new PdfBackend();
    const input = new Blob([makeJpegHeader(120, 60, 3)], { type: 'image/jpeg' });
    const result = await backend.convert(input, PDF, opts(), JPEG);
    expect(result.blob.type).toBe('application/pdf');
    expect(result.backend).toBe('image-pdf');
    const s = text(new Uint8Array(await result.blob.arrayBuffer()));
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s).toContain('/MediaBox [0 0 120 60]');
    expect(s).toContain('/Filter /DCTDecode');
    expect(mockBlobToImageData).not.toHaveBeenCalled();
  });

  it('reports terminal progress', async () => {
    const backend = new PdfBackend();
    const onProgress = vi.fn();
    await backend.convert(
      new Blob([makeJpegHeader(8, 8, 3)], { type: 'image/jpeg' }),
      PDF,
      opts({ onProgress }),
      JPEG,
    );
    const last = onProgress.mock.calls.at(-1)?.[0] as { percent: number };
    expect(last.percent).toBe(100);
  });
});

describe('PdfBackend.convert — PNG → PDF (bridge + Flate)', () => {
  it('bridges to ImageData then produces a FlateDecode PDF', async () => {
    mockBlobToImageData.mockResolvedValueOnce(makeImageData(8, 8, 255));
    const backend = new PdfBackend();
    const input = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await backend.convert(input, PDF, opts(), PNG);
    expect(mockBlobToImageData).toHaveBeenCalledOnce();
    const s = text(new Uint8Array(await result.blob.arrayBuffer()));
    expect(s).toContain('/Filter /FlateDecode');
    expect(s).toContain('%%EOF');
  });
});

describe('PdfBackend.convert — limits & abort', () => {
  it('throws PdfInputTooLargeError when input exceeds the cap', async () => {
    const backend = new PdfBackend({ maxInputBytes: 8 });
    await expect(
      backend.convert(new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), PDF, opts(), JPEG),
    ).rejects.toBeInstanceOf(PdfInputTooLargeError);
  });

  it('enforces the pixel cap on the JPEG path', async () => {
    const backend = new PdfBackend({ maxPixels: 100 });
    await expect(
      backend.convert(
        new Blob([makeJpegHeader(100, 100, 3)], { type: 'image/jpeg' }),
        PDF,
        opts(),
        JPEG,
      ),
    ).rejects.toBeInstanceOf(PdfDimensionsTooLargeError);
  });

  it('throws when the signal is already aborted', async () => {
    const backend = new PdfBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(
      backend.convert(
        new Blob([makeJpegHeader(8, 8, 3)], { type: 'image/jpeg' }),
        PDF,
        opts({ signal: controller.signal }),
        JPEG,
      ),
    ).rejects.toThrow();
  });
});

describe('registerPdfBackend', () => {
  it('registers a PdfBackend in the given registry', () => {
    const registry = new BackendRegistry();
    registerPdfBackend(registry);
    expect(registry.list().some((b) => b.name === 'image-pdf')).toBe(true);
  });

  it('rejects double registration', () => {
    const registry = new BackendRegistry();
    registerPdfBackend(registry);
    expect(() => registerPdfBackend(registry)).toThrow();
  });
});
