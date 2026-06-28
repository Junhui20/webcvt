/**
 * Constants for @catlabtech/webcvt-image-jsquash-oxipng.
 */

import type { OxipngOptions } from './optimise.ts';

/** MIME type for PNG images. */
export const OXIPNG_MIME = 'image/png';

/**
 * Maximum allowed input size: 256 MiB.
 * Prevents OOM from pathologically large inputs before jsquash ever sees them.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Maximum allowed pixel count for ImageData inputs: 25 million (~25 MP).
 * Bounds the worst-case wasm allocation when encoding raw pixels to PNG.
 *
 * Override per-instance via OxipngBackend({ maxPixels }).
 */
export const MAX_PIXELS = 25_000_000;

/** Default optimise options used when none are specified (mirrors @jsquash/oxipng). */
export const DEFAULT_OPTIONS: Required<OxipngOptions> = {
  level: 2,
  interlace: false,
  optimiseAlpha: false,
};
