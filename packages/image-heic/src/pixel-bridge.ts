/**
 * Pixel bridge for @catlabtech/webcvt-image-heic — encode-only.
 *
 * HEIC is decode-only here, so after libheif renders RGBA we paint it onto a canvas
 * and export the target format (PNG/JPEG/WebP) via convertToBlob / toBlob.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import { HeicEncodeError } from './errors.ts';

interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2DLike | null;
}

interface CanvasRenderingContext2DLike {
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

/**
 * Returns true when canvas encode operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document).
 */
export function hasPixelBridge(): boolean {
  return (
    typeof globalThis.OffscreenCanvas !== 'undefined' ||
    (typeof globalThis.document !== 'undefined' &&
      typeof globalThis.document.createElement === 'function')
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
            new HeicEncodeError(
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
 * Converts decoded ImageData to a Blob of the given MIME type via canvas.
 * Used for HEIC → {PNG, JPEG, WebP}.
 */
export async function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new HeicEncodeError(
      'Could not get 2D context from canvas for pixel bridge (imageDataToBlob).',
    );
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, mime, quality);
}
