/**
 * @catlabtech/webcvt-image-jsquash-oxipng — Public API
 *
 * Lossless PNG optimisation / encoding for webcvt via @jsquash/oxipng (OxiPNG, MIT).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend and
 * does NOT trigger any wasm load. Call registerOxipngBackend() explicitly to
 * opt-in (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerOxipngBackend } from '@catlabtech/webcvt-image-jsquash-oxipng';
 * registerOxipngBackend();
 * ```
 */

export { DEFAULT_OPTIONS, MAX_INPUT_BYTES, MAX_PIXELS, OXIPNG_MIME } from './constants.ts';
export { OXIPNG_FORMAT } from './format.ts';
export type { OxipngOptions } from './optimise.ts';
export type { OxipngBackendOptions } from './backend.ts';
export { optimisePng } from './optimise.ts';
export { disposeOxipng, preloadOxipng } from './loader.ts';
export { blobToImageData, hasPixelBridge } from './pixel-bridge.ts';
export { OxipngBackend, registerOxipngBackend } from './backend.ts';
export {
  OxipngDecodeError,
  OxipngDimensionsTooLargeError,
  OxipngInputTooLargeError,
  OxipngLoadError,
  OxipngOptimiseError,
} from './errors.ts';
