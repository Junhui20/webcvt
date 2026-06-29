/**
 * Typed error classes for @catlabtech/webcvt-doc-pdf.
 *
 * Every error code is an UPPER_SNAKE_CASE string for programmatic matching, and
 * every error extends WebcvtError so a caller can `catch` the base class and
 * `switch (err.code)`. This package never throws a bare Error or a bare
 * WebcvtError — always one of the subclasses below.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the cumulative input exceeds MAX_INPUT_BYTES. */
export class DocPdfInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'DOC_PDF_INPUT_TOO_LARGE',
      `Input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(
        limitBytes / 1024 / 1024,
      )} MiB).`,
    );
    this.name = 'DocPdfInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Thrown when imagesToPdf is called with an empty image array. */
export class DocPdfNoImagesError extends WebcvtError {
  constructor() {
    super('DOC_PDF_NO_IMAGES', 'imagesToPdf requires at least one source image; received none.');
    this.name = 'DocPdfNoImagesError';
  }
}

/** Thrown when the number of source images exceeds MAX_PAGES. */
export class DocPdfTooManyPagesError extends WebcvtError {
  readonly count: number;
  readonly limit: number;

  constructor(count: number, limit: number) {
    super(
      'DOC_PDF_TOO_MANY_PAGES',
      `Refusing to build a PDF with ${count} pages; the maximum is ${limit}.`,
    );
    this.name = 'DocPdfTooManyPagesError';
    this.count = count;
    this.limit = limit;
  }
}

/** Thrown when a source image's pixel count (width × height) exceeds MAX_PIXELS. */
export class DocPdfDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'DOC_PDF_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds the cap of ${limitPixels}.`,
    );
    this.name = 'DocPdfDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}

/**
 * Thrown when a source image cannot be parsed (bad JPEG SOF, malformed PNG
 * chunk structure, truncated data, …).
 */
export class DocPdfDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('DOC_PDF_DECODE_FAILED', message, options);
    this.name = 'DocPdfDecodeError';
  }
}

/**
 * Thrown when a source image is structurally valid but not in a form this
 * sync, dependency-free writer can embed (e.g. CMYK JPEG, RGBA / indexed /
 * interlaced PNG, an unsupported MIME type).
 */
export class DocPdfUnsupportedSourceError extends WebcvtError {
  constructor(message: string) {
    super('DOC_PDF_UNSUPPORTED_SOURCE', message);
    this.name = 'DocPdfUnsupportedSourceError';
  }
}

/**
 * Thrown when parsePdfInfo cannot make sense of the bytes (no %PDF header,
 * unresolvable page count, malformed structure).
 */
export class DocPdfParseError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('DOC_PDF_PARSE_FAILED', message, options);
    this.name = 'DocPdfParseError';
  }
}
