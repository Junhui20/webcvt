/**
 * Tests for pixel-bridge.ts — environment detection plus the canvas round-trip
 * functions exercised with mocked OffscreenCanvas / HTMLCanvasElement APIs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JxlDimensionsTooLargeError } from './errors.ts';
import { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// ---------------------------------------------------------------------------
// hasPixelBridge — environment detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// imageDataToBlob
// ---------------------------------------------------------------------------

describe('imageDataToBlob', () => {
  let oc: unknown;
  let doc: unknown;

  beforeEach(() => {
    oc = globalThis.OffscreenCanvas;
    doc = globalThis.document;
  });
  afterEach(() => {
    setGlobal('OffscreenCanvas', oc);
    setGlobal('document', doc);
  });

  const imageData = {
    data: new Uint8ClampedArray(4 * 4 * 4),
    width: 4,
    height: 4,
    colorSpace: 'srgb' as PredefinedColorSpace,
  };

  it('encodes via OffscreenCanvas.convertToBlob', async () => {
    const fakeBlob = new Blob(['png'], { type: 'image/png' });
    const convertToBlob = vi.fn(async () => fakeBlob);
    const putImageData = vi.fn();
    setGlobal(
      'OffscreenCanvas',
      vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData, drawImage: vi.fn(), getImageData: vi.fn() }),
        convertToBlob,
      })),
    );
    const result = await imageDataToBlob(imageData, 'image/png');
    expect(result).toBe(fakeBlob);
    expect(putImageData).toHaveBeenCalledOnce();
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/png', quality: undefined });
  });

  it('falls back to HTMLCanvasElement.toBlob when OffscreenCanvas is absent', async () => {
    const fakeBlob = new Blob(['jpg'], { type: 'image/jpeg' });
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(fakeBlob),
      })),
    });
    const result = await imageDataToBlob(imageData, 'image/jpeg', 0.8);
    expect(result).toBe(fakeBlob);
  });

  it('rejects when HTMLCanvasElement.toBlob yields null', async () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(null),
      })),
    });
    await expect(imageDataToBlob(imageData, 'image/jpeg')).rejects.toThrow(/null/);
  });

  it('throws when the 2D context is null', async () => {
    setGlobal(
      'OffscreenCanvas',
      vi.fn(() => ({ width: 0, height: 0, getContext: () => null })),
    );
    await expect(imageDataToBlob(imageData, 'image/png')).rejects.toThrow(/2D context/);
  });
});

// ---------------------------------------------------------------------------
// blobToImageData
// ---------------------------------------------------------------------------

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
    installCanvas(() => ({
      drawImage: vi.fn(),
      getImageData: () => fakeImageData,
      putImageData: vi.fn(),
    }));
    const result = await blobToImageData(new Blob(['x'], { type: 'image/png' }));
    expect(result).toBe(fakeImageData);
    expect(close).toHaveBeenCalledOnce();
  });

  it('throws JxlDimensionsTooLargeError and still closes the bitmap when too large', async () => {
    const close = vi.fn();
    setGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 6000, height: 5000, close })),
    );
    installCanvas(() => ({ drawImage: vi.fn(), getImageData: vi.fn(), putImageData: vi.fn() }));
    await expect(blobToImageData(new Blob(['x']))).rejects.toBeInstanceOf(
      JxlDimensionsTooLargeError,
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
