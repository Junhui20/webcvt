/**
 * Typed error classes for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Five distinct failure modes — all extend WebcvtError so callers can
 * catch the base class and still switch on `err.code` for fine-grained handling.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// JxlLoadError
// ---------------------------------------------------------------------------

/**
 * Thrown when the @jsquash/jxl wasm module cannot be loaded.
 *
 * Typical causes: @jsquash/jxl not installed (optional peer),
 * network failure fetching wasm binary, or CSP blocking wasm-unsafe-eval.
 */
export class JxlLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('JXL_LOAD_FAILED', message, options);
    this.name = 'JxlLoadError';
  }
}

// ---------------------------------------------------------------------------
// JxlDecodeError
// ---------------------------------------------------------------------------

/**
 * Thrown when @jsquash/jxl fails to decode a JPEG XL byte stream.
 *
 * Typical causes: malformed or truncated JXL data, or an unsupported JXL
 * profile/feature.
 */
export class JxlDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('JXL_DECODE_FAILED', message, options);
    this.name = 'JxlDecodeError';
  }
}

// ---------------------------------------------------------------------------
// JxlEncodeError
// ---------------------------------------------------------------------------

/**
 * Thrown when @jsquash/jxl fails to encode ImageData to JPEG XL, or when
 * invalid encode options are requested.
 *
 * Typical causes: invalid encode options, wasm out-of-memory, or internal
 * codec error.
 */
export class JxlEncodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('JXL_ENCODE_FAILED', message, options);
    this.name = 'JxlEncodeError';
  }
}

// ---------------------------------------------------------------------------
// JxlInputTooLargeError
// ---------------------------------------------------------------------------

/**
 * Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES.
 *
 * The check happens before any wasm call, so no memory allocation occurs.
 */
export class JxlInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'JXL_INPUT_TOO_LARGE',
      `JXL input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'JxlInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

// ---------------------------------------------------------------------------
// JxlDimensionsTooLargeError
// ---------------------------------------------------------------------------

/**
 * Thrown when the image pixel count (width × height) exceeds MAX_PIXELS.
 *
 * Applied both after decoding (checking decoded ImageData dimensions) and
 * before encoding (checking input ImageData dimensions).
 */
export class JxlDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'JXL_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'JxlDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
