/**
 * @catlabtech/webcvt-image-jsquash-mozjpeg — Public API
 *
 * High-quality JPEG decode/encode for webcvt via @jsquash/jpeg (MozJPEG, BSD-3).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend and
 * does NOT trigger any wasm load. Call registerMozjpegBackend() explicitly to
 * opt-in (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerMozjpegBackend } from '@catlabtech/webcvt-image-jsquash-mozjpeg';
 * registerMozjpegBackend();
 * ```
 */

export { DEFAULT_ENCODE, MAX_INPUT_BYTES, MAX_PIXELS, MOZJPEG_MIME } from './constants.ts';
export { MOZJPEG_FORMAT } from './format.ts';
export type { MozjpegEncodeOptions } from './encode.ts';
export type { MozjpegBackendOptions } from './backend.ts';
export { decodeMozjpeg } from './decode.ts';
export { encodeMozjpeg } from './encode.ts';
export { disposeMozjpeg, preloadMozjpeg } from './loader.ts';
export { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';
export { MozjpegBackend, registerMozjpegBackend } from './backend.ts';
export {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegEncodeError,
  MozjpegInputTooLargeError,
  MozjpegLoadError,
} from './errors.ts';
