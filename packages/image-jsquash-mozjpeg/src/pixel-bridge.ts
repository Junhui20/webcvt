/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Thin wrapper over the shared canvas round-trips in @catlabtech/webcvt-image-canvas:
 * - imageDataToBlob: ImageData → Blob via OffscreenCanvas (or HTMLCanvasElement fallback)
 * - blobToImageData:  Blob → ImageData via createImageBitmap → OffscreenCanvas
 *
 * Used for cross-format paths (e.g. PNG→JPEG, JPEG→PNG) where a canvas round-trip
 * is needed to convert between canvas-native formats and MozJPEG. The MozJPEG-typed
 * errors are preserved by injecting them into the shared helpers.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import {
  type PixelBridgeErrorHooks,
  blobToImageData as sharedBlobToImageData,
  hasPixelBridge as sharedHasPixelBridge,
  imageDataToBlob as sharedImageDataToBlob,
} from '@catlabtech/webcvt-image-canvas';
import { MAX_PIXELS } from './constants.ts';
import {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegEncodeError,
} from './errors.ts';

/** Maps the shared bridge's failure points onto this package's typed errors. */
const errorHooks: PixelBridgeErrorHooks = {
  encodeContextError: () =>
    new MozjpegEncodeError(
      'Could not get 2D context from canvas for pixel bridge (imageDataToBlob).',
    ),
  decodeContextError: () =>
    new MozjpegDecodeError(
      'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
    ),
  toBlobNullError: () =>
    new MozjpegEncodeError(
      'HTMLCanvasElement.toBlob produced null — canvas may not support the requested MIME type.',
    ),
  dimensionsTooLargeError: (width, height, maxPixels) =>
    new MozjpegDimensionsTooLargeError(width, height, maxPixels),
};

/**
 * Returns true when pixel bridge operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document) and createImageBitmap.
 */
export function hasPixelBridge(): boolean {
  return sharedHasPixelBridge();
}

/**
 * Converts ImageData to a Blob of the given MIME type via canvas.
 * Used for JPEG → {PNG, WebP} paths after MozJPEG decodes to ImageData.
 */
export function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return sharedImageDataToBlob(imageData, mime, quality, errorHooks);
}

/**
 * Converts a Blob (PNG, WebP, etc.) to ImageData via createImageBitmap.
 * Used for {PNG, WebP} → JPEG paths before MozJPEG encodes.
 *
 * @throws {MozjpegDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  return sharedBlobToImageData(blob, maxPixels, errorHooks);
}
