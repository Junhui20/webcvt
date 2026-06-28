/**
 * Typed error classes for @catlabtech/webcvt-image-pdf.
 *
 * All extend WebcvtError so callers can catch the base class and switch on `err.code`.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when PDF assembly fails. */
export class PdfEncodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('PDF_ENCODE_FAILED', message, options);
    this.name = 'PdfEncodeError';
  }
}

/** Thrown when the source image cannot be parsed/decoded (bad JPEG, canvas bridge failure). */
export class PdfDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('PDF_DECODE_FAILED', message, options);
    this.name = 'PdfDecodeError';
  }
}

/** Thrown when the source format (or a JPEG colour model) is not supported. */
export class PdfUnsupportedSourceError extends WebcvtError {
  constructor(message: string) {
    super('PDF_UNSUPPORTED_SOURCE', message);
    this.name = 'PdfUnsupportedSourceError';
  }
}

/** Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES. */
export class PdfInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'PDF_INPUT_TOO_LARGE',
      `Image input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'PdfInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Thrown when the image pixel count (width × height) exceeds MAX_PIXELS. */
export class PdfDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'PDF_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'PdfDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
