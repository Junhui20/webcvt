/**
 * Tests for pixel-bridge.ts — environment detection + imageDataToBlob with mocked canvas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const imageData = {
  data: new Uint8ClampedArray(4 * 4 * 4),
  width: 4,
  height: 4,
  colorSpace: 'srgb' as PredefinedColorSpace,
};

describe('hasPixelBridge', () => {
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

  it('returns false when OffscreenCanvas and document are both absent', () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', undefined);
    expect(hasPixelBridge()).toBe(false);
  });

  it('returns true when OffscreenCanvas is available', () => {
    setGlobal('OffscreenCanvas', class {});
    expect(hasPixelBridge()).toBe(true);
  });

  it('returns true via document.createElement fallback', () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', { createElement: vi.fn(() => ({})) });
    expect(hasPixelBridge()).toBe(true);
  });
});

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

  it('encodes via OffscreenCanvas.convertToBlob', async () => {
    const fakeBlob = new Blob(['png'], { type: 'image/png' });
    const convertToBlob = vi.fn(async () => fakeBlob);
    const putImageData = vi.fn();
    setGlobal(
      'OffscreenCanvas',
      vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ putImageData }), convertToBlob })),
    );
    const result = await imageDataToBlob(imageData, 'image/png');
    expect(result).toBe(fakeBlob);
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it('falls back to HTMLCanvasElement.toBlob', async () => {
    const fakeBlob = new Blob(['jpg'], { type: 'image/jpeg' });
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(fakeBlob),
      })),
    });
    expect(await imageDataToBlob(imageData, 'image/jpeg', 0.8)).toBe(fakeBlob);
  });

  it('rejects when toBlob yields null', async () => {
    setGlobal('OffscreenCanvas', undefined);
    setGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
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
