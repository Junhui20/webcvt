/**
 * Typed error classes for @catlabtech/webcvt-email.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw a bare Error or a bare WebcvtError from this package — always use
 * one of the typed subclasses below.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown when the raw input exceeds MAX_INPUT_BYTES (64 MiB).
 */
export class EmailInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'EMAIL_INPUT_TOO_LARGE',
      `EML input is ${size} bytes; maximum supported is ${max} bytes (64 MiB).`,
    );
    this.name = 'EmailInputTooLargeError';
  }
}

/**
 * Thrown when an entity's header section contains more than MAX_HEADERS fields.
 */
export class EmailTooManyHeadersError extends WebcvtError {
  constructor(max: number) {
    super('EMAIL_TOO_MANY_HEADERS', `EML header section exceeds the cap of ${max} header fields.`);
    this.name = 'EmailTooManyHeadersError';
  }
}

/**
 * Thrown when a single physical header line exceeds MAX_HEADER_LINE_BYTES.
 */
export class EmailHeaderLineTooLongError extends WebcvtError {
  constructor(length: number, max: number) {
    super(
      'EMAIL_HEADER_LINE_TOO_LONG',
      `EML header line is ${length} bytes which exceeds the cap of ${max} (16 KiB).`,
    );
    this.name = 'EmailHeaderLineTooLongError';
  }
}

/**
 * Thrown when MIME multipart nesting exceeds MAX_MIME_DEPTH.
 */
export class EmailMimeTooDeepError extends WebcvtError {
  constructor(depth: number, max: number) {
    super(
      'EMAIL_MIME_TOO_DEEP',
      `EML MIME nesting depth ${depth} exceeds the cap of ${max}. Deeply nested multipart messages are rejected to prevent stack overflow.`,
    );
    this.name = 'EmailMimeTooDeepError';
  }
}

/**
 * Thrown when the total number of MIME parts exceeds MAX_MIME_PARTS.
 */
export class EmailTooManyPartsError extends WebcvtError {
  constructor(max: number) {
    super(
      'EMAIL_TOO_MANY_PARTS',
      `EML message contains more than ${max} MIME parts. Large part counts are rejected to prevent memory exhaustion.`,
    );
    this.name = 'EmailTooManyPartsError';
  }
}

/**
 * Thrown when a `multipart/*` entity declares no `boundary` parameter.
 */
export class EmailMissingBoundaryError extends WebcvtError {
  constructor(contentType: string) {
    super(
      'EMAIL_MISSING_BOUNDARY',
      `EML "${contentType}" entity is missing the required boundary parameter (RFC 2046 §5.1).`,
    );
    this.name = 'EmailMissingBoundaryError';
  }
}

/**
 * Thrown when a Content-Transfer-Encoding outside the supported set is found.
 * Supported: 7bit, 8bit, binary, base64, quoted-printable.
 */
export class EmailUnsupportedTransferEncodingError extends WebcvtError {
  constructor(encoding: string) {
    super(
      'EMAIL_UNSUPPORTED_TRANSFER_ENCODING',
      `EML Content-Transfer-Encoding "${encoding}" is not supported. Supported: 7bit, 8bit, binary, base64, quoted-printable.`,
    );
    this.name = 'EmailUnsupportedTransferEncodingError';
  }
}

/**
 * Thrown when the cumulative decoded attachment size exceeds
 * MAX_TOTAL_ATTACHMENT_BYTES.
 */
export class EmailAttachmentsTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'EMAIL_ATTACHMENTS_TOO_LARGE',
      `EML decoded attachment payload total is ${size} bytes which exceeds the cap of ${max} (64 MiB).`,
    );
    this.name = 'EmailAttachmentsTooLargeError';
  }
}
