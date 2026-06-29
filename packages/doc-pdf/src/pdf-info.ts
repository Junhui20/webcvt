/**
 * parsePdfInfo — a deliberately *light*, bounded, read-only PDF reader.
 *
 * It answers only structural questions: the header version, the page count, and
 * the /Info document-metadata strings. It resolves /Root → /Pages → /Count,
 * falling back to a max-/Count or a /Type /Page object scan when the trailer is
 * absent or unreadable.
 *
 * OUT OF SCOPE — by design, and never attempted here: content-stream decoding,
 * font/CMap handling, and any form of TEXT EXTRACTION. This reader exists to
 * describe a PDF, not to read its words; extracting page text would require a
 * full content-stream/font interpreter and is explicitly not provided.
 */

import {
  MAX_DICT_BYTES,
  MAX_INPUT_BYTES,
  MAX_PDF_OBJECTS,
  MAX_PDF_STRING_BYTES,
} from './constants.ts';
import { DocPdfInputTooLargeError, DocPdfParseError } from './errors.ts';
import {
  decodeLatin1,
  findObjectDict,
  indexOfSeq,
  isDelim,
  isWs,
  lastIndexOfSeq,
  matchDictEnd,
} from './pdf-scan.ts';

/** Structural metadata extracted by {@link parsePdfInfo}. */
export interface PdfInfo {
  /** PDF version from the `%PDF-x.y` header (e.g. "1.7"). */
  readonly version: string;
  /** Number of pages (leaf /Page nodes). */
  readonly pageCount: number;
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly creator?: string;
  readonly producer?: string;
}

/** Options for {@link parsePdfInfo} (cap overrides, primarily for testing). */
export interface ParsePdfInfoOptions {
  /** Override the maximum accepted input size (default 256 MiB). */
  readonly maxInputBytes?: number;
}

interface IndirectRef {
  readonly num: number;
  readonly gen: number;
}

const LATIN1 = new TextDecoder('latin1');

// ---------------------------------------------------------------------------
// Header version
// ---------------------------------------------------------------------------

/** Read the `%PDF-x.y` version from the file head. */
function readVersion(bytes: Uint8Array): string {
  const limit = Math.min(bytes.length, 1024);
  const head = decodeLatin1(bytes, 0, limit);
  const idx = head.indexOf('%PDF-');
  if (idx === -1) {
    throw new DocPdfParseError('Not a PDF: missing "%PDF-" header.');
  }
  let version = '';
  for (let i = idx + 5; i < head.length && version.length < 8; i++) {
    const ch = head[i] ?? '';
    if ((ch >= '0' && ch <= '9') || ch === '.') version += ch;
    else break;
  }
  if (version.length === 0) {
    throw new DocPdfParseError('Malformed PDF version header.');
  }
  return version;
}

// ---------------------------------------------------------------------------
// Dictionary value extraction (operates on a decoded `<< … >>` slice)
// ---------------------------------------------------------------------------

/** Index just after `/key` when it appears as a whole name, else -1. */
function findKeyPos(dict: string, key: string): number {
  const token = `/${key}`;
  let from = 0;
  for (;;) {
    const i = dict.indexOf(token, from);
    if (i === -1) return -1;
    const after = i + token.length;
    const code = after < dict.length ? dict.charCodeAt(after) : Number.NaN;
    if (Number.isNaN(code) || isWs(code) || isDelim(code)) return after;
    from = i + 1;
  }
}

/** Parse a signed integer starting at `pos` (after skipping whitespace). */
function parseIntAt(s: string, pos: number): { value: number; next: number } | undefined {
  let i = pos;
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  let sign = 1;
  if (s[i] === '+') i++;
  else if (s[i] === '-') {
    sign = -1;
    i++;
  }
  const start = i;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if (code < 0x30 || code > 0x39) break;
    i++;
  }
  if (i === start) return undefined;
  return { value: sign * Number(s.slice(start, i)), next: i };
}

/** Read an integer value for `/key` from a dictionary slice. */
function readIntInDict(dict: string, key: string): number | undefined {
  const pos = findKeyPos(dict, key);
  if (pos === -1) return undefined;
  return parseIntAt(dict, pos)?.value;
}

/** Read an indirect reference `num gen R` for `/key` from a dictionary slice. */
function readRefInDict(dict: string, key: string): IndirectRef | undefined {
  const pos = findKeyPos(dict, key);
  if (pos === -1) return undefined;
  const a = parseIntAt(dict, pos);
  if (!a) return undefined;
  const b = parseIntAt(dict, a.next);
  if (!b) return undefined;
  let i = b.next;
  while (i < dict.length && isWs(dict.charCodeAt(i))) i++;
  if (dict[i] !== 'R') return undefined;
  return { num: a.value, gen: b.value };
}

// ---------------------------------------------------------------------------
// PDF string parsing
// ---------------------------------------------------------------------------

function hexVal(ch: string | undefined): number {
  if (ch === undefined) return -1;
  const c = ch.charCodeAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/** Parse a literal string `( … )` starting at `i` (just after the `(`). */
function parseLiteral(s: string, i: number): number[] {
  const out: number[] = [];
  let depth = 1;
  let j = i;
  while (j < s.length && out.length < MAX_PDF_STRING_BYTES) {
    const c = s[j++];
    if (c === '\\') {
      const e = s[j++];
      switch (e) {
        case 'n':
          out.push(0x0a);
          break;
        case 'r':
          out.push(0x0d);
          break;
        case 't':
          out.push(0x09);
          break;
        case 'b':
          out.push(0x08);
          break;
        case 'f':
          out.push(0x0c);
          break;
        case '(':
          out.push(0x28);
          break;
        case ')':
          out.push(0x29);
          break;
        case '\\':
          out.push(0x5c);
          break;
        case '\r':
          if (s[j] === '\n') j++;
          break;
        case '\n':
          break;
        default:
          if (e !== undefined && e >= '0' && e <= '7') {
            let oct = e;
            for (let k = 0; k < 2; k++) {
              const d = s[j];
              if (d !== undefined && d >= '0' && d <= '7') {
                oct += d;
                j++;
              } else break;
            }
            out.push(Number.parseInt(oct, 8) & 0xff);
          } else if (e !== undefined) {
            out.push(e.charCodeAt(0) & 0xff);
          }
      }
      continue;
    }
    if (c === '(') {
      depth++;
      out.push(0x28);
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth === 0) break;
      out.push(0x29);
      continue;
    }
    if (c !== undefined) out.push(c.charCodeAt(0) & 0xff);
  }
  return out;
}

/** Parse a hex string `< … >` starting at `i` (just after the `<`). */
function parseHex(s: string, i: number): number[] {
  const out: number[] = [];
  let hi = -1;
  let j = i;
  while (j < s.length && out.length < MAX_PDF_STRING_BYTES) {
    const c = s[j++];
    if (c === '>') {
      hi = closeHex(out, hi);
      return out;
    }
    const d = hexVal(c);
    if (d < 0) continue;
    if (hi < 0) hi = d;
    else {
      out.push((hi << 4) | d);
      hi = -1;
    }
  }
  closeHex(out, hi);
  return out;
}

/** A trailing odd hex nibble is treated as the high half of a final byte. */
function closeHex(out: number[], hi: number): number {
  if (hi >= 0) out.push(hi << 4);
  return -1;
}

/** Decode PDF string bytes: UTF-16BE if BOM-prefixed, else Latin-1/PDFDoc. */
function decodePdfStringBytes(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return out;
  }
  return LATIN1.decode(Uint8Array.from(bytes));
}

/** Read a string value (`( … )` or `< … >`) for `/key` from a dictionary slice. */
function readStringInDict(dict: string, key: string): string | undefined {
  const pos = findKeyPos(dict, key);
  if (pos === -1) return undefined;
  let i = pos;
  while (i < dict.length && isWs(dict.charCodeAt(i))) i++;
  const ch = dict[i];
  if (ch === '(') return decodePdfStringBytes(parseLiteral(dict, i + 1));
  if (ch === '<' && dict[i + 1] !== '<') return decodePdfStringBytes(parseHex(dict, i + 1));
  return undefined;
}

// ---------------------------------------------------------------------------
// Trailer + page-count resolution
// ---------------------------------------------------------------------------

/** Find the last `trailer << … >>` dictionary text, or undefined. */
function findTrailerDict(bytes: Uint8Array): string | undefined {
  const kw = lastIndexOfSeq(bytes, 'trailer');
  if (kw === -1) return undefined;
  const lt = indexOfSeq(bytes, '<<', kw);
  if (lt === -1) return undefined;
  const end = matchDictEnd(bytes, lt, MAX_DICT_BYTES);
  if (end === -1) return undefined;
  return decodeLatin1(bytes, lt, end);
}

/** Primary path: /Root → /Pages → /Count. Returns undefined on any miss. */
function pageCountViaRoot(bytes: Uint8Array, root: IndirectRef): number | undefined {
  const catalog = findObjectDict(bytes, root.num, root.gen, MAX_DICT_BYTES);
  if (catalog === undefined) return undefined;
  const pagesRef = readRefInDict(catalog, 'Pages');
  if (!pagesRef) return undefined;
  const pages = findObjectDict(bytes, pagesRef.num, pagesRef.gen, MAX_DICT_BYTES);
  if (pages === undefined) return undefined;
  const count = readIntInDict(pages, 'Count');
  return count !== undefined && count >= 0 ? count : undefined;
}

/** Fallback A: the largest `/Count` anywhere — the root Pages node's total. */
function maxCount(bytes: Uint8Array): number {
  let best = 0;
  let from = 0;
  let visited = 0;
  for (;;) {
    const i = indexOfSeq(bytes, '/Count', from);
    if (i === -1) break;
    if (++visited > MAX_PDF_OBJECTS) break;
    const after = i + 6;
    const code = after < bytes.length ? (bytes[after] ?? 0) : 0;
    if (isWs(code) || isDelim(code) || after >= bytes.length) {
      const slice = decodeLatin1(bytes, after, Math.min(bytes.length, after + 24));
      const parsed = leadingInt(slice);
      if (parsed !== undefined && parsed > best) best = parsed;
    }
    from = i + 6;
  }
  return best;
}

/** Fallback B: count `/Page` value tokens that are not `/Pages`. */
function countPageLeaves(bytes: Uint8Array): number {
  let count = 0;
  let from = 0;
  let visited = 0;
  for (;;) {
    const i = indexOfSeq(bytes, '/Page', from);
    if (i === -1) break;
    if (++visited > MAX_PDF_OBJECTS) break;
    const after = i + 5;
    const next = after < bytes.length ? (bytes[after] ?? 0) : 0;
    const isLeaf = after >= bytes.length || isWs(next) || isDelim(next);
    if (isLeaf) count++;
    from = i + 5;
  }
  return count;
}

/** Parse a leading optional-whitespace signed integer from a short slice. */
function leadingInt(s: string): number | undefined {
  return parseIntAt(s, 0)?.value;
}

/** Resolve the page count via the trailer, then the documented fallbacks. */
function resolvePageCount(bytes: Uint8Array, root: IndirectRef | undefined): number {
  if (root) {
    const viaRoot = pageCountViaRoot(bytes, root);
    if (viaRoot !== undefined) return viaRoot;
  }
  const a = maxCount(bytes);
  if (a > 0) return a;
  const b = countPageLeaves(bytes);
  if (b > 0) return b;
  throw new DocPdfParseError('Could not determine the PDF page count.');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse light structural info from a PDF: version, page count, and /Info
 * metadata strings. Tolerant of malformed input — it throws a typed
 * {@link DocPdfParseError} rather than producing garbage, and never attempts
 * text extraction.
 *
 * @throws {DocPdfInputTooLargeError} when the input exceeds the byte cap.
 * @throws {DocPdfParseError} when the bytes are not a recognisable PDF.
 */
export function parsePdfInfo(bytes: Uint8Array, opts?: ParsePdfInfoOptions): PdfInfo {
  const maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
  if (bytes.length > maxInputBytes) {
    throw new DocPdfInputTooLargeError(bytes.length, maxInputBytes);
  }

  const version = readVersion(bytes);

  const trailer = findTrailerDict(bytes);
  const rootRef = trailer ? readRefInDict(trailer, 'Root') : undefined;
  const infoRef = trailer ? readRefInDict(trailer, 'Info') : undefined;

  const pageCount = resolvePageCount(bytes, rootRef);

  const info = infoRef
    ? findObjectDict(bytes, infoRef.num, infoRef.gen, MAX_DICT_BYTES)
    : undefined;

  const result: PdfInfo = {
    version,
    pageCount,
    title: info ? readStringInDict(info, 'Title') : undefined,
    author: info ? readStringInDict(info, 'Author') : undefined,
    subject: info ? readStringInDict(info, 'Subject') : undefined,
    creator: info ? readStringInDict(info, 'Creator') : undefined,
    producer: info ? readStringInDict(info, 'Producer') : undefined,
  };
  return result;
}
