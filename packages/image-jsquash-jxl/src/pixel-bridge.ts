/**
 * Pixel bridge for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Thin wrapper over the shared canvas round-trips in @catlabtech/webcvt-image-canvas:
 * - imageDataToBlob: ImageData → Blob via OffscreenCanvas (or HTMLCanvasElement fallback)
 * - blobToImageData:  Blob → ImageData via createImageBitmap → OffscreenCanvas
 *
 * Used for cross-format paths (e.g. PNG→JXL, JXL→PNG) where a canvas round-trip
 * is needed to convert between canvas-native formats and JPEG XL. The JXL-typed
 * errors are preserved by injecting them into the shared helpers.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. When typeof OffscreenCanvas
 * is 'undefined', callers should gate these paths via hasPixelBridge() before calling.
 */

import {
  type PixelBridgeErrorHooks,
  blobToImageData as sharedBlobToImageData,
  hasPixelBridge as sharedHasPixelBridge,
  imageDataToBlob as sharedImageDataToBlob,
} from '@catlabtech/webcvt-image-canvas';
import { MAX_PIXELS } from './constants.ts';
import { JxlDecodeError, JxlDimensionsTooLargeError, JxlEncodeError } from './errors.ts';

/** Maps the shared bridge's failure points onto this package's typed errors. */
const errorHooks: PixelBridgeErrorHooks = {
  encodeContextError: () =>
    new JxlEncodeError('Could not get 2D context from canvas for pixel bridge (imageDataToBlob).'),
  decodeContextError: () =>
    new JxlDecodeError('Could not get 2D context from canvas for pixel bridge (blobToImageData).'),
  toBlobNullError: () =>
    new JxlEncodeError(
      'HTMLCanvasElement.toBlob produced null — canvas may not support the requested MIME type.',
    ),
  dimensionsTooLargeError: (width, height, maxPixels) =>
    new JxlDimensionsTooLargeError(width, height, maxPixels),
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
 *
 * Used for JXL → {PNG, JPEG, WebP} paths: after jsquash decodes to ImageData,
 * we paint it onto a canvas and call convertToBlob to get the target format.
 *
 * @param imageData - Source pixel data (RGBA, 8-bit).
 * @param mime      - Target MIME type, e.g. 'image/png'.
 * @param quality   - Encode quality 0–1 for lossy formats (JPEG, WebP).
 */
export function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return sharedImageDataToBlob(imageData, mime, quality, errorHooks);
}

/**
 * Converts a Blob (PNG, JPEG, WebP, etc.) to ImageData via createImageBitmap.
 *
 * Used for {PNG, JPEG, WebP} → JXL paths: the browser decodes the source
 * image into an ImageBitmap, which we paint onto a canvas to get pixel data.
 *
 * @param blob      - Input image blob (any format supported by createImageBitmap).
 * @param maxPixels - Optional pixel count cap (default: MAX_PIXELS). Throws
 *                    JxlDimensionsTooLargeError if width×height exceeds this value.
 * @throws {JxlDimensionsTooLargeError} if decoded dimensions exceed maxPixels.
 */
export function blobToImageData(blob: Blob, maxPixels = MAX_PIXELS): Promise<ImageData> {
  return sharedBlobToImageData(blob, maxPixels, errorHooks);
}
