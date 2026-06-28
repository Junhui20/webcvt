/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Provides two conversions:
 * - imageDataToBlob: ImageData → Blob via OffscreenCanvas (or HTMLCanvasElement fallback)
 * - blobToImageData:  Blob → ImageData via createImageBitmap → OffscreenCanvas
 *
 * Used for cross-format paths (e.g. PNG→JPEG, JPEG→PNG) where a canvas round-trip
 * is needed to convert between canvas-native formats and MozJPEG.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import { MAX_PIXELS } from './constants.ts';
import {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegEncodeError,
} from './errors.ts';

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

async function canvasToBlob(canvas: CanvasLike, mime: string, quality?: number): Promise<Blob> {
  if (typeof (canvas as { convertToBlob?: unknown }).convertToBlob === 'function') {
    const oc = canvas as unknown as {
      convertToBlob(opts: { type: string; quality?: number }): Promise<Blob>;
    };
    return oc.convertToBlob({ type: mime, quality });
  }

  return new Promise<Blob>((resolve, reject) => {
    const el = canvas as unknown as {
      toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
    };
    el.toBlob(
      (b) => {
        if (b === null) {
          reject(
            new MozjpegEncodeError(
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

/**
 * Converts ImageData to a Blob of the given MIME type via canvas.
 * Used for JPEG → {PNG, WebP} paths after MozJPEG decodes to ImageData.
 */
export async function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new MozjpegEncodeError(
      'Could not get 2D context from canvas for pixel bridge (imageDataToBlob).',
    );
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, mime, quality);
}

/**
 * Converts a Blob (PNG, WebP, etc.) to ImageData via createImageBitmap.
 * Used for {PNG, WebP} → JPEG paths before MozJPEG encodes.
 *
 * @throws {MozjpegDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export async function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    const { width, height } = bitmap;

    const pixels = width * height;
    if (pixels > maxPixels) {
      throw new MozjpegDimensionsTooLargeError(width, height, maxPixels);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new MozjpegDecodeError(
        'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
