/**
 * Constants for @catlabtech/webcvt-image-heic.
 */

/** MIME type for HEIC (HEVC-in-HEIF) images — the iPhone default. */
export const HEIC_MIME = 'image/heic';
/** MIME type for the broader HEIF container. */
export const HEIF_MIME = 'image/heif';

/**
 * Maximum allowed input size: 256 MiB.
 * Checked before any wasm call so a hostile input cannot exhaust memory.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Maximum allowed pixel count (width × height): 40 million (~40 MP).
 *
 * HEIC images from modern phones can be large (e.g. 48 MP on recent iPhones), so the
 * cap is a little higher than the other image backends. It still bounds the worst-case
 * RGBA allocation (40 MP × 4 bytes ≈ 160 MB). Override via HeicBackend({ maxPixels }).
 */
export const MAX_PIXELS = 40_000_000;

/** Output formats this decode-only backend can produce (via the canvas bridge). */
export const CANVAS_ENCODABLE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
