/**
 * Generic EBML error classes extending WebcvtError.
 *
 * These are shared by @webcvt/container-webm and @webcvt/container-mkv.
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 */

import { WebcvtError } from '@webcvt/core';

/** Thrown when an EBML VINT has an invalid encoding (e.g. all-zeros first byte). */
export class EbmlVintError extends WebcvtError {
  constructor(offset: number, reason: string) {
    super('EBML_VINT_ERROR', `Invalid EBML VINT at offset ${offset}: ${reason}`);
    this.name = 'EbmlVintError';
  }
}

/** Thrown when an element's declared size exceeds security caps. */
export class EbmlElementTooLargeError extends WebcvtError {
  constructor(elementId: number, size: bigint, max: number) {
    super(
      'EBML_ELEMENT_TOO_LARGE',
      `Element 0x${elementId.toString(16)} claims size ${size} bytes; maximum is ${max} bytes.`,
    );
    this.name = 'EbmlElementTooLargeError';
  }
}

/** Thrown when the total element count across the file exceeds MAX_ELEMENTS_PER_FILE. */
export class EbmlTooManyElementsError extends WebcvtError {
  constructor(max: number) {
    super(
      'EBML_TOO_MANY_ELEMENTS',
      `File contains more than ${max} EBML elements. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'EbmlTooManyElementsError';
  }
}

/** Thrown when the EBML nesting depth exceeds MAX_NEST_DEPTH. */
export class EbmlDepthExceededError extends WebcvtError {
  constructor(max: number) {
    super(
      'EBML_DEPTH_EXCEEDED',
      `EBML element nesting depth exceeds maximum of ${max}. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'EbmlDepthExceededError';
  }
}

/** Thrown when an element's claimed size exceeds the remaining bytes in its container. */
export class EbmlTruncatedError extends WebcvtError {
  constructor(elementId: number, claimed: bigint, remaining: number) {
    super(
      'EBML_TRUNCATED',
      `Element 0x${elementId.toString(16)} claims ${claimed} bytes but only ${remaining} bytes remain. File may be truncated.`,
    );
    this.name = 'EbmlTruncatedError';
  }
}

/** Thrown when an unknown-size VINT is encountered (only valid in live streaming). */
export class EbmlUnknownSizeError extends WebcvtError {
  constructor(elementId: number, offset: number) {
    super(
      'EBML_UNKNOWN_SIZE',
      `Element 0x${elementId.toString(16)} at offset ${offset} has unknown size. Unknown-size elements are only valid for live streaming (deferred).`,
    );
    this.name = 'EbmlUnknownSizeError';
  }
}
