/**
 * Constants for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * All size limits and encode defaults live here to avoid magic numbers
 * scattered across the implementation.
 */

import type { JxlEncodeOptions } from './encode.ts';

/** MIME type for JPEG XL images. */
export const JXL_MIME = 'image/jxl';

/**
 * Maximum allowed input size: 256 MiB.
 * Prevents OOM from pathologically large inputs before jsquash ever sees them.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Maximum allowed pixel count for decode output: 25 million (~25 MP).
 *
 * DESIGN NOTE (decode-bomb mitigation):
 * This guard fires AFTER @jsquash/jxl has already allocated width×height×4 bytes inside
 * wasm (jsquash ^1.3.0 exposes no pre-decode header API). At 25 MP the worst-case wasm
 * allocation is ~100 MB (25M × 4 bytes). MAX_INPUT_BYTES (256 MiB) is therefore the
 * real first line of defence — a 256 MiB compressed JXL payload cannot decompress to
 * arbitrarily many pixels. The post-decode pixel check is defense-in-depth, not the
 * primary guard.
 *
 * Override per-instance via JxlBackend({ maxPixels }) for callers who need higher limits.
 */
export const MAX_PIXELS = 25_000_000;

/** Default encode options used when no options are specified. */
export const DEFAULT_ENCODE: Required<JxlEncodeOptions> = {
  quality: 75,
  effort: 7,
  lossless: false,
  progressive: false,
};
