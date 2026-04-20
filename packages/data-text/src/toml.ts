/**
 * TOML v1.0.0 parse/serialize for @webcvt/data-text.
 *
 * Architecture:
 *   - Hand-rolled recursive-descent parser over a character-at-a-time tokenizer.
 *   - NO regex for string literals (ReDoS defense — Trap design-note §Security).
 *   - NO third-party TOML library.
 *
 * Spec: https://toml.io/en/v1.0.0  +  toml.abnf v1.0.0 (CC-BY 3.0)
 * Date-time: RFC 3339.
 * Clean-room: no code ported from @iarna/toml, smol-toml, toml, fast-toml, j-toml.
 *
 * ## Traps honoured (from design note)
 * #1  Dates/times are typed objects (TomlDate/TomlTime/TomlDateTime), NOT strings.
 * #2  Integers use bigint (preserves 2^53..2^63-1 range).
 * #3  Dotted keys define intermediate tables with conflict detection.
 * #4  [table] headers define and enter; redefining throws TomlRedefineTableError.
 * #5  [[array]] appends to array-of-tables; conflicts with non-AOT throw.
 * #6  Multi-line basic string backslash-newline trim implemented.
 * #7  Literal strings process NO escape sequences.
 * #8  Inline tables: trailing comma forbidden, closed for further modification.
 * #9  Key ordering NOT preserved on round-trip; duplicates throw strictly.
 * #10 inf / nan valid float tokens; signed variants accepted; serializer normalizes.
 * #11 Date-time T-separator can be space (RFC 3339 §5.6).
 * #12 Leading-zero decimal integers rejected (01 invalid; 0x00FF fine).
 * #13 \uXXXX and \UXXXXXXXX: exactly 4/8 hex digits; surrogates rejected.
 *
 * ## Security caps (from constants.ts)
 * MAX_TOML_DEPTH = 64         (nesting depth, enforced incrementally)
 * MAX_TOML_STRING_LEN = 1 MiB (per string token)
 * MAX_TOML_KEYS_PER_TABLE = 10,000
 * MAX_TOML_ARRAY_LEN = 1,000,000
 * MAX_INPUT_BYTES / MAX_INPUT_CHARS (universal, via decodeInput)
 */

import {
  MAX_TOML_ARRAY_LEN,
  MAX_TOML_DEPTH,
  MAX_TOML_KEYS_PER_TABLE,
  MAX_TOML_STRING_LEN,
} from './constants.ts';
import {
  TomlBadDateError,
  TomlBadEscapeError,
  TomlBadNumberError,
  TomlConflictingTypeError,
  TomlDepthExceededError,
  TomlDuplicateKeyError,
  TomlInvalidUtf8Error,
  TomlParseError,
  TomlRedefineTableError,
  TomlSerializeError,
  TomlStringTooLongError,
} from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TomlDate {
  readonly kind: 'date';
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface TomlTime {
  readonly kind: 'time';
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string | null;
}

export interface TomlDateTime {
  readonly kind: 'datetime';
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string | null;
  /** Minutes from UTC. null = local date-time. 0 = Z. */
  readonly offsetMinutes: number | null;
}

export type TomlValue =
  | string
  | bigint
  | number
  | boolean
  | TomlDate
  | TomlTime
  | TomlDateTime
  | TomlValue[]
  | { [key: string]: TomlValue };

export interface TomlFile {
  value: { [key: string]: TomlValue };
  hadBom: boolean;
}

// ---------------------------------------------------------------------------
// Internal: per-table metadata for conflict detection (Traps #3 #4 #5)
// ---------------------------------------------------------------------------

interface TableMeta {
  /** Keys defined directly by this table's header or inline key = value. */
  definedDirectly: Set<string>;
  /** Keys implicitly created as sub-tables via dotted keys (a.b.c = 1 defines a and a.b). */
  definedByDotted: Set<string>;
  /** True after a [header] statement claims this table — further [header] redefinition throws. */
  closedViaHeader: boolean;
  /** True when created via an array-of-tables [[header]] entry. */
  isArrayOfTables: boolean;
  /** True for inline tables — immutable after construction. */
  isInlineTable: boolean;
}

// WeakMap keyed on the actual table object; avoids leaking into user values.
const META = new WeakMap<{ [key: string]: TomlValue }, TableMeta>();

function getMeta(tbl: { [key: string]: TomlValue }): TableMeta {
  let m = META.get(tbl);
  if (m === undefined) {
    m = {
      definedDirectly: new Set(),
      definedByDotted: new Set(),
      closedViaHeader: false,
      isArrayOfTables: false,
      isInlineTable: false,
    };
    META.set(tbl, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Internal: parser state
// ---------------------------------------------------------------------------

interface ParserState {
  src: string;
  pos: number;
  line: number;
  col: number;
}

function mkState(src: string): ParserState {
  return { src, pos: 0, line: 1, col: 1 };
}

function peek(s: ParserState): string {
  return s.src[s.pos] ?? '';
}

function peekAt(s: ParserState, offset: number): string {
  return s.src[s.pos + offset] ?? '';
}

function advance(s: ParserState): string {
  const c = s.src[s.pos] ?? '';
  s.pos += 1;
  if (c === '\n') {
    s.line += 1;
    s.col = 1;
  } else {
    s.col += 1;
  }
  return c;
}

function isEof(s: ParserState): boolean {
  return s.pos >= s.src.length;
}

function errAt(s: ParserState, msg: string): TomlParseError {
  const start = Math.max(0, s.pos - 10);
  const snippet = s.src.slice(start, s.pos + 20).replace(/\r?\n/g, '\\n');
  return new TomlParseError(msg, s.line, s.col, snippet);
}

// ---------------------------------------------------------------------------
// Whitespace / comment skipping
// ---------------------------------------------------------------------------

function skipWhitespaceAndNewlines(s: ParserState): void {
  while (!isEof(s)) {
    const c = peek(s);
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance(s);
    } else if (c === '#') {
      skipComment(s);
    } else {
      break;
    }
  }
}

function skipInlineWhitespace(s: ParserState): void {
  while (!isEof(s) && (peek(s) === ' ' || peek(s) === '\t')) {
    advance(s);
  }
}

function skipComment(s: ParserState): void {
  // skip '#' and everything until end of line
  while (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r') {
    advance(s);
  }
}

function skipToEndOfLine(s: ParserState): void {
  // skip optional comment + whitespace, then newline
  skipInlineWhitespace(s);
  if (!isEof(s) && peek(s) === '#') {
    skipComment(s);
  }
  if (!isEof(s)) {
    if (peek(s) === '\r') advance(s);
    if (!isEof(s) && peek(s) === '\n') advance(s);
  }
}

// ---------------------------------------------------------------------------
// String parsing — character-at-a-time, no regex (ReDoS defense)
// ---------------------------------------------------------------------------

function parseBasicString(s: ParserState): string {
  // Already consumed opening "
  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated basic string');
    const c = peek(s);

    if (c === '"') {
      advance(s);
      break;
    }
    if (c === '\\') {
      advance(s);
      const esc = parseEscapeSequence(s);
      len += esc.length;
      if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
      parts.push(esc);
      continue;
    }
    if (c === '\n' || c === '\r') {
      throw errAt(s, 'Newline inside basic string (use multi-line basic string instead)');
    }
    const ch = advance(s);
    len += 1;
    if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
    parts.push(ch);
  }
  return parts.join('');
}

function parseMultilineBasicString(s: ParserState): string {
  // Already consumed opening """
  // Optional immediate newline is trimmed (TOML spec)
  if (!isEof(s) && peek(s) === '\n') advance(s);
  else if (!isEof(s) && peek(s) === '\r') {
    advance(s);
    if (!isEof(s) && peek(s) === '\n') advance(s);
  }

  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated multi-line basic string');
    const c = peek(s);

    if (c === '"') {
      // Check for closing """
      if (peekAt(s, 1) === '"' && peekAt(s, 2) === '"') {
        advance(s);
        advance(s);
        advance(s);
        // TOML allows up to 2 extra quotes before the closing triple
        // e.g. """"" = "" followed by close """
        let extra = 0;
        while (!isEof(s) && peek(s) === '"' && extra < 2) {
          parts.push('"');
          len += 1;
          advance(s);
          extra += 1;
        }
        break;
      }
      const ch = advance(s);
      len += 1;
      if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
      parts.push(ch);
      continue;
    }

    if (c === '\\') {
      advance(s);
      // Trap #6: backslash at end of line trims newline + subsequent whitespace
      if (
        !isEof(s) &&
        (peek(s) === '\n' || peek(s) === '\r' || peek(s) === ' ' || peek(s) === '\t')
      ) {
        // Skip whitespace-and-newline trim sequence
        while (!isEof(s) && (peek(s) === ' ' || peek(s) === '\t')) advance(s);
        if (!isEof(s) && peek(s) === '\r') advance(s);
        if (!isEof(s) && peek(s) === '\n') advance(s);
        while (
          !isEof(s) &&
          (peek(s) === ' ' || peek(s) === '\t' || peek(s) === '\n' || peek(s) === '\r')
        ) {
          advance(s);
        }
        continue;
      }
      const esc = parseEscapeSequence(s);
      len += esc.length;
      if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
      parts.push(esc);
      continue;
    }

    const ch = advance(s);
    len += 1;
    if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
    parts.push(ch);
  }
  return parts.join('');
}

function parseLiteralString(s: ParserState): string {
  // Already consumed opening '  — Trap #7: no escape processing
  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated literal string');
    const c = peek(s);
    if (c === "'") {
      advance(s);
      break;
    }
    if (c === '\n' || c === '\r') {
      throw errAt(s, 'Newline inside literal string (use multi-line literal string instead)');
    }
    const ch = advance(s);
    len += 1;
    if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
    parts.push(ch);
  }
  return parts.join('');
}

function parseMultilineLiteralString(s: ParserState): string {
  // Already consumed opening ''' — Trap #7: no escape processing
  // Optional immediate newline trimmed
  if (!isEof(s) && peek(s) === '\n') advance(s);
  else if (!isEof(s) && peek(s) === '\r') {
    advance(s);
    if (!isEof(s) && peek(s) === '\n') advance(s);
  }

  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated multi-line literal string');
    const c = peek(s);

    if (c === "'") {
      if (peekAt(s, 1) === "'" && peekAt(s, 2) === "'") {
        advance(s);
        advance(s);
        advance(s);
        // allow up to 2 extra quotes before the closing triple
        let extra = 0;
        while (!isEof(s) && peek(s) === "'" && extra < 2) {
          parts.push("'");
          len += 1;
          advance(s);
          extra += 1;
        }
        break;
      }
    }

    const ch = advance(s);
    len += 1;
    if (len > MAX_TOML_STRING_LEN) throw new TomlStringTooLongError(len, MAX_TOML_STRING_LEN);
    parts.push(ch);
  }
  return parts.join('');
}

function parseEscapeSequence(s: ParserState): string {
  if (isEof(s)) throw errAt(s, 'Unexpected end of file after backslash');
  const esc = advance(s);
  switch (esc) {
    case 'b':
      return '\b';
    case 't':
      return '\t';
    case 'n':
      return '\n';
    case 'f':
      return '\f';
    case 'r':
      return '\r';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case 'u': {
      // \uXXXX — exactly 4 hex digits (Trap #13)
      return parseUnicodeEscape(s, 4);
    }
    case 'U': {
      // \UXXXXXXXX — exactly 8 hex digits (Trap #13)
      return parseUnicodeEscape(s, 8);
    }
    default: {
      const line = s.line;
      const col = s.col - 1;
      throw new TomlBadEscapeError(esc, line, col);
    }
  }
}

function parseUnicodeEscape(s: ParserState, digits: number): string {
  let hex = '';
  for (let i = 0; i < digits; i++) {
    if (isEof(s)) throw errAt(s, `Expected ${digits} hex digits in unicode escape, got ${i}`);
    const c = advance(s);
    if (!/[0-9a-fA-F]/.test(c)) {
      throw errAt(s, `Invalid hex digit '${c}' in unicode escape`);
    }
    hex += c;
  }
  const cp = Number.parseInt(hex, 16);
  // Trap #13: reject surrogates (U+D800..U+DFFF) and > U+10FFFF
  if (cp >= 0xd800 && cp <= 0xdfff) {
    throw errAt(
      s,
      `Unicode escape U+${hex.toUpperCase()} is a surrogate (U+D800..U+DFFF); surrogates are not valid TOML`,
    );
  }
  if (cp > 0x10ffff) {
    throw errAt(s, `Unicode escape U+${hex.toUpperCase()} exceeds U+10FFFF`);
  }
  return String.fromCodePoint(cp);
}

// ---------------------------------------------------------------------------
// Number / date-time parsing
// ---------------------------------------------------------------------------

function isDecDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isHexDigit(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

function isOctDigit(c: string): boolean {
  return c >= '0' && c <= '7';
}

function isBinDigit(c: string): boolean {
  return c === '0' || c === '1';
}

function isBareKeyChar(c: string): boolean {
  return (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '_' ||
    c === '-'
  );
}

/**
 * Parse a raw number / date-time token from the current position.
 * Returns a TomlValue (bigint, number, TomlDate, TomlTime, TomlDateTime).
 */
function parseScalarToken(s: ParserState): TomlValue {
  // Collect raw token (until whitespace, comma, }, ], newline, #, EOF)
  const startPos = s.pos;
  const startLine = s.line;
  const startCol = s.col;

  let raw = '';
  while (!isEof(s)) {
    const c = peek(s);
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\r' ||
      c === '\n' ||
      c === ',' ||
      c === '}' ||
      c === ']' ||
      c === '#'
    )
      break;
    raw += advance(s);
  }
  _ = startPos; // suppress unused warning

  // Trap #11: Date-time with space separator YYYY-MM-DD HH:MM:SS...
  // After collecting YYYY-MM-DD (10 chars), check if next is a space followed by a time part.
  if (raw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !isEof(s) && peek(s) === ' ') {
    // Peek ahead to see if a time component follows the space
    const savedPos = s.pos;
    const savedLine = s.line;
    const savedCol = s.col;
    advance(s); // consume space
    // Collect the rest of the time token
    let timePart = '';
    while (!isEof(s)) {
      const c = peek(s);
      if (
        c === ' ' ||
        c === '\t' ||
        c === '\r' ||
        c === '\n' ||
        c === ',' ||
        c === '}' ||
        c === ']' ||
        c === '#'
      )
        break;
      timePart += advance(s);
    }
    // Check if this looks like a time part (HH:MM:SS...)
    if (/^\d{2}:\d{2}:\d{2}/.test(timePart)) {
      raw = `${raw} ${timePart}`;
    } else {
      // Not a time part — restore position (re-enqueue the space + timePart)
      s.pos = savedPos;
      s.line = savedLine;
      s.col = savedCol;
    }
  }

  return parseRawScalar(raw, startLine, startCol);
}

function parseRawScalar(raw: string, line: number, col: number): TomlValue {
  if (raw === '') {
    throw new TomlParseError('Expected a value', line, col, '');
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Trap #10: inf / nan (signed and unsigned)
  if (raw === 'inf' || raw === '+inf') return Number.POSITIVE_INFINITY;
  if (raw === '-inf') return Number.NEGATIVE_INFINITY;
  if (raw === 'nan' || raw === '+nan' || raw === '-nan') return Number.NaN;

  // Hex/Octal/Binary integer. TOML v1.0 grammar does NOT permit a leading
  // sign on base-prefixed integers; `+0xFF` / `-0xFF` are parse errors.
  // A literal '-' prefix here falls through to parseDecimalInteger which
  // rejects it correctly at the leading-zero check.
  if (raw.startsWith('0x')) return parseIntegerBase(raw, 16, 'hex', line, col);
  if (raw.startsWith('0o')) return parseIntegerBase(raw, 8, 'octal', line, col);
  if (raw.startsWith('0b')) return parseIntegerBase(raw, 2, 'binary', line, col);
  if (
    raw.startsWith('+0x') ||
    raw.startsWith('-0x') ||
    raw.startsWith('+0o') ||
    raw.startsWith('-0o') ||
    raw.startsWith('+0b') ||
    raw.startsWith('-0b')
  ) {
    throw new TomlBadNumberError(
      'base-prefixed integer must not have a leading sign per TOML v1.0',
      raw,
    );
  }

  // Date / time detection: look for date pattern YYYY-MM-DD
  if (/^\d{4}-/.test(raw)) {
    return parseDateOrDateTime(raw, line, col);
  }
  // Local time HH:MM:SS
  if (/^\d{2}:\d{2}:/.test(raw)) {
    return parseLocalTime(raw, line, col);
  }

  // Float: contains '.', 'e', 'E' (but not a date already handled)
  if (raw.includes('.') || raw.includes('e') || raw.includes('E')) {
    return parseFloat_(raw, line, col);
  }

  // Decimal integer
  return parseDecimalInteger(raw, line, col);
}

function parseIntegerBase(
  raw: string,
  base: 2 | 8 | 16,
  name: string,
  line: number,
  col: number,
): bigint {
  let sign = 1n;
  let rest = raw;
  if (rest.startsWith('-')) {
    sign = -1n;
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1);
  }
  // Remove prefix (0x / 0o / 0b)
  rest = rest.slice(2);

  if (rest === '' || rest === '_') {
    throw new TomlBadNumberError(`${name} integer has no digits after prefix`, raw);
  }
  if (rest.startsWith('_') || rest.endsWith('_')) {
    throw new TomlBadNumberError('Leading or trailing underscore', raw);
  }
  if (rest.includes('__')) {
    throw new TomlBadNumberError('Adjacent underscores', raw);
  }

  const digits = rest.replace(/_/g, '');

  const isValidDigit = base === 16 ? isHexDigit : base === 8 ? isOctDigit : isBinDigit;

  for (const ch of digits) {
    if (!isValidDigit(ch)) {
      throw new TomlBadNumberError(`Invalid ${name} digit '${ch}'`, raw);
    }
  }

  _ = line;
  _ = col;

  let val = 0n;
  const bigBase = BigInt(base);
  for (const ch of digits) {
    val = val * bigBase + BigInt(Number.parseInt(ch, base));
  }
  val = sign * val;

  checkInt64Range(val, raw);
  return val;
}

function parseDecimalInteger(raw: string, line: number, col: number): bigint {
  let rest = raw;
  let sign = 1n;

  if (rest.startsWith('-')) {
    sign = -1n;
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1);
  }

  if (rest === '') {
    throw new TomlParseError('Expected digits after sign', line, col, raw);
  }
  if (rest.startsWith('_') || rest.endsWith('_')) {
    throw new TomlBadNumberError('Leading or trailing underscore', raw);
  }
  if (rest.includes('__')) {
    throw new TomlBadNumberError('Adjacent underscores', raw);
  }

  const digits = rest.replace(/_/g, '');

  // Trap #12: leading zero check (single '0' is fine, '01' is not)
  if (digits.length > 1 && digits.startsWith('0')) {
    throw new TomlBadNumberError('Leading zero in decimal integer', raw);
  }

  for (const ch of digits) {
    if (!isDecDigit(ch)) {
      throw new TomlBadNumberError(`Invalid decimal digit '${ch}'`, raw);
    }
  }

  const val = sign * BigInt(digits);
  checkInt64Range(val, raw);
  return val;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function checkInt64Range(val: bigint, raw: string): void {
  if (val < INT64_MIN || val > INT64_MAX) {
    throw new TomlBadNumberError('Value overflows signed 64-bit integer range', raw);
  }
}

function parseFloat_(raw: string, line: number, col: number): number {
  _ = line;
  _ = col;

  let rest = raw;
  let sign = '';

  if (rest.startsWith('-')) {
    sign = '-';
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1);
  }

  if (rest.startsWith('_') || rest.endsWith('_')) {
    throw new TomlBadNumberError('Leading or trailing underscore', raw);
  }
  if (rest.includes('__')) {
    throw new TomlBadNumberError('Adjacent underscores', raw);
  }

  // Split on e/E for exponent
  const [mantissa, exponent] = rest.split(/[eE]/);
  // mantissa and exponent may be undefined but after split on present e/E: mantissa is always defined
  const mantissaStr = (mantissa ?? '').replace(/_/g, '');
  const expStr = exponent !== undefined ? exponent.replace(/_/g, '') : undefined;

  // Validate mantissa
  const dotIdx = mantissaStr.indexOf('.');
  if (dotIdx !== -1) {
    const intPart = mantissaStr.slice(0, dotIdx);
    const fracPart = mantissaStr.slice(dotIdx + 1);
    if (intPart === '' || fracPart === '') {
      throw new TomlBadNumberError('Float must have digits on both sides of decimal point', raw);
    }
    for (const ch of intPart + fracPart) {
      if (!isDecDigit(ch)) {
        throw new TomlBadNumberError(`Invalid float digit '${ch}'`, raw);
      }
    }
  } else {
    for (const ch of mantissaStr) {
      if (!isDecDigit(ch)) {
        throw new TomlBadNumberError(`Invalid float digit '${ch}'`, raw);
      }
    }
  }

  if (expStr !== undefined) {
    const expDigits = expStr.startsWith('+') || expStr.startsWith('-') ? expStr.slice(1) : expStr;
    if (expDigits === '') {
      throw new TomlBadNumberError('Float exponent has no digits', raw);
    }
    for (const ch of expDigits) {
      if (!isDecDigit(ch)) {
        throw new TomlBadNumberError(`Invalid exponent digit '${ch}'`, raw);
      }
    }
  }

  const combined = sign + rest.replace(/_/g, '');
  return Number.parseFloat(combined);
}

// ---------------------------------------------------------------------------
// Date / time parsing
// ---------------------------------------------------------------------------

function parseDateOrDateTime(raw: string, line: number, col: number): TomlDate | TomlDateTime {
  // raw starts with YYYY-MM-DD
  if (raw.length < 10) {
    throw new TomlBadDateError('Too short for a date', raw);
  }
  const year = parseIntPart(raw, 0, 4, raw);
  expectChar(raw, 4, '-', line, col);
  const month = parseIntPart(raw, 5, 7, raw);
  expectChar(raw, 7, '-', line, col);
  const day = parseIntPart(raw, 8, 10, raw);

  validateDate(year, month, day, raw);

  if (raw.length === 10) {
    return { kind: 'date', year, month, day };
  }

  // Trap #11: T or space separator
  const sep = raw[10];
  if (sep !== 'T' && sep !== 't' && sep !== ' ') {
    throw new TomlBadDateError(
      `Expected T or space separator between date and time, got '${sep}'`,
      raw,
    );
  }

  const timePart = raw.slice(11);
  const time = parseTimePart(timePart, raw, line, col);

  return {
    kind: 'datetime',
    year,
    month,
    day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
    fraction: time.fraction,
    offsetMinutes: time.offsetMinutes,
  };
}

interface TimeParsed {
  hour: number;
  minute: number;
  second: number;
  fraction: string | null;
  offsetMinutes: number | null;
}

function parseLocalTime(raw: string, line: number, col: number): TomlTime {
  const t = parseTimePart(raw, raw, line, col);
  if (t.offsetMinutes !== null) {
    throw new TomlBadDateError('Local time cannot have a UTC offset', raw);
  }
  return { kind: 'time', hour: t.hour, minute: t.minute, second: t.second, fraction: t.fraction };
}

function parseTimePart(raw: string, origRaw: string, _line: number, _col: number): TimeParsed {
  if (raw.length < 8) {
    throw new TomlBadDateError('Time part too short', origRaw);
  }
  const hour = parseIntPart(raw, 0, 2, origRaw);
  if (raw[2] !== ':') throw new TomlBadDateError("Expected ':' in time", origRaw);
  const minute = parseIntPart(raw, 3, 5, origRaw);
  if (raw[5] !== ':') throw new TomlBadDateError("Expected ':' in time", origRaw);
  const second = parseIntPart(raw, 6, 8, origRaw);

  if (hour > 23) throw new TomlBadDateError(`Hour ${hour} out of range (0-23)`, origRaw);
  if (minute > 59) throw new TomlBadDateError(`Minute ${minute} out of range (0-59)`, origRaw);
  if (second > 60) throw new TomlBadDateError(`Second ${second} out of range (0-60)`, origRaw);

  let fraction: string | null = null;
  let rest = raw.slice(8);

  if (rest.startsWith('.')) {
    rest = rest.slice(1);
    let frac = '';
    let i = 0;
    while (
      i < rest.length &&
      rest[i] !== undefined &&
      rest[i] !== 'Z' &&
      rest[i] !== '+' &&
      rest[i] !== '-'
    ) {
      const ch = rest[i];
      if (ch === undefined || !isDecDigit(ch)) break;
      frac += ch;
      i++;
    }
    if (frac === '') throw new TomlBadDateError('Empty fractional seconds', origRaw);
    fraction = frac;
    rest = rest.slice(i);
  }

  let offsetMinutes: number | null = null;

  if (rest === 'Z' || rest === 'z') {
    offsetMinutes = 0;
  } else if (rest.startsWith('+') || rest.startsWith('-')) {
    const sign = rest[0] === '-' ? -1 : 1;
    const offPart = rest.slice(1);
    if (offPart.length < 5) throw new TomlBadDateError('Offset too short', origRaw);
    const offHour = parseIntPart(offPart, 0, 2, origRaw);
    if (offPart[2] !== ':') throw new TomlBadDateError("Expected ':' in offset", origRaw);
    const offMin = parseIntPart(offPart, 3, 5, origRaw);
    if (offHour > 23) throw new TomlBadDateError(`Offset hour ${offHour} out of range`, origRaw);
    if (offMin > 59) throw new TomlBadDateError(`Offset minute ${offMin} out of range`, origRaw);
    offsetMinutes = sign * (offHour * 60 + offMin);
  } else if (rest !== '') {
    throw new TomlBadDateError(`Unexpected trailing content '${rest}' after time`, origRaw);
  }
  // null = local date-time (no offset)

  return { hour, minute, second, fraction, offsetMinutes };
}

function parseIntPart(src: string, from: number, to: number, origRaw: string): number {
  const part = src.slice(from, to);
  if (part.length !== to - from) {
    throw new TomlBadDateError(`Expected ${to - from} digits at position ${from}`, origRaw);
  }
  for (const ch of part) {
    if (!isDecDigit(ch)) throw new TomlBadDateError(`Non-digit '${ch}' in date/time`, origRaw);
  }
  return Number.parseInt(part, 10);
}

function expectChar(src: string, pos: number, ch: string, _line: number, _col: number): void {
  if (src[pos] !== ch) {
    throw new TomlBadDateError(`Expected '${ch}' at position ${pos}, got '${src[pos]}'`, src);
  }
}

function validateDate(year: number, month: number, day: number, raw: string): void {
  if (month < 1 || month > 12)
    throw new TomlBadDateError(`Month ${month} out of range (1-12)`, raw);
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay)
    throw new TomlBadDateError(`Day ${day} out of range (1-${maxDay}) for month ${month}`, raw);
}

function daysInMonth(year: number, month: number): number {
  const days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return days[month] ?? 30;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

function parseKey(s: ParserState): string[] {
  const keys: string[] = [];
  keys.push(parseSingleKey(s));
  skipInlineWhitespace(s);
  while (!isEof(s) && peek(s) === '.') {
    advance(s); // consume '.'
    skipInlineWhitespace(s);
    keys.push(parseSingleKey(s));
    skipInlineWhitespace(s);
  }
  return keys;
}

function parseSingleKey(s: ParserState): string {
  if (isEof(s)) throw errAt(s, 'Expected key');
  const c = peek(s);

  if (c === '"') {
    advance(s);
    // Check for multi-line basic (""")
    if (!isEof(s) && peek(s) === '"') {
      advance(s);
      if (!isEof(s) && peek(s) === '"') {
        advance(s);
        throw errAt(s, 'Multi-line basic strings cannot be used as keys');
      }
      return ''; // empty basic string key
    }
    return parseBasicString(s);
  }
  if (c === "'") {
    advance(s);
    // Check for multi-line literal (''')
    if (!isEof(s) && peek(s) === "'") {
      advance(s);
      if (!isEof(s) && peek(s) === "'") {
        advance(s);
        throw errAt(s, 'Multi-line literal strings cannot be used as keys');
      }
      return ''; // empty literal string key
    }
    return parseLiteralString(s);
  }
  if (isBareKeyChar(c)) {
    let key = '';
    while (!isEof(s) && isBareKeyChar(peek(s))) {
      key += advance(s);
    }
    return key;
  }
  throw errAt(s, `Unexpected character '${c}' in key`);
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

function parseValue(s: ParserState, depth: number): TomlValue {
  if (depth > MAX_TOML_DEPTH) {
    throw new TomlDepthExceededError(depth, MAX_TOML_DEPTH);
  }
  skipInlineWhitespace(s);
  if (isEof(s)) throw errAt(s, 'Expected value');

  const c = peek(s);

  // Basic string
  if (c === '"') {
    advance(s);
    // Multi-line basic?
    if (!isEof(s) && peek(s) === '"') {
      advance(s);
      if (!isEof(s) && peek(s) === '"') {
        advance(s);
        return parseMultilineBasicString(s);
      }
      // Empty basic string ""
      return '';
    }
    return parseBasicString(s);
  }

  // Literal string
  if (c === "'") {
    advance(s);
    if (!isEof(s) && peek(s) === "'") {
      advance(s);
      if (!isEof(s) && peek(s) === "'") {
        advance(s);
        return parseMultilineLiteralString(s);
      }
      // Empty literal string ''
      return '';
    }
    return parseLiteralString(s);
  }

  // Array
  if (c === '[') {
    advance(s);
    return parseArray(s, depth + 1);
  }

  // Inline table
  if (c === '{') {
    advance(s);
    return parseInlineTable(s, depth + 1);
  }

  // Scalar (number, bool, date/time, inf, nan)
  return parseScalarToken(s);
}

function parseArray(s: ParserState, depth: number): TomlValue[] {
  if (depth > MAX_TOML_DEPTH) {
    throw new TomlDepthExceededError(depth, MAX_TOML_DEPTH);
  }
  const arr: TomlValue[] = [];

  skipWhitespaceAndNewlines(s);

  while (!isEof(s) && peek(s) !== ']') {
    const val = parseValue(s, depth + 1);
    arr.push(val);
    if (arr.length > MAX_TOML_ARRAY_LEN) {
      throw new TomlDepthExceededError(arr.length, MAX_TOML_ARRAY_LEN);
    }
    skipWhitespaceAndNewlines(s);
    if (!isEof(s) && peek(s) === ',') {
      advance(s); // consume comma
      skipWhitespaceAndNewlines(s);
      // Trailing comma before ] is ALLOWED in arrays (Trap #18)
    }
  }

  if (isEof(s)) throw errAt(s, 'Unterminated array');
  advance(s); // consume ']'
  return arr;
}

function parseInlineTable(s: ParserState, depth: number): { [key: string]: TomlValue } {
  // Trap #8: inline tables are one logical line, no trailing comma
  if (depth > MAX_TOML_DEPTH) {
    throw new TomlDepthExceededError(depth, MAX_TOML_DEPTH);
  }
  const tbl: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
  const meta = getMeta(tbl);
  meta.isInlineTable = true;

  skipInlineWhitespace(s);

  if (!isEof(s) && peek(s) === '}') {
    advance(s);
    return tbl;
  }

  let first = true;
  while (true) {
    if (!first) {
      skipInlineWhitespace(s);
      if (isEof(s)) throw errAt(s, 'Unterminated inline table');
      if (peek(s) === '}') {
        advance(s);
        break;
      }
      if (peek(s) !== ',') throw errAt(s, "Expected ',' or '}' in inline table");
      advance(s); // consume ','
      skipInlineWhitespace(s);
      // Trap #8: trailing comma before } is FORBIDDEN
      if (!isEof(s) && peek(s) === '}') {
        throw errAt(s, 'Trailing comma before } in inline table is forbidden (Trap #8)');
      }
    }
    first = false;

    const keyParts = parseKey(s);
    skipInlineWhitespace(s);
    if (isEof(s) || peek(s) !== '=') throw errAt(s, "Expected '=' after key in inline table");
    advance(s);
    skipInlineWhitespace(s);
    const val = parseValue(s, depth + 1);

    assignDottedKey(tbl, keyParts, val, depth + 1, true);
  }

  meta.closedViaHeader = true; // mark inline table as closed (Trap #8)
  return tbl;
}

// ---------------------------------------------------------------------------
// Dotted-key assignment with conflict detection (Traps #3 #4)
// ---------------------------------------------------------------------------

function assignDottedKey(
  tbl: { [key: string]: TomlValue },
  keyParts: string[],
  val: TomlValue,
  depth: number,
  inlineContext: boolean,
): void {
  if (keyParts.length === 0) throw new TomlParseError('Empty key', 0, 0, '');

  const meta = getMeta(tbl);

  if (keyParts.length === 1) {
    const key = keyParts[0] as string;
    // Final segment: direct assignment
    if (meta.definedDirectly.has(key) || meta.definedByDotted.has(key)) {
      throw new TomlDuplicateKeyError(key);
    }
    if (meta.definedDirectly.size + meta.definedByDotted.size >= MAX_TOML_KEYS_PER_TABLE) {
      throw new TomlDepthExceededError(MAX_TOML_KEYS_PER_TABLE + 1, MAX_TOML_KEYS_PER_TABLE);
    }
    meta.definedDirectly.add(key);
    tbl[key] = val;
    return;
  }

  // Intermediate segment: descend into sub-table
  const key = keyParts[0] as string;
  const rest = keyParts.slice(1);

  if (key in tbl) {
    const existing = tbl[key];
    // existing must be a plain object (not an array, not a primitive)
    if (
      typeof existing !== 'object' ||
      existing === null ||
      Array.isArray(existing) ||
      isTomlDateLike(existing)
    ) {
      throw new TomlConflictingTypeError(key);
    }
    const subTbl = existing as { [key: string]: TomlValue };
    const subMeta = getMeta(subTbl);
    if (subMeta.closedViaHeader && !inlineContext) {
      throw new TomlRedefineTableError(key);
    }
    if (subMeta.isInlineTable) {
      throw new TomlRedefineTableError(key);
    }
    // mark as accessed via dotted key
    meta.definedByDotted.add(key);
    assignDottedKey(subTbl, rest, val, depth + 1, inlineContext);
  } else {
    // Create new intermediate table
    if (depth > MAX_TOML_DEPTH) {
      throw new TomlDepthExceededError(depth, MAX_TOML_DEPTH);
    }
    if (meta.definedDirectly.size + meta.definedByDotted.size >= MAX_TOML_KEYS_PER_TABLE) {
      throw new TomlDepthExceededError(MAX_TOML_KEYS_PER_TABLE + 1, MAX_TOML_KEYS_PER_TABLE);
    }
    meta.definedByDotted.add(key);
    const subTbl: { [key: string]: TomlValue } = Object.create(null) as {
      [key: string]: TomlValue;
    };
    tbl[key] = subTbl;
    assignDottedKey(subTbl, rest, val, depth + 1, inlineContext);
  }
}

function isTomlDateLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return k === 'date' || k === 'time' || k === 'datetime';
}

// ---------------------------------------------------------------------------
// Header navigation for [section] and [[array]]
// ---------------------------------------------------------------------------

/**
 * Navigate to the table indicated by a dotted path for a [header].
 * Creates intermediate tables as needed.
 * Returns the target table.
 */
function navigateToTableHeader(
  root: { [key: string]: TomlValue },
  path: string[],
  _depth: number,
): { [key: string]: TomlValue } {
  let cur = root;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    if (key in cur) {
      const existing = cur[key];
      if (Array.isArray(existing)) {
        // Navigate into the last element of an array-of-tables
        const lastEl = existing[existing.length - 1];
        if (
          typeof lastEl !== 'object' ||
          lastEl === null ||
          Array.isArray(lastEl) ||
          isTomlDateLike(lastEl)
        ) {
          throw new TomlConflictingTypeError(key);
        }
        cur = lastEl as { [key: string]: TomlValue };
      } else if (
        typeof existing === 'object' &&
        existing !== null &&
        !Array.isArray(existing) &&
        !isTomlDateLike(existing)
      ) {
        cur = existing as { [key: string]: TomlValue };
      } else {
        throw new TomlConflictingTypeError(key);
      }
    } else {
      const newTbl: { [key: string]: TomlValue } = Object.create(null) as {
        [key: string]: TomlValue;
      };
      cur[key] = newTbl;
      cur = newTbl;
    }
  }

  return cur;
}

function enterTableHeader(
  root: { [key: string]: TomlValue },
  path: string[],
  depth: number,
): { [key: string]: TomlValue } {
  const parent = navigateToTableHeader(root, path, depth);
  const lastKey = path[path.length - 1] as string;

  if (lastKey in parent) {
    const existing = parent[lastKey];
    if (
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing) &&
      !isTomlDateLike(existing)
    ) {
      const tbl = existing as { [key: string]: TomlValue };
      const meta = getMeta(tbl);
      if (meta.closedViaHeader || meta.isInlineTable) {
        throw new TomlRedefineTableError(path.join('.'));
      }
      // Table was created by a dotted key — now claiming it via header
      meta.closedViaHeader = true;
      return tbl;
    }
    throw new TomlRedefineTableError(path.join('.'));
  }

  const newTbl: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
  const meta = getMeta(newTbl);
  meta.closedViaHeader = true;
  parent[lastKey] = newTbl;
  return newTbl;
}

function enterArrayOfTables(
  root: { [key: string]: TomlValue },
  path: string[],
  depth: number,
): { [key: string]: TomlValue } {
  const parent = navigateToTableHeader(root, path, depth);
  const lastKey = path[path.length - 1] as string;

  if (lastKey in parent) {
    const existing = parent[lastKey];
    if (!Array.isArray(existing)) {
      // Trap #5: [[x]] where x exists as non-array-of-tables
      throw new TomlRedefineTableError(path.join('.'));
    }
    // Check the first element's metadata
    if (existing.length > 0) {
      const firstEl = existing[0];
      if (
        typeof firstEl === 'object' &&
        firstEl !== null &&
        !isTomlDateLike(firstEl) &&
        !Array.isArray(firstEl)
      ) {
        const firstMeta = getMeta(firstEl as { [key: string]: TomlValue });
        if (!firstMeta.isArrayOfTables) {
          throw new TomlRedefineTableError(path.join('.'));
        }
      }
    }
    if (existing.length > MAX_TOML_ARRAY_LEN) {
      throw new TomlDepthExceededError(existing.length, MAX_TOML_ARRAY_LEN);
    }
    const newEl: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
    const elMeta = getMeta(newEl);
    elMeta.isArrayOfTables = true;
    elMeta.closedViaHeader = true;
    existing.push(newEl);
    return newEl;
  }

  const arr: TomlValue[] = [];
  parent[lastKey] = arr;
  const newEl: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
  const elMeta = getMeta(newEl);
  elMeta.isArrayOfTables = true;
  elMeta.closedViaHeader = true;
  arr.push(newEl);
  return newEl;
}

// ---------------------------------------------------------------------------
// Top-level document parser
// ---------------------------------------------------------------------------

function parseDocument(s: ParserState): { [key: string]: TomlValue } {
  const root: { [key: string]: TomlValue } = Object.create(null) as { [key: string]: TomlValue };
  let currentTable = root;

  skipWhitespaceAndNewlines(s);

  while (!isEof(s)) {
    const c = peek(s);

    if (c === '[') {
      advance(s);
      if (!isEof(s) && peek(s) === '[') {
        // [[array of tables]]
        advance(s);
        skipInlineWhitespace(s);
        const path = parseKey(s);
        skipInlineWhitespace(s);
        if (isEof(s) || peek(s) !== ']')
          throw errAt(s, "Expected ']]' to close array-of-tables header");
        advance(s);
        if (isEof(s) || peek(s) !== ']')
          throw errAt(s, "Expected second ']' to close array-of-tables header");
        advance(s);
        skipToEndOfLine(s);
        currentTable = enterArrayOfTables(root, path, 1);
      } else {
        // [table]
        skipInlineWhitespace(s);
        const path = parseKey(s);
        skipInlineWhitespace(s);
        if (isEof(s) || peek(s) !== ']') throw errAt(s, "Expected ']' to close table header");
        advance(s);
        skipToEndOfLine(s);
        currentTable = enterTableHeader(root, path, 1);
      }
    } else if (c === '#') {
      skipComment(s);
    } else if (c === '\r' || c === '\n') {
      advance(s);
    } else if (c === ' ' || c === '\t') {
      skipInlineWhitespace(s);
    } else {
      // Key = value
      const keyParts = parseKey(s);
      skipInlineWhitespace(s);
      if (isEof(s) || peek(s) !== '=') throw errAt(s, "Expected '=' after key");
      advance(s);
      skipInlineWhitespace(s);
      const val = parseValue(s, 1);
      skipToEndOfLine(s);
      assignDottedKey(currentTable, keyParts, val, 1, false);
    }

    skipWhitespaceAndNewlines(s);
  }

  return root;
}

// Dummy variable to suppress "unused" lint errors for line/col params used only for error paths
let _ = 0 as unknown;

// ---------------------------------------------------------------------------
// Public parse API
// ---------------------------------------------------------------------------

/**
 * Parse a TOML v1.0.0 document from bytes or a string.
 *
 * Returns a TomlFile with the parsed value tree and BOM metadata.
 * BOM (if present) is stripped and recorded in hadBom.
 * NEVER re-emitted on serialize (TOML spec forbids BOM).
 */
export function parseToml(input: Uint8Array | string): TomlFile {
  const { text, hadBom } = decodeInput(input, 'TOML', (cause) => new TomlInvalidUtf8Error(cause));

  const s = mkState(text);
  const value = parseDocument(s);
  // Normalize Object.create(null) to a plain object for JSON compatibility
  return { value: normalizeTable(value), hadBom };
}

function normalizeTable(tbl: { [key: string]: TomlValue }): { [key: string]: TomlValue } {
  const result: { [key: string]: TomlValue } = {};
  for (const key of Object.keys(tbl)) {
    const v = tbl[key];
    result[key] = normalizeValue(v as TomlValue);
  }
  return result;
}

function normalizeValue(v: TomlValue): TomlValue {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !isTomlDateLike(v)) {
    return normalizeTable(v as { [key: string]: TomlValue });
  }
  if (Array.isArray(v)) {
    return (v as TomlValue[]).map(normalizeValue);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;

function serializeKey(key: string): string {
  if (BARE_KEY_RE.test(key)) return key;
  return `"${escapeBasicString(key)}"`;
}

function escapeBasicString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) ?? 0;
    const ch = s[i] ?? '';
    if (cp === 0x08) {
      out += '\\b';
      i++;
      continue;
    }
    if (cp === 0x09) {
      out += '\\t';
      i++;
      continue;
    }
    if (cp === 0x0a) {
      out += '\\n';
      i++;
      continue;
    }
    if (cp === 0x0c) {
      out += '\\f';
      i++;
      continue;
    }
    if (cp === 0x0d) {
      out += '\\r';
      i++;
      continue;
    }
    if (cp === 0x22) {
      out += '\\"';
      i++;
      continue;
    }
    if (cp === 0x5c) {
      out += '\\\\';
      i++;
      continue;
    }
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
      out +=
        cp <= 0xffff
          ? `\\u${cp.toString(16).padStart(4, '0')}`
          : `\\U${cp.toString(16).padStart(8, '0')}`;
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    out += ch;
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

function serializeString(v: string): string {
  // Use multi-line basic if string contains newline and is long enough
  if (v.includes('\n') && v.length > 40) {
    return `"""\n${escapeMultilineBasicString(v)}\n"""`;
  }
  return `"${escapeBasicString(v)}"`;
}

/** Escape forbidden control characters for multi-line basic strings.
 *  Multi-line basic allows raw \n, \r\n, \t, and space; everything else in
 *  U+0000..U+001F (except \n, \r, \t), U+007F..U+009F, and \\ / """ must
 *  be escaped per TOML v1.0 spec. */
function escapeMultilineBasicString(v: string): string {
  let out = '';
  let i = 0;
  while (i < v.length) {
    const cp = v.codePointAt(i) ?? 0;
    // Allowed raw: \n (0x0A), \r (0x0D), \t (0x09), and any printable incl. space.
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) {
      out += v[i] ?? '';
      i++;
      continue;
    }
    if (cp === 0x5c) {
      out += '\\\\';
      i++;
      continue;
    }
    // Escape forbidden C0 controls + DEL + C1 controls.
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
      out +=
        cp <= 0xffff
          ? `\\u${cp.toString(16).padStart(4, '0')}`
          : `\\U${cp.toString(16).padStart(8, '0')}`;
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  // Finally, escape literal """ sequences which would prematurely close the
  // multi-line delimiter.
  return out.replace(/"""/g, '""\\"');
}

function serializeScalar(v: TomlValue, keyPath: string): string {
  if (typeof v === 'string') return serializeString(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'nan';
    if (v === Number.POSITIVE_INFINITY) return 'inf';
    if (v === Number.NEGATIVE_INFINITY) return '-inf';
    return JSON.stringify(v);
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    if (isTomlDateLike(v)) {
      return serializeDateOrTime(v as TomlDate | TomlTime | TomlDateTime);
    }
    // Plain table - not a scalar
    throw new TomlSerializeError(`Table value at "${keyPath}" cannot be serialized as a scalar`);
  }
  if (Array.isArray(v)) {
    // Inline array
    return serializeInlineArray(v as TomlValue[], keyPath);
  }
  throw new TomlSerializeError(`Cannot serialize value at "${keyPath}": ${typeof v}`);
}

function serializeInlineArray(arr: TomlValue[], keyPath: string): string {
  if (arr.length === 0) return '[]';
  // Check if all elements are scalars (no nested tables that need section headers)
  const allScalar = arr.every((el) => !isTableValue(el) || isTomlDateLike(el));
  if (allScalar) {
    const items = arr.map((el) => serializeScalar(el, keyPath));
    const inline = `[${items.join(', ')}]`;
    if (inline.length <= 80) return inline;
    // Multi-line array with trailing comma
    return `[\n  ${items.join(',\n  ')},\n]`;
  }
  // Array of tables — this is handled at the document level; here return inline
  const items = arr.map((el) => serializeScalar(el, keyPath));
  return `[${items.join(', ')}]`;
}

function isTableValue(v: TomlValue): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function serializeDateOrTime(v: TomlDate | TomlTime | TomlDateTime): string {
  if (v.kind === 'date') {
    return `${pad(v.year, 4)}-${pad(v.month, 2)}-${pad(v.day, 2)}`;
  }
  if (v.kind === 'time') {
    return serializeTimeFields(v.hour, v.minute, v.second, v.fraction);
  }
  // datetime
  const dt = v as TomlDateTime;
  const datePart = `${pad(dt.year, 4)}-${pad(dt.month, 2)}-${pad(dt.day, 2)}`;
  const timePart = serializeTimeFields(dt.hour, dt.minute, dt.second, dt.fraction);
  const offsetPart = serializeOffset(dt.offsetMinutes);
  return `${datePart}T${timePart}${offsetPart}`;
}

function serializeTimeFields(h: number, m: number, sec: number, frac: string | null): string {
  const base = `${pad(h, 2)}:${pad(m, 2)}:${pad(sec, 2)}`;
  return frac !== null ? `${base}.${frac}` : base;
}

function serializeOffset(offsetMinutes: number | null): string {
  if (offsetMinutes === null) return '';
  if (offsetMinutes === 0) return 'Z';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad(h, 2)}:${pad(m, 2)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

// ---------------------------------------------------------------------------
// Serializer — document-level (sections)
// ---------------------------------------------------------------------------

/**
 * Serialize a TomlFile to canonical TOML string.
 *
 * Key decisions:
 * - BOM NEVER emitted (Trap #6 design note, TOML spec forbids BOM).
 * - Top-level scalars emitted first, then sub-tables as [section] headers.
 * - Array-of-tables entries emitted as [[section]] blocks.
 * - Keys emitted in insertion order within each section.
 * - Bare keys when [A-Za-z0-9_-]+; else basic-quoted.
 */
export function serializeToml(file: TomlFile): string {
  const parts: string[] = [];
  serializeTableBody(file.value, [], parts);
  return parts.join('');
}

function serializeTableBody(
  tbl: { [key: string]: TomlValue },
  path: string[],
  out: string[],
): void {
  // Phase 1: emit scalars (non-table, non-array-of-tables)
  for (const key of Object.keys(tbl)) {
    const val: TomlValue | undefined = tbl[key];
    if (val === undefined) continue;
    if (isTableValue(val) && !isTomlDateLike(val)) continue;
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      val[0] !== undefined &&
      isTableValue(val[0]) &&
      !isTomlDateLike(val[0])
    )
      continue;
    const sk = serializeKey(key);
    out.push(`${sk} = ${serializeScalar(val, [...path, key].join('.'))}\n`);
  }

  // Phase 2: emit sub-tables
  for (const key of Object.keys(tbl)) {
    const val: TomlValue | undefined = tbl[key];
    if (val === undefined) continue;
    if (!isTableValue(val) || isTomlDateLike(val)) continue;
    const subPath = [...path, key];
    out.push(`\n[${subPath.map(serializeKey).join('.')}]\n`);
    serializeTableBody(val as { [key: string]: TomlValue }, subPath, out);
  }

  // Phase 3: emit array-of-tables
  for (const key of Object.keys(tbl)) {
    const val: TomlValue | undefined = tbl[key];
    if (val === undefined) continue;
    if (!Array.isArray(val)) continue;
    const firstEl: TomlValue | undefined = val[0];
    if (
      val.length === 0 ||
      firstEl === undefined ||
      !isTableValue(firstEl) ||
      isTomlDateLike(firstEl)
    )
      continue;
    const subPath = [...path, key];
    for (const el of val as { [key: string]: TomlValue }[]) {
      out.push(`\n[[${subPath.map(serializeKey).join('.')}]]\n`);
      serializeTableBody(el, subPath, out);
    }
  }
}
