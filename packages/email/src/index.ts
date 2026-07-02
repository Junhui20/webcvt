/**
 * @catlabtech/webcvt-email — Public API
 *
 * A self-written, dependency-free EML (RFC 5322 + MIME) parser:
 *   - RFC 5322 header section: CRLF/bare-LF tolerant, folding/unfolding,
 *     case-insensitive field names, multiple same-name headers preserved.
 *   - RFC 2047 encoded-words (=?charset?B?...?= and =?charset?Q?...?=).
 *   - RFC 2045/2046 MIME: Content-Type (+ boundary), Content-Transfer-Encoding
 *     (7bit, 8bit, binary, base64, quoted-printable), recursive multipart/*
 *     parsing with depth/part caps, text/plain + text/html bodies, attachments.
 *
 * Clean-room: implemented from the RFCs, not ported from any existing library.
 *
 * Security: 64 MiB input cap, 1000-header cap, 16 KiB header-line cap, MIME
 * depth (20) and part (1000) caps, a cumulative decoded-attachment cap, and
 * prototype-free header/parameter maps. No backtracking regex runs on untrusted
 * variable-length input.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { EmailAddress, EmailAttachment, EmailHeaderField, EmailMessage } from './model.ts';

// ---------------------------------------------------------------------------
// Parser API
// ---------------------------------------------------------------------------

export { parseEmail, parseEml } from './parser.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptor + output serialisers
// ---------------------------------------------------------------------------

export {
  EmailBackend,
  EML_FORMAT,
  serializeMessageToJson,
  serializeMessageToText,
} from './backend.ts';

// ---------------------------------------------------------------------------
// Low-level helpers (exported for advanced consumers / testing)
// ---------------------------------------------------------------------------

export { decodeEncodedWords } from './encoded-word.ts';
export { parseAddressList } from './address.ts';
export { stripHtml } from './html.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  EmailAttachmentsTooLargeError,
  EmailHeaderLineTooLongError,
  EmailInputTooLargeError,
  EmailMimeTooDeepError,
  EmailMissingBoundaryError,
  EmailTooManyHeadersError,
  EmailTooManyPartsError,
  EmailUnsupportedTransferEncodingError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// registerEmailBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { EmailBackend } from './backend.ts';

/**
 * Construct an EmailBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('email')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerEmailBackend } from '@catlabtech/webcvt-email';
 * registerEmailBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerEmailBackend(registry: BackendRegistry = defaultRegistry): EmailBackend {
  const backend = new EmailBackend();
  registry.register(backend);
  return backend;
}
