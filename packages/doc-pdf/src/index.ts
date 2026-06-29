/**
 * @catlabtech/webcvt-doc-pdf — Public API
 *
 * Two clean-room (PDF 1.7 / ISO 32000-1) capabilities, zero runtime
 * dependencies beyond reusing image-pdf's JPEG header parser:
 *
 *   1. `imagesToPdf(images, opts?)` — wrap an ordered list of JPEG/PNG images
 *      into one multi-page PDF (one page per image). Synchronous; JPEG via
 *      DCTDecode, opaque grayscale/RGB PNG via FlateDecode + a PNG predictor.
 *      This is what a cbz→PDF (comic) pipeline composes.
 *
 *   2. `parsePdfInfo(bytes, opts?)` — a bounded, read-only reader returning the
 *      version, page count, and /Info metadata. It does NOT — and never will —
 *      extract text or decode content streams (explicitly out of scope).
 *
 * `DocPdfBackend` exposes capability (2) as a webcvt `pdf → json` backend. It
 * does NOT auto-register on import; call `registerDocPdfBackend()` to opt in.
 */

export {
  DEFAULT_PRODUCER,
  JPEG_MIME,
  JSON_MIME,
  MAX_DICT_BYTES,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  MAX_PDF_OBJECTS,
  MAX_PDF_STRING_BYTES,
  MAX_PIXELS,
  MAX_PNG_CHUNKS,
  PDF_MIME,
  PNG_MIME,
} from './constants.ts';

export {
  DocPdfDecodeError,
  DocPdfDimensionsTooLargeError,
  DocPdfInputTooLargeError,
  DocPdfNoImagesError,
  DocPdfParseError,
  DocPdfTooManyPagesError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';

export { JSON_FORMAT, PDF_FORMAT } from './format.ts';

export type { ImageInput, ImagesToPdfOptions } from './images-to-pdf.ts';
export { imagesToPdf } from './images-to-pdf.ts';

export type { PreparedPageImage } from './pdf-writer.ts';
export { writeMultiPagePdf } from './pdf-writer.ts';

export { isPng, pngToPdfImage } from './png-image.ts';

export type { ParsePdfInfoOptions, PdfInfo } from './pdf-info.ts';
export { parsePdfInfo } from './pdf-info.ts';

export type { DocPdfBackendOptions } from './backend.ts';
export { DocPdfBackend, registerDocPdfBackend } from './backend.ts';
