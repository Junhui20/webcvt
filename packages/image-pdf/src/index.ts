/**
 * @catlabtech/webcvt-image-pdf — Public API
 *
 * Wrap images (JPEG, PNG, WebP, BMP, GIF) into a one-page PDF using a clean-room
 * PDF writer (zero runtime dependencies). JPEG is embedded losslessly via DCTDecode;
 * other formats are decoded to pixels and embedded as a Flate image (+ alpha SMask).
 *
 * IMPORTANT: importing this module does NOT auto-register the backend. Call
 * registerPdfBackend() explicitly to opt-in (preserves tree-shaking).
 *
 * @example
 * ```ts
 * import { registerPdfBackend } from '@catlabtech/webcvt-image-pdf';
 * registerPdfBackend();
 * ```
 */

export { JPEG_MIME, MAX_INPUT_BYTES, MAX_PIXELS, PDF_MIME } from './constants.ts';
export { PDF_FORMAT } from './format.ts';
export type { ImagePdfOptions } from './build-pdf.ts';
export { imageDataToPdf, jpegToPdf } from './build-pdf.ts';
export { assemblePdf } from './pdf-writer.ts';
export type { PdfImage } from './pdf-writer.ts';
export { parseJpegInfo } from './jpeg-info.ts';
export type { JpegInfo } from './jpeg-info.ts';
export { blobToImageData, hasPixelBridge } from './pixel-bridge.ts';
export type { PdfBackendOptions } from './backend.ts';
export { PdfBackend, registerPdfBackend } from './backend.ts';
export {
  PdfDecodeError,
  PdfDimensionsTooLargeError,
  PdfEncodeError,
  PdfInputTooLargeError,
  PdfUnsupportedSourceError,
} from './errors.ts';
