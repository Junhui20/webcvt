/**
 * Constants for @catlabtech/webcvt-image-pdf.
 */

/** MIME type for PDF output. */
export const PDF_MIME = 'application/pdf';

/** MIME type for JPEG (the one source format embedded losslessly via DCTDecode). */
export const JPEG_MIME = 'image/jpeg';

/**
 * Maximum allowed input size: 256 MiB.
 * Checked before any decode so a hostile input cannot exhaust memory.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024; // 256 MiB

/** Maximum allowed pixel count (width × height): 25 million (~25 MP). */
export const MAX_PIXELS = 25_000_000;

/**
 * Source image formats this backend can wrap into a PDF.
 * JPEG is embedded byte-for-byte (DCTDecode); the rest are decoded to pixels via
 * the canvas bridge and embedded as a Flate-compressed RGB image (+ alpha SMask).
 */
export const SUPPORTED_SOURCE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/gif',
]);

/** Source formats that require a canvas pixel-bridge (everything except JPEG). */
export const CANVAS_SOURCE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/webp',
  'image/bmp',
  'image/gif',
]);
