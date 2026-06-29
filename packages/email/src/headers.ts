/**
 * RFC 5322 header-section parsing for webcvt-email.
 *
 * Responsibilities:
 *   - Split the header section into fields with folding/unfolding (§2.2.3).
 *   - Tolerate CRLF and bare LF line endings.
 *   - Preserve original field-name case and multiple same-name headers.
 *   - Build a case-insensitive lookup map using a prototype-free object
 *     (Object.create(null)) as a prototype-pollution defense.
 *   - Parse parameterised headers (Content-Type, Content-Disposition) into a
 *     value plus a prototype-free parameter map.
 *
 * All scanning is hand-written and linear; no backtracking regex is run on
 * untrusted variable-length input.
 */

import { HT, SP } from './bytes.ts';
import { MAX_HEADERS, MAX_HEADER_LINE_BYTES } from './constants.ts';
import { EmailHeaderLineTooLongError, EmailTooManyHeadersError } from './errors.ts';

/** A raw (undecoded) header field: unfolded value, original-case name. */
export interface RawHeaderField {
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Header field parsing + unfolding
// ---------------------------------------------------------------------------

/**
 * Parse a header-section string (already Latin-1 decoded so length === bytes)
 * into ordered, unfolded fields.
 *
 * @throws EmailHeaderLineTooLongError when a physical line exceeds the cap.
 * @throws EmailTooManyHeadersError when field count exceeds the cap.
 */
export function parseHeaderFields(headerSection: string): RawHeaderField[] {
  const fields: RawHeaderField[] = [];
  const lines = headerSection.split('\n');

  let current: RawHeaderField | null = null;

  const flush = (): void => {
    if (current === null) return;
    if (fields.length >= MAX_HEADERS) {
      throw new EmailTooManyHeadersError(MAX_HEADERS);
    }
    current.value = current.value.trim();
    fields.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length > MAX_HEADER_LINE_BYTES) {
      throw new EmailHeaderLineTooLongError(line.length, MAX_HEADER_LINE_BYTES);
    }
    if (line === '') continue;

    const firstCode = line.charCodeAt(0);
    const isFoldedContinuation = firstCode === SP || firstCode === HT;

    if (isFoldedContinuation && current !== null) {
      // Unfolding (§2.2.3): drop the CRLF, keep the continuation incl. its WSP.
      current.value += line;
      continue;
    }

    flush();

    const colon = line.indexOf(':');
    if (colon === -1) continue; // not a valid field line; tolerate by skipping
    current = { name: line.slice(0, colon).trim(), value: line.slice(colon + 1) };
  }

  flush();
  return fields;
}

// ---------------------------------------------------------------------------
// Case-insensitive lookup map (prototype-free)
// ---------------------------------------------------------------------------

/** A prototype-free map from lowercased field name to its raw values. */
export type HeaderMap = Record<string, string[]>;

/** Build a prototype-free, case-insensitive map of raw header values. */
export function buildHeaderMap(fields: readonly RawHeaderField[]): HeaderMap {
  const map: HeaderMap = Object.create(null);
  for (const field of fields) {
    const key = field.name.toLowerCase();
    const existing = map[key];
    if (existing) existing.push(field.value);
    else map[key] = [field.value];
  }
  return map;
}

/** First raw value for a header name, or undefined. */
export function firstHeader(map: HeaderMap, name: string): string | undefined {
  return map[name]?.[0];
}

// ---------------------------------------------------------------------------
// Parameterised header parsing (Content-Type, Content-Disposition)
// ---------------------------------------------------------------------------

/** A parameterised header: a leading value plus a prototype-free param map. */
export interface ParameterisedHeader {
  /** The main token, lowercased and trimmed (e.g. "text/plain"). */
  value: string;
  /** Parameters keyed by lowercased name. First occurrence wins. */
  params: Record<string, string>;
}

/** Split a string on an unquoted occurrence of `sep` (respecting `"`...`"`). */
function splitUnquoted(input: string, sep: string): string[] {
  const segments: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && input[i - 1] !== '\\') {
      inQuote = !inQuote;
      buf += ch;
      continue;
    }
    if (ch === sep && !inQuote) {
      segments.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  segments.push(buf);
  return segments;
}

/** Remove surrounding quotes and resolve `\x` escapes from a quoted-string. */
function unquote(value: string): string {
  if (value.length < 2 || value[0] !== '"') return value;
  let out = '';
  // Walk from the first char after the opening quote; stop at the closing quote.
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      out += value[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  return out;
}

/**
 * Parse a parameterised header value (RFC 2045 §5.1 grammar shape) into its
 * leading token and a prototype-free parameter map.
 */
export function parseParameterisedHeader(raw: string): ParameterisedHeader {
  const params: Record<string, string> = Object.create(null);
  const segments = splitUnquoted(raw, ';');
  const value = (segments[0] ?? '').trim().toLowerCase();

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i] ?? '';
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    if (key === '') continue;
    const rawValue = segment.slice(eq + 1).trim();
    const paramValue = rawValue.startsWith('"') ? unquote(rawValue) : rawValue;
    if (!(key in params)) params[key] = paramValue;
  }

  return { value, params };
}

/** Parsed Content-Type: type, subtype, and parameters. */
export interface ContentType {
  /** Primary type, lowercased (e.g. "text", "multipart"). */
  type: string;
  /** Subtype, lowercased (e.g. "plain", "mixed"). */
  subtype: string;
  /** Parameters keyed by lowercased name (prototype-free). */
  params: Record<string, string>;
}

/** Parse a Content-Type value into its type/subtype and parameters. */
export function parseContentType(raw: string): ContentType {
  const { value, params } = parseParameterisedHeader(raw);
  const slash = value.indexOf('/');
  if (slash === -1) return { type: value, subtype: '', params };
  return { type: value.slice(0, slash), subtype: value.slice(slash + 1), params };
}
