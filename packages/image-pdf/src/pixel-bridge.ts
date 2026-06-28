/**
 * Pixel bridge for @catlabtech/webcvt-image-pdf — decode-only.
 *
 * Non-JPEG sources (PNG, WebP, BMP, GIF) are decoded to ImageData via
 * createImageBitmap, then handed to imageDataToPdf(). JPEG skips the bridge and
 * is embedded directly.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import { MAX_PIXELS } from './constants.ts';
import { PdfDecodeError, PdfDimensionsTooLargeError } from './errors.ts';

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
 * Decode a non-JPEG image blob (PNG, WebP, …) to ImageData via createImageBitmap.
 *
 * @throws {PdfDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 * @throws {PdfDecodeError} if a 2D context cannot be obtained.
 */
export async function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (width * height > maxPixels) {
      throw new PdfDimensionsTooLargeError(width, height, maxPixels);
    }
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new PdfDecodeError(
        'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
