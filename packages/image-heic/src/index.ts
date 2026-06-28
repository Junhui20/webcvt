/**
 * @catlabtech/webcvt-image-heic — Public API
 *
 * HEIC/HEIF decode for webcvt via libheif (wasm) — turn iPhone photos into
 * PNG/JPEG/WebP, entirely client-side. Decode-only (no HEIC encoder exists in
 * libheif-js).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend and does
 * NOT trigger any wasm load. Call registerHeicBackend() explicitly to opt-in.
 *
 * @example
 * ```ts
 * import { registerHeicBackend } from '@catlabtech/webcvt-image-heic';
 * registerHeicBackend();
 * ```
 */

export {
  CANVAS_ENCODABLE_MIMES,
  HEIC_MIME,
  HEIF_MIME,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
} from './constants.ts';
export { HEIC_FORMAT, HEIF_FORMAT } from './format.ts';
export { decodeHeic } from './decode.ts';
export { disposeHeic, preloadHeic } from './loader.ts';
export { hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';
export type { HeicBackendOptions } from './backend.ts';
export { HeicBackend, registerHeicBackend } from './backend.ts';
export {
  HeicDecodeError,
  HeicDimensionsTooLargeError,
  HeicEncodeError,
  HeicInputTooLargeError,
  HeicLoadError,
} from './errors.ts';
