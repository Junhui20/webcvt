import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blobToImageData,
  canvasToBlob,
  createCanvas,
  hasPixelBridge,
  imageDataToBlob,
} from './pixel.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Creates a mock ImageBitmap with given dimensions. */
function makeImageBitmap(width = 16, height = 16): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** Creates a mock 2D context. */
function makeCtx(pixelData?: Uint8ClampedArray) {
  return {
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      width: 16,
      height: 16,
      data: pixelData ?? new Uint8ClampedArray(16 * 16 * 4),
    }),
  };
}

/**
 * Stubs globalThis.OffscreenCanvas with a fake constructor whose instances use
 * the given ctx and convertToBlob result. Returns the created instances.
 */
function stubOffscreenCanvas(ctx: ReturnType<typeof makeCtx> | null, blobResult?: Blob) {
  const instances: Array<Record<string, unknown>> = [];
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    getContext = vi.fn().mockReturnValue(ctx);
    convertToBlob = vi.fn().mockResolvedValue(blobResult ?? makeBlob());
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      instances.push(this as unknown as Record<string, unknown>);
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return instances;
}

/** A minimal real Blob for testing. */
function makeBlob(mime = 'image/png'): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type: mime });
}

/** A minimal fake ImageData. */
function makeImageData(width = 4, height = 4): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as unknown as ImageData;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// hasPixelBridge
// ---------------------------------------------------------------------------

describe('hasPixelBridge', () => {
  it('returns false in a bare Node environment (no canvas at all)', () => {
    expect(hasPixelBridge()).toBe(false);
  });

  it('returns true with OffscreenCanvas + createImageBitmap', () => {
    stubOffscreenCanvas(makeCtx());
    vi.stubGlobal('createImageBitmap', vi.fn());
    expect(hasPixelBridge()).toBe(true);
  });

  it('returns false with OffscreenCanvas but no createImageBitmap (decode required by default)', () => {
    stubOffscreenCanvas(makeCtx());
    expect(hasPixelBridge()).toBe(false);
  });

  it('returns true without createImageBitmap when requireImageBitmap is false', () => {
    stubOffscreenCanvas(makeCtx());
    expect(hasPixelBridge({ requireImageBitmap: false })).toBe(true);
  });

  it('returns true via the document.createElement fallback', () => {
    vi.stubGlobal('document', { createElement: vi.fn() });
    vi.stubGlobal('createImageBitmap', vi.fn());
    expect(hasPixelBridge()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createCanvas
// ---------------------------------------------------------------------------

describe('createCanvas', () => {
  it('prefers OffscreenCanvas and sets dimensions', () => {
    const instances = stubOffscreenCanvas(makeCtx());
    const canvas = createCanvas(32, 24);
    expect(instances).toHaveLength(1);
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(24);
  });

  it('falls back to document.createElement("canvas") without OffscreenCanvas', () => {
    const el = { width: 0, height: 0, getContext: vi.fn() };
    const createElement = vi.fn().mockReturnValue(el);
    vi.stubGlobal('document', { createElement });
    const canvas = createCanvas(10, 20);
    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// canvasToBlob
// ---------------------------------------------------------------------------

describe('canvasToBlob', () => {
  it('uses convertToBlob when available (OffscreenCanvas path)', async () => {
    const blob = makeBlob('image/webp');
    stubOffscreenCanvas(makeCtx(), blob);
    const canvas = createCanvas(4, 4);
    const out = await canvasToBlob(canvas, 'image/webp', 0.8);
    expect(out).toBe(blob);
    const oc = canvas as unknown as { convertToBlob: ReturnType<typeof vi.fn> };
    expect(oc.convertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.8 });
  });

  it('wraps HTMLCanvasElement.toBlob in a Promise', async () => {
    const blob = makeBlob('image/jpeg');
    const canvas = {
      width: 4,
      height: 4,
      getContext: vi.fn(),
      toBlob: (cb: (b: Blob | null) => void, _type: string, _quality?: number) => cb(blob),
    };
    await expect(canvasToBlob(canvas, 'image/jpeg', 0.5)).resolves.toBe(blob);
  });

  it('rejects with the default error when toBlob yields null', async () => {
    const canvas = {
      width: 4,
      height: 4,
      getContext: vi.fn(),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    };
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toThrow(/toBlob produced null/);
  });

  it('rejects with the injected error when toBlob yields null', async () => {
    const canvas = {
      width: 4,
      height: 4,
      getContext: vi.fn(),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    };
    class MyError extends Error {}
    await expect(
      canvasToBlob(canvas, 'image/png', undefined, () => new MyError('x')),
    ).rejects.toThrow(MyError);
  });
});

// ---------------------------------------------------------------------------
// imageDataToBlob (encode side)
// ---------------------------------------------------------------------------

describe('imageDataToBlob', () => {
  it('paints the ImageData and returns the encoded blob', async () => {
    const blob = makeBlob('image/png');
    const ctx = makeCtx();
    stubOffscreenCanvas(ctx, blob);
    const imageData = makeImageData(4, 4);

    const out = await imageDataToBlob(imageData, 'image/png');
    expect(out).toBe(blob);
    expect(ctx.putImageData).toHaveBeenCalledWith(imageData, 0, 0);
  });

  it('throws the default error when no 2D context is available', async () => {
    stubOffscreenCanvas(null);
    await expect(imageDataToBlob(makeImageData(), 'image/png')).rejects.toThrow(
      /Could not get 2D context .* \(imageDataToBlob\)/,
    );
  });

  it('throws the injected encodeContextError when no 2D context is available', async () => {
    stubOffscreenCanvas(null);
    class EncodeError extends Error {}
    await expect(
      imageDataToBlob(makeImageData(), 'image/png', undefined, {
        encodeContextError: () => new EncodeError('no ctx'),
      }),
    ).rejects.toThrow(EncodeError);
  });
});

// ---------------------------------------------------------------------------
// blobToImageData (decode side)
// ---------------------------------------------------------------------------

describe('blobToImageData', () => {
  it('decodes via createImageBitmap, reads pixels, and closes the bitmap', async () => {
    const bitmap = makeImageBitmap(16, 16);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const ctx = makeCtx();
    stubOffscreenCanvas(ctx);

    const out = await blobToImageData(makeBlob());
    expect(out.width).toBe(16);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 16, 16);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('enforces maxPixels before painting and still closes the bitmap', async () => {
    const bitmap = makeImageBitmap(100, 100);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const ctx = makeCtx();
    stubOffscreenCanvas(ctx);

    await expect(blobToImageData(makeBlob(), 9_999)).rejects.toThrow(/exceeds the 9999-pixel cap/);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('throws the injected dimensionsTooLargeError when over the cap', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(makeImageBitmap(100, 100)));
    stubOffscreenCanvas(makeCtx());
    class TooBigError extends Error {}
    await expect(
      blobToImageData(makeBlob(), 9_999, {
        dimensionsTooLargeError: (w, h, max) => new TooBigError(`${w}x${h}>${max}`),
      }),
    ).rejects.toThrow(TooBigError);
  });

  it('throws the decode context error when no 2D context is available', async () => {
    const bitmap = makeImageBitmap(8, 8);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    stubOffscreenCanvas(null);

    await expect(blobToImageData(makeBlob())).rejects.toThrow(
      /Could not get 2D context .* \(blobToImageData\)/,
    );
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('throws the injected decodeContextError when no 2D context is available', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(makeImageBitmap(8, 8)));
    stubOffscreenCanvas(null);
    class DecodeError extends Error {}
    await expect(
      blobToImageData(makeBlob(), undefined, {
        decodeContextError: () => new DecodeError('no ctx'),
      }),
    ).rejects.toThrow(DecodeError);
  });
});
