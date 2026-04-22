/**
 * Typed error classes for @catlabtech/webcvt-image-svg.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from image-svg — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

/**
 * Thrown when DOMParser returns a parsererror document, or when the root
 * element is not a valid SVG element (wrong localName or namespace).
 */
export class SvgParseError extends WebcvtError {
  constructor(reason: string) {
    super('SVG_PARSE_ERROR', `SVG parse failed: ${reason}`);
    this.name = 'SvgParseError';
  }
}

// ---------------------------------------------------------------------------
// Unsafe content errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the string-based reject pass detects unsafe content before
 * DOMParser is invoked. Covers: <!ENTITY, <!DOCTYPE, <script, <foreignObject,
 * and external href references.
 *
 * The `pattern` field indicates which check triggered the rejection.
 */
export class SvgUnsafeContentError extends WebcvtError {
  readonly pattern: string;
  constructor(pattern: string) {
    super(
      'SVG_UNSAFE_CONTENT',
      `SVG document rejected by security pre-filter: matched pattern "${pattern}". Ensure the document contains no entity declarations, DTDs, scripts, foreignObject elements, or external href references.`,
    );
    this.name = 'SvgUnsafeContentError';
    this.pattern = pattern;
  }
}

// ---------------------------------------------------------------------------
// Input size error
// ---------------------------------------------------------------------------

/**
 * Thrown when the raw input exceeds MAX_SVG_INPUT_BYTES (10 MiB).
 */
export class SvgInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'SVG_INPUT_TOO_LARGE',
      `SVG input is ${size} bytes; maximum supported is ${max} bytes (10 MiB).`,
    );
    this.name = 'SvgInputTooLargeError';
  }
}

// ---------------------------------------------------------------------------
// Rasterize errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the resolved rasterize output dimensions exceed the cap
 * (MAX_RASTERIZE_WIDTH × MAX_RASTERIZE_HEIGHT = 8192×8192), or when
 * dimensions are ≤ 0 or non-finite.
 */
export class SvgRasterizeTooLargeError extends WebcvtError {
  constructor(width: number, height: number, maxWidth: number, maxHeight: number) {
    super(
      'SVG_RASTERIZE_TOO_LARGE',
      `Rasterize dimensions ${width}×${height} exceed the cap ${maxWidth}×${maxHeight}.`,
    );
    this.name = 'SvgRasterizeTooLargeError';
  }
}

/**
 * Thrown when rasterization fails: Image.decode() rejects, the timeout fires,
 * the canvas context cannot be obtained, or convertToBlob fails.
 */
export class SvgRasterizeError extends WebcvtError {
  constructor(reason: string, cause?: unknown) {
    super('SVG_RASTERIZE_ERROR', `SVG rasterization failed: ${reason}`, { cause });
    this.name = 'SvgRasterizeError';
  }
}

// ---------------------------------------------------------------------------
// Backend encode error
// ---------------------------------------------------------------------------

/**
 * Thrown when convert() is called for an unsupported path — e.g. SVG→SVG
 * with a different target MIME, or a non-SVG input.
 */
export class SvgEncodeNotImplementedError extends WebcvtError {
  constructor(reason: string) {
    super(
      'SVG_ENCODE_NOT_IMPLEMENTED',
      `SVG encode not implemented: ${reason}. Only SVG→SVG (identity) and SVG→PNG/JPEG/WebP (rasterize) are supported.`,
    );
    this.name = 'SvgEncodeNotImplementedError';
  }
}
