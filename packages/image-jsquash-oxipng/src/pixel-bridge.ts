/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * OxiPNG only *produces* PNG, so this bridge is decode-only: it turns a non-PNG
 * source blob (JPEG, WebP, …) into ImageData via createImageBitmap, which is then
 * handed to optimisePng() for encoding. (PNG inputs skip the bridge entirely and
 * are re-optimised as bytes.)
 *
 * Thin wrapper over the shared canvas round-trip in @catlabtech/webcvt-image-canvas;
 * the OxiPNG-typed errors are preserved by injecting them into the shared helper.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import {
  type PixelBridgeErrorHooks,
  blobToImageData as sharedBlobToImageData,
  hasPixelBridge as sharedHasPixelBridge,
} from '@catlabtech/webcvt-image-canvas';
import { MAX_PIXELS } from './constants.ts';
import { OxipngDecodeError, OxipngDimensionsTooLargeError } from './errors.ts';

/** Maps the shared bridge's decode failure points onto this package's typed errors. */
const errorHooks: PixelBridgeErrorHooks = {
  decodeContextError: () =>
    new OxipngDecodeError(
      'Could not get 2D context from canvas for pixel bridge (blobToImageData).',
    ),
  dimensionsTooLargeError: (width, height, maxPixels) =>
    new OxipngDimensionsTooLargeError(width, height, maxPixels),
};

/**
 * Returns true when pixel bridge operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document) and createImageBitmap.
 */
export function hasPixelBridge(): boolean {
  return sharedHasPixelBridge();
}

/**
 * Converts a Blob (JPEG, WebP, etc.) to ImageData via createImageBitmap, for the
 * {JPEG, WebP} → PNG paths.
 *
 * @throws {OxipngDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  return sharedBlobToImageData(blob, maxPixels, errorHooks);
}
