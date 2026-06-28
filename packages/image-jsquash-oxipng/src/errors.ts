/**
 * Typed error classes for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * All extend WebcvtError so callers can catch the base class and still switch
 * on `err.code` for fine-grained handling.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the @jsquash/oxipng wasm module cannot be loaded. */
export class OxipngLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('OXIPNG_LOAD_FAILED', message, options);
    this.name = 'OxipngLoadError';
  }
}

/** Thrown when @jsquash/oxipng fails to optimise / encode a PNG. */
export class OxipngOptimiseError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('OXIPNG_OPTIMISE_FAILED', message, options);
    this.name = 'OxipngOptimiseError';
  }
}

/** Thrown when a non-PNG source blob cannot be decoded to pixels via the canvas bridge. */
export class OxipngDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('OXIPNG_DECODE_FAILED', message, options);
    this.name = 'OxipngDecodeError';
  }
}

/** Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES. */
export class OxipngInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'OXIPNG_INPUT_TOO_LARGE',
      `PNG input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'OxipngInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Thrown when an ImageData input's pixel count (width × height) exceeds MAX_PIXELS. */
export class OxipngDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'OXIPNG_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'OxipngDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
