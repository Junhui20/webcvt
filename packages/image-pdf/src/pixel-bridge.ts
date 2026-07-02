/**
 * Pixel bridge for @catlabtech/webcvt-image-pdf — decode-only.
 *
 * Non-JPEG sources (PNG, WebP, BMP, GIF) are decoded to ImageData via
 * createImageBitmap, then handed to imageDataToPdf(). JPEG skips the bridge and
 * is embedded directly.
 *
 * Thin wrapper over the shared canvas round-trip in @catlabtech/webcvt-image-canvas;
 * the PDF-typed errors are preserved by injecting them into the shared helper.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import {
  type PixelBridgeErrorHooks,
  blobToImageData as sharedBlobToImageData,
  hasPixelBridge as sharedHasPixelBridge,
} from '@catlabtech/webcvt-image-canvas';
import { MAX_PIXELS } from './constants.ts';
import { PdfDecodeError, PdfDimensionsTooLargeError } from './errors.ts';

/** Maps the shared bridge's decode failure points onto this package's typed errors. */
const errorHooks: PixelBridgeErrorHooks = {
  decodeContextError: () =>
    new PdfDecodeError('Could not get 2D context from canvas for pixel bridge (blobToImageData).'),
  dimensionsTooLargeError: (width, height, maxPixels) =>
    new PdfDimensionsTooLargeError(width, height, maxPixels),
};

/**
 * Returns true when pixel bridge operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document) and createImageBitmap.
 */
export function hasPixelBridge(): boolean {
  return sharedHasPixelBridge();
}

/**
 * Decode a non-JPEG image blob (PNG, WebP, …) to ImageData via createImageBitmap.
 *
 * @throws {PdfDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 * @throws {PdfDecodeError} if a 2D context cannot be obtained.
 */
export function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  return sharedBlobToImageData(blob, maxPixels, errorHooks);
}
