/**
 * @catlabtech/webcvt-image-jsquash-avif — Public API
 *
 * AVIF decode/encode for webcvt via @jsquash/avif (Apache-2.0 + AV1 patent grant).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend and
 * does NOT trigger any wasm load. Call registerAvifBackend() explicitly to
 * opt-in (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerAvifBackend } from '@catlabtech/webcvt-image-jsquash-avif';
 * registerAvifBackend();
 * ```
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export { AVIF_MIME, DEFAULT_ENCODE, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

export { AVIF_FORMAT } from './format.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { AvifEncodeOptions } from './encode.ts';
// NOTE: AvifLoadOptions is intentionally NOT exported.
// Self-hosting wasm (moduleURL / pre-compiled WebAssembly.Module) is deferred to v0.3.
// jsquash 1.3.0 does not expose init() at the root level — the API cannot be correctly
// implemented without sub-module API inspection. See loader.ts for the TODO tracking note.
export type { AvifBackendOptions } from './backend.ts';

// ---------------------------------------------------------------------------
// Free functions (convenience API)
// ---------------------------------------------------------------------------

export { decodeAvif } from './decode.ts';
export { encodeAvif } from './encode.ts';
// NOTE: resolveOptions is intentionally NOT exported from the barrel.
// It is exported from encode.ts for internal test use only (@internal).
export { disposeAvif, preloadAvif } from './loader.ts';

// ---------------------------------------------------------------------------
// Pixel bridge (exported for advanced use / testing)
// ---------------------------------------------------------------------------

export { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

// ---------------------------------------------------------------------------
// Backend class + registration
// ---------------------------------------------------------------------------

export { AvifBackend, registerAvifBackend } from './backend.ts';

// ---------------------------------------------------------------------------
// Error classes (for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  AvifDecodeError,
  AvifDimensionsTooLargeError,
  AvifEncodeError,
  AvifInputTooLargeError,
  AvifLoadError,
} from './errors.ts';
