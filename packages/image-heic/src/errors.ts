/**
 * Typed error classes for @catlabtech/webcvt-image-heic.
 *
 * All extend WebcvtError so callers can catch the base class and switch on `err.code`.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the libheif-js wasm module cannot be loaded. */
export class HeicLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('HEIC_LOAD_FAILED', message, options);
    this.name = 'HeicLoadError';
  }
}

/** Thrown when libheif cannot decode the HEIC/HEIF input. */
export class HeicDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('HEIC_DECODE_FAILED', message, options);
    this.name = 'HeicDecodeError';
  }
}

/** Thrown when the canvas bridge fails to encode the decoded pixels to the target. */
export class HeicEncodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('HEIC_ENCODE_FAILED', message, options);
    this.name = 'HeicEncodeError';
  }
}

/** Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES. */
export class HeicInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'HEIC_INPUT_TOO_LARGE',
      `HEIC input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'HeicInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Thrown when the decoded image pixel count (width × height) exceeds MAX_PIXELS. */
export class HeicDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'HEIC_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'HeicDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
