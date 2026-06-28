/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * OxiPNG only *produces* PNG, so this bridge is decode-only: it turns a non-PNG
 * source blob (JPEG, WebP, …) into ImageData via createImageBitmap, which is then
 * handed to optimisePng() for encoding. (PNG inputs skip the bridge entirely and
 * are re-optimised as bytes.)
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import { MAX_PIXELS } from './constants.ts';
import { OxipngDecodeError, OxipngDimensionsTooLargeError } from './errors.ts';

interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2DLike | null;
}

interface CanvasRenderingContext2DLike {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
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

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') {
    return new globalThis.OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  const el = globalThis.document.createElement('canvas') as unknown as CanvasLike;
  el.width = width;
  el.height = height;
  return el;
}

/**
 * Converts a Blob (JPEG, WebP, etc.) to ImageData via createImageBitmap, for the
 * {JPEG, WebP} → PNG paths.
 *
 * @throws {OxipngDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export async function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    const { width, height } = bitmap;

    const pixels = width * height;
    if (pixels > maxPixels) {
      throw new OxipngDimensionsTooLargeError(width, height, maxPixels);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new OxipngDecodeError(
        'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
