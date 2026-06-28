/**
 * Typed error classes for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Five distinct failure modes — all extend WebcvtError so callers can
 * catch the base class and still switch on `err.code` for fine-grained handling.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the @jsquash/jpeg wasm module cannot be loaded. */
export class MozjpegLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('MOZJPEG_LOAD_FAILED', message, options);
    this.name = 'MozjpegLoadError';
  }
}

/** Thrown when @jsquash/jpeg fails to decode a JPEG byte stream. */
export class MozjpegDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('MOZJPEG_DECODE_FAILED', message, options);
    this.name = 'MozjpegDecodeError';
  }
}

/** Thrown when @jsquash/jpeg fails to encode ImageData, or options are invalid. */
export class MozjpegEncodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('MOZJPEG_ENCODE_FAILED', message, options);
    this.name = 'MozjpegEncodeError';
  }
}

/** Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES. */
export class MozjpegInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'MOZJPEG_INPUT_TOO_LARGE',
      `JPEG input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'MozjpegInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Thrown when the image pixel count (width × height) exceeds MAX_PIXELS. */
export class MozjpegDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'MOZJPEG_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'MozjpegDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
