/**
 * Typed error classes for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Five distinct failure modes — all extend WebcvtError so callers can
 * catch the base class and still switch on `err.code` for fine-grained handling.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// AvifLoadError
// ---------------------------------------------------------------------------

/**
 * Thrown when the @jsquash/avif wasm module cannot be loaded.
 *
 * Typical causes: @jsquash/avif not installed (optional peer),
 * network failure fetching wasm binary, or CSP blocking wasm-unsafe-eval.
 */
export class AvifLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('AVIF_LOAD_FAILED', message, options);
    this.name = 'AvifLoadError';
  }
}

// ---------------------------------------------------------------------------
// AvifDecodeError
// ---------------------------------------------------------------------------

/**
 * Thrown when @jsquash/avif fails to decode an AVIF byte stream.
 *
 * Typical causes: malformed or truncated AVIF data, unsupported AVIF profile,
 * or animated AVIF (not supported in v1).
 */
export class AvifDecodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('AVIF_DECODE_FAILED', message, options);
    this.name = 'AvifDecodeError';
  }
}

// ---------------------------------------------------------------------------
// AvifEncodeError
// ---------------------------------------------------------------------------

/**
 * Thrown when @jsquash/avif fails to encode ImageData to AVIF, or when
 * unsupported encode options are requested (e.g. bitDepth: 10).
 *
 * Typical causes: invalid encode options, wasm out-of-memory, or internal
 * codec error.
 */
export class AvifEncodeError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('AVIF_ENCODE_FAILED', message, options);
    this.name = 'AvifEncodeError';
  }
}

// ---------------------------------------------------------------------------
// AvifInputTooLargeError
// ---------------------------------------------------------------------------

/**
 * Thrown when the input Blob or byte array exceeds MAX_INPUT_BYTES.
 *
 * The check happens before any wasm call, so no memory allocation occurs.
 */
export class AvifInputTooLargeError extends WebcvtError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      'AVIF_INPUT_TOO_LARGE',
      `AVIF input is ${actualBytes} bytes; maximum supported is ${limitBytes} bytes (${Math.round(limitBytes / 1024 / 1024)} MiB).`,
    );
    this.name = 'AvifInputTooLargeError';
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

// ---------------------------------------------------------------------------
// AvifDimensionsTooLargeError
// ---------------------------------------------------------------------------

/**
 * Thrown when the image pixel count (width × height) exceeds MAX_PIXELS.
 *
 * Applied both after decoding (checking decoded ImageData dimensions) and
 * before encoding (checking input ImageData dimensions).
 */
export class AvifDimensionsTooLargeError extends WebcvtError {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly limitPixels: number;

  constructor(width: number, height: number, limitPixels: number) {
    const pixels = width * height;
    super(
      'AVIF_DIMENSIONS_TOO_LARGE',
      `Image dimensions ${width}×${height} = ${pixels} pixels exceeds MAX_PIXELS (${limitPixels}).`,
    );
    this.name = 'AvifDimensionsTooLargeError';
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.limitPixels = limitPixels;
  }
}
