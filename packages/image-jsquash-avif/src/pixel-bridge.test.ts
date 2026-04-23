/**
 * Tests for pixel-bridge.ts.
 *
 * Since OffscreenCanvas and createImageBitmap are not available in Node/happy-dom,
 * we test hasPixelBridge() behaviour and verify the bridge functions properly
 * detect environment capabilities.
 *
 * The canvas bridge functions (imageDataToBlob, blobToImageData) are tested via
 * integration paths in backend.test.ts where the canvas APIs are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPixelBridge } from './pixel-bridge.ts';

// ---------------------------------------------------------------------------
// hasPixelBridge — environment detection
// ---------------------------------------------------------------------------

describe('hasPixelBridge', () => {
  it('returns false when OffscreenCanvas and document are both absent', () => {
    // In Node env (vitest default), neither OffscreenCanvas nor document is available.
    const original = globalThis.OffscreenCanvas;
    try {
      // Ensure OffscreenCanvas is undefined
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      // Ensure document is also undefined
      const originalDoc = globalThis.document;
      Object.defineProperty(globalThis, 'document', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = hasPixelBridge();
      // Restore
      Object.defineProperty(globalThis, 'document', {
        value: originalDoc,
        configurable: true,
        writable: true,
      });
      expect(result).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('returns true when OffscreenCanvas is available', () => {
    const MockOffscreenCanvas = class {};
    const original = globalThis.OffscreenCanvas;
    const originalCIB = globalThis.createImageBitmap;
    try {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: MockOffscreenCanvas,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'createImageBitmap', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
      expect(hasPixelBridge()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: original,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'createImageBitmap', {
        value: originalCIB,
        configurable: true,
        writable: true,
      });
    }
  });

  it('returns true when document.createElement is available with createImageBitmap', () => {
    const originalDoc = globalThis.document;
    const originalOC = globalThis.OffscreenCanvas;
    const originalCIB = globalThis.createImageBitmap;
    try {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'document', {
        value: { createElement: vi.fn(() => ({})) },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'createImageBitmap', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
      expect(hasPixelBridge()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        value: originalOC,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'document', {
        value: originalDoc,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'createImageBitmap', {
        value: originalCIB,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// imageDataToBlob and blobToImageData — with mocked canvas APIs
// ---------------------------------------------------------------------------

describe('imageDataToBlob — with mocked OffscreenCanvas', () => {
  let originalOC: unknown;
  let originalCIB: unknown;

  beforeEach(() => {
    originalOC = globalThis.OffscreenCanvas;
    originalCIB = globalThis.createImageBitmap;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: originalOC,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: originalCIB,
      configurable: true,
      writable: true,
    });
  });

  it('encodes ImageData to a blob via convertToBlob', async () => {
    const fakeBlob = new Blob(['fake png data'], { type: 'image/png' });
    const mockConvertToBlob = vi.fn(async () => fakeBlob);
    const mockPutImageData = vi.fn();
    const mockGetContext = vi.fn(() => ({
      putImageData: mockPutImageData,
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    }));

    const MockOffscreenCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: mockGetContext,
      convertToBlob: mockConvertToBlob,
    }));

    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: MockOffscreenCanvas,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });

    const { imageDataToBlob } = await import('./pixel-bridge.ts');
    const imageData = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
      colorSpace: 'srgb' as PredefinedColorSpace,
    };

    const result = await imageDataToBlob(imageData, 'image/png');
    expect(result).toBe(fakeBlob);
    expect(mockConvertToBlob).toHaveBeenCalledWith({ type: 'image/png', quality: undefined });
  });
});

describe('blobToImageData — with mocked createImageBitmap', () => {
  let originalOC: unknown;
  let originalCIB: unknown;

  beforeEach(() => {
    originalOC = globalThis.OffscreenCanvas;
    originalCIB = globalThis.createImageBitmap;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: originalOC,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: originalCIB,
      configurable: true,
      writable: true,
    });
  });

  it('calls createImageBitmap and extracts ImageData', async () => {
    const fakeImageData = {
      data: new Uint8ClampedArray(8 * 8 * 4),
      width: 8,
      height: 8,
    };
    const closeSpy = vi.fn();
    const mockGetImageData = vi.fn(() => fakeImageData);
    const mockGetContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: mockGetImageData,
      putImageData: vi.fn(),
    }));
    const mockBitmap = { width: 8, height: 8, close: closeSpy };

    const MockOffscreenCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: mockGetContext,
    }));

    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: MockOffscreenCanvas,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: vi.fn(async () => mockBitmap),
      configurable: true,
      writable: true,
    });

    const { blobToImageData } = await import('./pixel-bridge.ts');
    const blob = new Blob(['fake'], { type: 'image/png' });
    const result = await blobToImageData(blob);

    expect(result).toBe(fakeImageData);
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
