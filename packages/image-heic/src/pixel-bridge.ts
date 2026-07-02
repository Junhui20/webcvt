/**
 * Pixel bridge for @catlabtech/webcvt-image-heic — encode-only.
 *
 * HEIC is decode-only here, so after libheif renders RGBA we paint it onto a canvas
 * and export the target format (PNG/JPEG/WebP) via convertToBlob / toBlob.
 *
 * Thin wrapper over the shared canvas encode round-trip in
 * @catlabtech/webcvt-image-canvas; the HEIC-typed errors are preserved by
 * injecting them into the shared helper. Because HEIC never decodes a blob to
 * pixels here, hasPixelBridge() does not require createImageBitmap.
 *
 * Node.js note: OffscreenCanvas is unavailable in stock Node. Gate via hasPixelBridge().
 */

import {
  type PixelBridgeErrorHooks,
  hasPixelBridge as sharedHasPixelBridge,
  imageDataToBlob as sharedImageDataToBlob,
} from '@catlabtech/webcvt-image-canvas';
import { HeicEncodeError } from './errors.ts';

/** Maps the shared bridge's encode failure points onto this package's typed error. */
const errorHooks: PixelBridgeErrorHooks = {
  encodeContextError: () =>
    new HeicEncodeError('Could not get 2D context from canvas for pixel bridge (imageDataToBlob).'),
  toBlobNullError: () =>
    new HeicEncodeError(
      'HTMLCanvasElement.toBlob produced null — canvas may not support the requested MIME type.',
    ),
};

/**
 * Returns true when canvas encode operations are available in this environment.
 * Requires OffscreenCanvas (or HTMLCanvasElement + document). createImageBitmap
 * is NOT required — this bridge only encodes ImageData that libheif already
 * decoded.
 */
export function hasPixelBridge(): boolean {
  return sharedHasPixelBridge({ requireImageBitmap: false });
}

/**
 * Converts decoded ImageData to a Blob of the given MIME type via canvas.
 * Used for HEIC → {PNG, JPEG, WebP}.
 */
export function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return sharedImageDataToBlob(imageData, mime, quality, errorHooks);
}
