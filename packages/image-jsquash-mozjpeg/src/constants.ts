/**
 * Constants for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * All size limits and encode defaults live here to avoid magic numbers
 * scattered across the implementation.
 */

import type { MozjpegEncodeOptions } from './encode.ts';

/** MIME type for JPEG images. */
export const MOZJPEG_MIME = 'image/jpeg';

/**
 * Maximum allowed input size: 256 MiB.
 * Prevents OOM from pathologically large inputs before jsquash ever sees them.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Maximum allowed pixel count for decode output: 25 million (~25 MP).
 *
 * DESIGN NOTE (decode-bomb mitigation):
 * This guard fires AFTER @jsquash/jpeg has already allocated width×height×4 bytes
 * inside wasm. MAX_INPUT_BYTES (256 MiB) is the real first line of defence; the
 * post-decode pixel check is defense-in-depth.
 *
 * Override per-instance via MozjpegBackend({ maxPixels }).
 */
export const MAX_PIXELS = 25_000_000;

/** Default encode options used when no options are specified. */
export const DEFAULT_ENCODE: Required<MozjpegEncodeOptions> = {
  quality: 75,
  progressive: false,
  baseline: false,
};
