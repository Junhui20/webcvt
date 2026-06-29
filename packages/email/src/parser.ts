/**
 * Top-level EML parser for webcvt-email.
 *
 * `parseEml` ties the pieces together: normalise input to bytes, enforce the
 * input-size cap, split the header section from the body, parse and decode the
 * headers, derive the well-known fields (From/To/Cc/Subject/Date), then walk
 * the MIME tree to collect the text/HTML bodies and attachments.
 */

import { parseAddressList } from './address.ts';
import { latin1Decode, splitHeaderBody, toBytes } from './bytes.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import { decodeEncodedWords } from './encoded-word.ts';
import { EmailInputTooLargeError } from './errors.ts';
import { type HeaderMap, buildHeaderMap, parseHeaderFields } from './headers.ts';
import { parseEntity } from './mime.ts';
import type { EmailAddress, EmailHeaderField, EmailMessage, ParseContext } from './model.ts';

/** All raw values for a header name joined with ", " (combines folded duplicates). */
function joinedHeader(map: HeaderMap, name: string): string | undefined {
  const values = map[name];
  return values === undefined ? undefined : values.join(', ');
}

/**
 * Parse an EML (RFC 5322 + MIME) message into a structured {@link EmailMessage}.
 *
 * @param input - The raw message as a UTF-8 string or raw bytes.
 * @returns The parsed message: headers, well-known fields, bodies, attachments.
 * @throws EmailInputTooLargeError when input exceeds 64 MiB.
 * @throws EmailTooManyHeadersError / EmailHeaderLineTooLongError on header caps.
 * @throws EmailMimeTooDeepError / EmailTooManyPartsError on MIME caps.
 * @throws EmailMissingBoundaryError on a multipart with no boundary parameter.
 * @throws EmailUnsupportedTransferEncodingError on an unknown CTE.
 * @throws EmailAttachmentsTooLargeError when decoded attachments exceed the cap.
 */
export function parseEml(input: string | Uint8Array): EmailMessage {
  const bytes = toBytes(input);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new EmailInputTooLargeError(bytes.length, MAX_INPUT_BYTES);
  }

  const { header, body } = splitHeaderBody(bytes);
  const fields = parseHeaderFields(latin1Decode(header));
  const map = buildHeaderMap(fields);

  // Public, decoded header list (preserves order and duplicates).
  const headers: EmailHeaderField[] = fields.map((field) => ({
    name: field.name,
    value: decodeEncodedWords(field.value),
  }));

  const subjectRaw = map.subject?.[0];
  const subject = subjectRaw === undefined ? undefined : decodeEncodedWords(subjectRaw);

  const fromRaw = map.from?.[0];
  const from: EmailAddress | undefined = fromRaw ? parseAddressList(fromRaw)[0] : undefined;

  const toRaw = joinedHeader(map, 'to');
  const toList = toRaw ? parseAddressList(toRaw) : [];
  const to = toList.length > 0 ? toList : undefined;

  const ccRaw = joinedHeader(map, 'cc');
  const ccList = ccRaw ? parseAddressList(ccRaw) : [];
  const cc = ccList.length > 0 ? ccList : undefined;

  const dateRaw = map.date?.[0];
  const date = dateRaw === undefined ? undefined : decodeEncodedWords(dateRaw).trim();

  const ctx: ParseContext = { attachments: [], partCount: 0, attachmentBytes: 0 };
  parseEntity(map, body, 0, ctx);

  return {
    headers,
    from,
    to,
    cc,
    subject,
    date,
    textBody: ctx.textBody,
    htmlBody: ctx.htmlBody,
    attachments: ctx.attachments,
  };
}

/** Alias for {@link parseEml}. */
export const parseEmail = parseEml;
