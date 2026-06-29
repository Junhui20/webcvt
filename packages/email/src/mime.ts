/**
 * MIME body parsing for webcvt-email (RFC 2045 / RFC 2046).
 *
 * Walks an entity tree: multipart/* entities are split on their boundary and
 * recursed (with a depth cap and a global part cap); leaf entities are decoded
 * per their Content-Transfer-Encoding and routed to either the text/HTML body
 * accumulators or the attachment list (with a cumulative-size cap).
 *
 * Boundary detection is a hand-written, line-anchored byte scan — a boundary is
 * only recognised at the start of a line, which is impossible to forge from
 * base64 (no `-`) or well-formed quoted-printable content.
 */

import { CR, HT, LF, SP, indexOfLF, latin1Decode, latin1Encode, splitHeaderBody } from './bytes.ts';
import { MAX_MIME_DEPTH, MAX_MIME_PARTS, MAX_TOTAL_ATTACHMENT_BYTES } from './constants.ts';
import { decodeEncodedWords } from './encoded-word.ts';
import {
  EmailAttachmentsTooLargeError,
  EmailMimeTooDeepError,
  EmailMissingBoundaryError,
  EmailTooManyPartsError,
} from './errors.ts';
import {
  type HeaderMap,
  buildHeaderMap,
  firstHeader,
  parseContentType,
  parseHeaderFields,
  parseParameterisedHeader,
} from './headers.ts';
import type { ParseContext } from './model.ts';
import { decodeBytesWithCharset, decodeTransferEncoding } from './transfer-encoding.ts';

// ---------------------------------------------------------------------------
// Multipart boundary splitting
// ---------------------------------------------------------------------------

interface BoundaryHit {
  /** Index of the first `-` of the delimiter line. */
  lineStart: number;
  /** Index of the first body byte after this delimiter line's terminator. */
  contentStart: number;
  /** Whether this is the closing delimiter (`--boundary--`). */
  closing: boolean;
}

/** ASCII hyphen-minus (`-`). */
const DASH = 0x2d;

/** True if `body` contains `delim` exactly at index `pos`. */
function matchesAt(body: Uint8Array, pos: number, delim: Uint8Array): boolean {
  if (pos + delim.length > body.length) return false;
  for (let k = 0; k < delim.length; k++) {
    if (body[pos + k] !== delim[k]) return false;
  }
  return true;
}

/**
 * Recognise a boundary delimiter line at `pos`.
 *
 * A valid line is `--boundary` (optionally `--boundary--` for the close)
 * followed only by optional linear whitespace and then CRLF / LF / end-of-input
 * (RFC 2046 §5.1.1). The trailing-character check is what stops a boundary like
 * `b2` from matching the unrelated line `--b20`.
 */
function boundaryAt(
  body: Uint8Array,
  pos: number,
  delim: Uint8Array,
  len: number,
): { contentStart: number; closing: boolean } | null {
  if (!matchesAt(body, pos, delim)) return null;
  let after = pos + delim.length;
  const closing = body[after] === DASH && body[after + 1] === DASH;
  if (closing) after += 2;
  // Everything up to the line terminator must be linear whitespace.
  for (let scan = after; scan < len && body[scan] !== CR && body[scan] !== LF; scan++) {
    if (body[scan] !== SP && body[scan] !== HT) return null;
  }
  const nl = indexOfLF(body, after);
  return { contentStart: nl === -1 ? len : nl + 1, closing };
}

/**
 * Split a multipart body into its constituent part byte ranges (preamble and
 * epilogue discarded). Each returned slice is a full child entity
 * (headers + blank line + body).
 */
export function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  const delim = latin1Encode(`--${boundary}`);
  const hits: BoundaryHit[] = [];
  const len = body.length;

  let lineStart = 0;
  while (lineStart <= len) {
    const hit = boundaryAt(body, lineStart, delim, len);
    if (hit) {
      hits.push({ lineStart, contentStart: hit.contentStart, closing: hit.closing });
      lineStart = hit.contentStart;
      if (hit.closing) break;
      continue;
    }
    const nl = indexOfLF(body, lineStart);
    if (nl === -1) break;
    lineStart = nl + 1;
  }

  const parts: Uint8Array[] = [];
  for (let i = 0; i < hits.length - 1; i++) {
    const start = hits[i]?.contentStart ?? 0;
    let end = hits[i + 1]?.lineStart ?? len;
    // The CRLF (or LF) immediately preceding the next delimiter line belongs to
    // the boundary, not the part body — strip one terminator.
    if (end > start && body[end - 1] === LF) {
      end -= 1;
      if (end > start && body[end - 1] === CR) end -= 1;
    }
    parts.push(body.subarray(start, Math.max(start, end)));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Leaf classification + collection
// ---------------------------------------------------------------------------

/** Resolve the suggested filename from disposition or content-type params. */
function resolveFilename(map: HeaderMap, ctParams: Record<string, string>): string | undefined {
  const disposition = firstHeader(map, 'content-disposition');
  const dispFilename = disposition
    ? parseParameterisedHeader(disposition).params.filename
    : undefined;
  const raw = dispFilename ?? ctParams.name;
  return raw === undefined ? undefined : decodeEncodedWords(raw);
}

/** Content-ID value with surrounding angle brackets removed. */
function resolveContentId(map: HeaderMap): string | undefined {
  const raw = firstHeader(map, 'content-id');
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const start = trimmed.startsWith('<') ? 1 : 0;
  const end = trimmed.endsWith('>') ? trimmed.length - 1 : trimmed.length;
  return trimmed.slice(start, end);
}

/** Decode and route a leaf entity to a body accumulator or the attachment list. */
function collectLeaf(map: HeaderMap, body: Uint8Array, ctx: ParseContext): void {
  const ct = parseContentType(firstHeader(map, 'content-type') ?? 'text/plain');
  const cte = (firstHeader(map, 'content-transfer-encoding') ?? '7bit').trim().toLowerCase();
  const decoded = decodeTransferEncoding(body, cte);

  const disposition = firstHeader(map, 'content-disposition');
  const dispType = disposition ? parseParameterisedHeader(disposition).value : undefined;
  const filename = resolveFilename(map, ct.params);

  const isTextPlain = ct.type === 'text' && ct.subtype === 'plain';
  const isTextHtml = ct.type === 'text' && ct.subtype === 'html';
  const treatAsBody =
    (isTextPlain || isTextHtml) && dispType !== 'attachment' && filename === undefined;

  if (treatAsBody) {
    const text = decodeBytesWithCharset(decoded, ct.params.charset ?? 'utf-8');
    if (isTextPlain) {
      ctx.textBody = ctx.textBody === undefined ? text : `${ctx.textBody}\n${text}`;
    } else {
      ctx.htmlBody = ctx.htmlBody === undefined ? text : `${ctx.htmlBody}\n${text}`;
    }
    return;
  }

  ctx.attachmentBytes += decoded.length;
  if (ctx.attachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new EmailAttachmentsTooLargeError(ctx.attachmentBytes, MAX_TOTAL_ATTACHMENT_BYTES);
  }
  const contentType = ct.subtype === '' ? ct.type : `${ct.type}/${ct.subtype}`;
  ctx.attachments.push({
    filename,
    contentType,
    bytes: decoded,
    size: decoded.length,
    contentId: resolveContentId(map),
  });
}

// ---------------------------------------------------------------------------
// Recursive entity walk
// ---------------------------------------------------------------------------

/**
 * Recursively parse one MIME entity, accumulating bodies and attachments into
 * `ctx`. `depth` is the current multipart nesting level (0 at the top).
 */
export function parseEntity(
  map: HeaderMap,
  body: Uint8Array,
  depth: number,
  ctx: ParseContext,
): void {
  const ct = parseContentType(firstHeader(map, 'content-type') ?? 'text/plain');

  if (ct.type !== 'multipart') {
    collectLeaf(map, body, ctx);
    return;
  }

  if (depth + 1 > MAX_MIME_DEPTH) {
    throw new EmailMimeTooDeepError(depth + 1, MAX_MIME_DEPTH);
  }

  const boundary = ct.params.boundary;
  if (boundary === undefined || boundary === '') {
    throw new EmailMissingBoundaryError(`${ct.type}/${ct.subtype}`);
  }

  const parts = splitMultipart(body, boundary);
  ctx.partCount += parts.length;
  if (ctx.partCount > MAX_MIME_PARTS) {
    throw new EmailTooManyPartsError(MAX_MIME_PARTS);
  }

  for (const part of parts) {
    const { header, body: childBody } = splitHeaderBody(part);
    const childFields = parseHeaderFields(latin1Decode(header));
    const childMap = buildHeaderMap(childFields);
    parseEntity(childMap, childBody, depth + 1, ctx);
  }
}
