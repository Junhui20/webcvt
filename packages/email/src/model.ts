/**
 * Public data model for @catlabtech/webcvt-email.
 *
 * These types describe the structured shape returned by `parseEml`. They are
 * intentionally plain (no methods) so that the whole message round-trips
 * cleanly through `JSON.stringify` in the backend.
 */

/** A parsed mailbox / addr-spec (RFC 5322 §3.4). */
export interface EmailAddress {
  /** Display name (RFC 2047 encoded-words decoded), if present. */
  readonly name?: string;
  /** The addr-spec, e.g. "user@example.com". */
  readonly address: string;
}

/** A single header field, in document order. */
export interface EmailHeaderField {
  /** Field name exactly as it appeared in the message (original case). */
  readonly name: string;
  /** Unfolded, RFC 2047-decoded field value. */
  readonly value: string;
}

/** A non-body MIME part collected as an attachment. */
export interface EmailAttachment {
  /** Suggested filename from Content-Disposition or the Content-Type name param. */
  readonly filename?: string;
  /** MIME content type, e.g. "image/png". */
  readonly contentType: string;
  /** Decoded raw payload bytes. */
  readonly bytes: Uint8Array;
  /** Byte length of `bytes`. */
  readonly size: number;
  /** Content-ID with angle brackets stripped, if present (inline parts). */
  readonly contentId?: string;
}

/** The fully parsed message returned by `parseEml`. */
export interface EmailMessage {
  /** All header fields of the top-level entity, in order, with decoded values. */
  readonly headers: readonly EmailHeaderField[];
  /** First From address, if a From header is present. */
  readonly from?: EmailAddress;
  /** To recipients, if a To header is present. */
  readonly to?: readonly EmailAddress[];
  /** Cc recipients, if a Cc header is present. */
  readonly cc?: readonly EmailAddress[];
  /** Decoded Subject, if present. */
  readonly subject?: string;
  /** Raw Date header value (decoded), if present. */
  readonly date?: string;
  /** Decoded text/plain body, if any. */
  readonly textBody?: string;
  /** Decoded text/html body, if any. */
  readonly htmlBody?: string;
  /** Collected attachments (may be empty). */
  readonly attachments: readonly EmailAttachment[];
}

/**
 * Mutable accumulator threaded through the recursive MIME walk.
 * Internal — not part of the public API.
 */
export interface ParseContext {
  textBody?: string;
  htmlBody?: string;
  attachments: EmailAttachment[];
  /** Running count of all parts seen, for the MAX_MIME_PARTS cap. */
  partCount: number;
  /** Running sum of decoded attachment bytes, for the cumulative cap. */
  attachmentBytes: number;
}
