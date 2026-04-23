/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Provides two conversions:
 * - imageDataToBlob: ImageData → Blob via OffscreenCanvas (or HTMLCanvasElement fallback)
 * - blobToImageData:  Blob → ImageData via createImageBitmap → OffscreenCanvas
 *
 * Used for cross-format paths (e.g. PNG→AVIF, AVIF→PNG) where a canvas round-trip
 * is needed to convert between canvas-native formats and AVIF.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. When typeof OffscreenCanvas
 * is 'undefined', callers should gate these paths via hasPixelBridge() before calling.
 */

import { MAX_PIXELS } from './constants.ts';
import { AvifDecodeError, AvifDimensionsTooLargeError, AvifEncodeError } from './errors.ts';

// ---------------------------------------------------------------------------
// OffscreenCanvas vs HTMLCanvasElement bridge (mirrors image-canvas pattern)
// ---------------------------------------------------------------------------

/** Minimal interface covering both OffscreenCanvas and HTMLCanvasElement. */
interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2DLike | null;
}

interface CanvasRenderingContext2DLike {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

/**
 * Returns true when pixel bridge operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document) and createImageBitmap.
 */
export function hasPixelBridge(): boolean {
  return (
    (typeof globalThis.OffscreenCanvas !== 'undefined' ||
      (typeof globalThis.document !== 'undefined' &&
        typeof globalThis.document.createElement === 'function')) &&
    typeof globalThis.createImageBitmap === 'function'
  );
}

/**
 * Creates a canvas of the requested size.
 * Prefers OffscreenCanvas for worker-thread compatibility;
 * falls back to HTMLCanvasElement in environments where OffscreenCanvas is unavailable.
 */
function createCanvas(width: number, height: number): CanvasLike {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') {
    return new globalThis.OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  const el = globalThis.document.createElement('canvas') as unknown as CanvasLike & {
    toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
  };
  el.width = width;
  el.height = height;
  return el;
}

/**
 * Encodes a canvas to a Blob.
 * Uses OffscreenCanvas.convertToBlob when available; falls back to HTMLCanvasElement.toBlob.
 */
async function canvasToBlob(canvas: CanvasLike, mime: string, quality?: number): Promise<Blob> {
  if (typeof (canvas as { convertToBlob?: unknown }).convertToBlob === 'function') {
    const oc = canvas as unknown as {
      convertToBlob(opts: { type: string; quality?: number }): Promise<Blob>;
    };
    return oc.convertToBlob({ type: mime, quality });
  }

  // HTMLCanvasElement fallback
  return new Promise<Blob>((resolve, reject) => {
    const el = canvas as unknown as {
      toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
    };
    el.toBlob(
      (b) => {
        if (b === null) {
          reject(
            new AvifEncodeError(
              'HTMLCanvasElement.toBlob produced null — canvas may not support the requested MIME type.',
            ),
          );
        } else {
          resolve(b);
        }
      },
      mime,
      quality,
    );
  });
}

// ---------------------------------------------------------------------------
// imageDataToBlob
// ---------------------------------------------------------------------------

/**
 * Converts ImageData to a Blob of the given MIME type via canvas.
 *
 * Used for AVIF → {PNG, JPEG, WebP} paths: after jsquash decodes to ImageData,
 * we paint it onto a canvas and call convertToBlob to get the target format.
 *
 * @param imageData - Source pixel data (RGBA, 8-bit).
 * @param mime      - Target MIME type, e.g. 'image/png'.
 * @param quality   - Encode quality 0–1 for lossy formats (JPEG, WebP).
 */
export async function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new AvifEncodeError(
      'Could not get 2D context from canvas for pixel bridge (imageDataToBlob).',
    );
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, mime, quality);
}

// ---------------------------------------------------------------------------
// blobToImageData
// ---------------------------------------------------------------------------

/**
 * Converts a Blob (PNG, JPEG, WebP, etc.) to ImageData via createImageBitmap.
 *
 * Used for {PNG, JPEG, WebP} → AVIF paths: the browser decodes the source
 * image into an ImageBitmap, which we paint onto a canvas to get pixel data.
 *
 * @param blob      - Input image blob (any format supported by createImageBitmap).
 * @param maxPixels - Optional pixel count cap (default: MAX_PIXELS). Throws
 *                    AvifDimensionsTooLargeError if width×height exceeds this value.
 * @throws {AvifDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export async function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    const { width, height } = bitmap;

    // LOW-6: pixel guard on blobToImageData (free function API, no backend to guard)
    const pixels = width * height;
    if (pixels > maxPixels) {
      throw new AvifDimensionsTooLargeError(width, height, maxPixels);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new AvifDecodeError(
        'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
