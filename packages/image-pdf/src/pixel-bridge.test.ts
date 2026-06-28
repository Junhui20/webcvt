/**
 * Tests for pixel-bridge.ts — environment detection + the decode-only
 * blobToImageData path with mocked OffscreenCanvas / createImageBitmap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfDimensionsTooLargeError } from './errors.ts';
import { blobToImageData, hasPixelBridge } from './pixel-bridge.ts';

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

describe('hasPixelBridge', () => {
  let oc: unknown;
  let doc: unknown;
  let cib: unknown;

  beforeEach(() => {
    oc = globalThis.OffscreenCanvas;
    doc = globalThis.document;
    cib = globalThis.createImageBitmap;
  });
  afterEach(() => {
    setGlobal('OffscreenCanvas', oc);
    setGlobal('document', doc);
    setGlobal('createImageBitmap', cib);
  });

  it('returns false when OffscreenCanvas and document are both absent', () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', undefined);
    setGlobal('createImageBitmap', vi.fn());
    expect(hasPixelBridge()).toBe(false);
  });

  it('returns false when createImageBitmap is absent', () => {
    setGlobal('OffscreenCanvas', class {});
    setGlobal('createImageBitmap', undefined);
    expect(hasPixelBridge()).toBe(false);
  });

  it('returns true when OffscreenCanvas + createImageBitmap are available', () => {
    setGlobal('OffscreenCanvas', class {});
    setGlobal('createImageBitmap', vi.fn());
    expect(hasPixelBridge()).toBe(true);
  });

  it('returns true via document.createElement fallback', () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', { createElement: vi.fn(() => ({})) });
    setGlobal('createImageBitmap', vi.fn());
    expect(hasPixelBridge()).toBe(true);
  });
});

describe('blobToImageData', () => {
  let oc: unknown;
  let cib: unknown;

  beforeEach(() => {
    oc = globalThis.OffscreenCanvas;
    cib = globalThis.createImageBitmap;
  });
  afterEach(() => {
    setGlobal('OffscreenCanvas', oc);
    setGlobal('createImageBitmap', cib);
  });

  function installCanvas(getContext: () => unknown): void {
    setGlobal(
      'OffscreenCanvas',
      vi.fn(() => ({ width: 0, height: 0, getContext })),
    );
  }

  it('decodes a blob to ImageData and closes the bitmap', async () => {
    const fakeImageData = { data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 };
    const close = vi.fn();
    setGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 8, height: 8, close })),
    );
    installCanvas(() => ({ drawImage: vi.fn(), getImageData: () => fakeImageData }));
    expect(await blobToImageData(new Blob(['x'], { type: 'image/png' }))).toBe(fakeImageData);
    expect(close).toHaveBeenCalledOnce();
  });

  it('throws PdfDimensionsTooLargeError and still closes the bitmap when too large', async () => {
    const close = vi.fn();
    setGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 6000, height: 5000, close })),
    );
    installCanvas(() => ({ drawImage: vi.fn(), getImageData: vi.fn() }));
    await expect(blobToImageData(new Blob(['x']))).rejects.toBeInstanceOf(
      PdfDimensionsTooLargeError,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('throws when the 2D context is null (and closes the bitmap)', async () => {
    const close = vi.fn();
    setGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4, height: 4, close })),
    );
    installCanvas(() => null);
    await expect(blobToImageData(new Blob(['x']))).rejects.toThrow(/2D context/);
    expect(close).toHaveBeenCalledOnce();
  });
});
