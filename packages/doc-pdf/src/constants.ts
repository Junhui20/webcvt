/**
 * Security-cap constants and MIME identifiers for @catlabtech/webcvt-doc-pdf.
 *
 * Both the multi-page writer (which embeds untrusted image bytes) and the
 * bounded PDF-info reader (which scans untrusted PDF bytes) reference these
 * caps so a hostile input cannot exhaust CPU or memory. Do not hardcode the
 * values inline — import them.
 */

/** Canonical MIME type for PDF (the writer's output / the reader's input). */
export const PDF_MIME = 'application/pdf';

/** JSON output MIME (the `pdf → json` conversion target of DocPdfBackend). */
export const JSON_MIME = 'application/json';

/** JPEG source MIME — embedded byte-for-byte via the PDF DCTDecode filter. */
export const JPEG_MIME = 'image/jpeg';

/** PNG source MIME — embedded losslessly via FlateDecode + a PNG predictor. */
export const PNG_MIME = 'image/png';

/**
 * Maximum total raw input size in bytes (256 MiB). For imagesToPdf this is the
 * cumulative size of all source images; for parsePdfInfo it is the PDF length.
 * Checked BEFORE any parsing so a hostile input cannot exhaust memory.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/** Maximum number of pages (source images) a single PDF may contain (10 000). */
export const MAX_PAGES = 10_000;

/** Maximum pixel count (width × height) for a single embedded image (~25 MP). */
export const MAX_PIXELS = 25_000_000;

/**
 * Upper bound on object-location / fallback scans performed by parsePdfInfo.
 * Caps how many `/Page` or `/Count` tokens the reader will visit so a crafted
 * PDF cannot turn the fallback page count into an unbounded loop.
 */
export const MAX_PDF_OBJECTS = 1_000_000;

/**
 * Maximum number of PNG chunks the embedder will walk before giving up. Guards
 * against a PNG padded with millions of zero-length ancillary chunks.
 */
export const MAX_PNG_CHUNKS = 100_000;

/**
 * Maximum number of bytes matchDictEnd will scan looking for the `>>` that
 * closes a `<<` dictionary, and the maximum decoded length of any single PDF
 * string (/Title, /Author, …). Bounds the trailer / Info parse.
 */
export const MAX_DICT_BYTES = 1024 * 1024;

/** Maximum decoded length (bytes) of a single PDF string value. */
export const MAX_PDF_STRING_BYTES = 64 * 1024;

/** Default `/Producer` recorded in PDFs emitted by imagesToPdf. */
export const DEFAULT_PRODUCER = 'webcvt-doc-pdf';
