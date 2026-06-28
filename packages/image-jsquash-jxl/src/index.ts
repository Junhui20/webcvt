/**
 * @catlabtech/webcvt-image-jsquash-jxl — Public API
 *
 * JPEG XL (JXL) decode/encode for webcvt via @jsquash/jxl (Apache-2.0 / libjxl).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend and
 * does NOT trigger any wasm load. Call registerJxlBackend() explicitly to
 * opt-in (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerJxlBackend } from '@catlabtech/webcvt-image-jsquash-jxl';
 * registerJxlBackend();
 * ```
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export { DEFAULT_ENCODE, JXL_MIME, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

export { JXL_FORMAT } from './format.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { JxlEncodeOptions } from './encode.ts';
export type { JxlBackendOptions } from './backend.ts';

// ---------------------------------------------------------------------------
// Free functions (convenience API)
// ---------------------------------------------------------------------------

export { decodeJxl } from './decode.ts';
export { encodeJxl } from './encode.ts';
export { disposeJxl, preloadJxl } from './loader.ts';

// ---------------------------------------------------------------------------
// Pixel bridge (exported for advanced use / testing)
// ---------------------------------------------------------------------------

export { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

// ---------------------------------------------------------------------------
// Backend class + registration
// ---------------------------------------------------------------------------

export { JxlBackend, registerJxlBackend } from './backend.ts';

// ---------------------------------------------------------------------------
// Error classes (for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  JxlDecodeError,
  JxlDimensionsTooLargeError,
  JxlEncodeError,
  JxlInputTooLargeError,
  JxlLoadError,
} from './errors.ts';
