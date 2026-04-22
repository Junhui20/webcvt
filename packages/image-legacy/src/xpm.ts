/**
 * XPM3 (X PixMap) parser and serializer for @catlabtech/webcvt-image-legacy.
 *
 * XPM3 is a C source fragment declaring a colour pixmap as a `static char*`
 * array. First string = header (`width height ncolors cpp`), next `ncolors`
 * strings = colour definitions, final `height` strings = pixel rows.
 *
 * Key design constraints:
 *  - Hand-rolled character-walk tokenizer — ZERO regex (ReDoS defense).
 *  - Colour keys may include special chars (space, comma, #, +, .); extracted
 *    by byte offset, not whitespace split (Trap #3).
 *  - cpp=2 means 2-char pixel keys; pixel rows chunked in fixed cpp-byte slices
 *    (Trap #2).
 *  - Visual class `c` only; siblings (m/s/g/g4) skipped; missing c → error
 *    (Trap #11).
 *  - `c None` / `c none` → alpha 0; all others alpha 255 (Trap #6).
 *  - Optional hotspot: 4 tokens = no hotspot; 6 = hotspot; 5 or 7+ → error
 *    (Trap #7).
 *  - Pixel rows must be EXACTLY width*cpp chars (Trap #8).
 *  - ASCII decode in fatal mode (Trap #9).
 *  - C-style `/* *\/` comments skipped anywhere between tokens (Trap #10).
 *  - Minimal string escapes: only `\\` and `\"` (Trap #12).
 *
 * Spec: XPM Manual (Arnaud Le Hors, X Consortium, 1996). Clean-room.
 */

import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  XPM_DEFAULT_NAME,
  XPM_KEY_ALPHABET,
  XPM_MAX_CHARS_PER_PIXEL,
  XPM_MAX_COLORS,
  XPM_MIME,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  XpmBadColorDefError,
  XpmBadHeaderError,
  XpmBadHexColorError,
  XpmBadValuesError,
  XpmDuplicateKeyError,
  XpmSizeMismatchError,
  XpmTooManyColorsError,
  XpmUnknownColorError,
  XpmUnknownKeyError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XpmHotspot {
  readonly x: number;
  readonly y: number;
}

export interface XpmFile {
  readonly format: 'xpm';
  readonly width: number;
  readonly height: number;
  readonly channels: 4;
  readonly bitDepth: 8;
  /** C identifier; default 'image' on serialize */
  readonly name: string;
  readonly hotspot: XpmHotspot | null;
  /** Advisory — serializer picks its own based on palette size */
  readonly charsPerPixel: 1 | 2;
  /** RGBA top-down, length = width*height*4 */
  readonly pixelData: Uint8Array;
}

// ---------------------------------------------------------------------------
// X11 named colour table (~30-entry subset)
// Keys are lowercase; values are [r, g, b].
// Follows X11 rgb.txt mapping, NOT CSS colours (e.g. green = #008000 not #00FF00).
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

const X11_NAMED_COLORS: Readonly<Record<string, RGB>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0], // X11 green = #008000
  lime: [0, 255, 0], // #00FF00
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [190, 190, 190], // X11 gray
  grey: [190, 190, 190],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  silver: [192, 192, 192],
  orange: [255, 165, 0],
  purple: [160, 32, 240], // X11 purple
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  olive: [128, 128, 0],
  maroon: [176, 48, 96], // X11 maroon
  gold: [255, 215, 0],
  transparent: [0, 0, 0], // alias → alpha=0 handled separately
};

// ---------------------------------------------------------------------------
// Character classification helpers (no regex)
// ---------------------------------------------------------------------------

function isIdentStart(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
}

function isIdentCont(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

function isDecDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isHexDigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function isWs(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

// ---------------------------------------------------------------------------
// C identifier validation
// ---------------------------------------------------------------------------

export function isCIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  const first = s.charCodeAt(0);
  if (!isIdentStart(first)) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isIdentCont(s.charCodeAt(i))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hand-rolled tokenizer for XPM's C-fragment dialect
// ---------------------------------------------------------------------------

/**
 * XpmTokenizer: character-walk over the decoded ASCII source string.
 *
 * Supports:
 *  - skipWsAndComments(): skip whitespace + C-style `/* *\/` block comments.
 *    Rejects `//` line comments inside the array scope.
 *  - readIdent(): read a C identifier.
 *  - readDecimal(): read a non-negative decimal integer.
 *  - readStringLiteral(): consume `"...(escape handling)..."`, return content.
 *  - consume(literal): exact match or throw.
 *  - peek(): character at current pos.
 *
 * Zero regex anywhere — O(n) walk only.
 */
class XpmTokenizer {
  readonly src: string;
  pos: number;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
  }

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(): string {
    return this.pos < this.src.length ? (this.src[this.pos] ?? '') : '';
  }

  peekCode(): number {
    return this.pos < this.src.length ? (this.src.charCodeAt(this.pos) ?? 0) : 0;
  }

  /** Skip whitespace and C-style `/* *\/` block comments. */
  skipWsAndComments(): void {
    const { src } = this;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      if (isWs(c)) {
        this.pos++;
        continue;
      }
      // Block comment: /* ... */
      if (c === 0x2f && this.pos + 1 < src.length && src.charCodeAt(this.pos + 1) === 0x2a) {
        this.pos += 2;
        while (this.pos < src.length) {
          if (
            src.charCodeAt(this.pos) === 0x2a &&
            this.pos + 1 < src.length &&
            src.charCodeAt(this.pos + 1) === 0x2f
          ) {
            this.pos += 2;
            break;
          }
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  consume(literal: string): void {
    const { src, pos } = this;
    for (let i = 0; i < literal.length; i++) {
      if (pos + i >= src.length || src[pos + i] !== literal[i]) {
        throw new XpmBadHeaderError(
          `expected "${literal}" at position ${pos}, got "${src.slice(pos, pos + literal.length)}"`,
        );
      }
    }
    this.pos += literal.length;
  }

  readIdent(): string {
    const { src } = this;
    const start = this.pos;
    if (this.pos >= src.length) {
      throw new XpmBadHeaderError(`expected identifier at position ${this.pos}, got end-of-input`);
    }
    const first = src.charCodeAt(this.pos);
    if (!isIdentStart(first)) {
      throw new XpmBadHeaderError(
        `expected identifier at position ${this.pos}, got "${src[this.pos]}"`,
      );
    }
    this.pos++;
    while (this.pos < src.length && isIdentCont(src.charCodeAt(this.pos))) {
      this.pos++;
    }
    return src.slice(start, this.pos);
  }

  readDecimal(): number {
    const { src } = this;
    const start = this.pos;
    if (this.pos >= src.length || !isDecDigit(src.charCodeAt(this.pos))) {
      throw new XpmBadHeaderError(
        `expected decimal at position ${this.pos}, got "${src[this.pos] ?? 'end-of-input'}"`,
      );
    }
    while (this.pos < src.length && isDecDigit(src.charCodeAt(this.pos))) {
      this.pos++;
    }
    return Number.parseInt(src.slice(start, this.pos), 10);
  }

  /**
   * Read a double-quoted string literal from the current position.
   * Handles only `\\` and `\"` escapes (spec-minimal).
   * Returns the raw string content (escape sequences decoded).
   * Throws XpmBadHeaderError on malformed input.
   */
  readStringLiteral(): string {
    const { src } = this;
    if (this.pos >= src.length || src.charCodeAt(this.pos) !== 0x22) {
      throw new XpmBadHeaderError(
        `expected '"' at position ${this.pos}, got "${src[this.pos] ?? 'end-of-input'}"`,
      );
    }
    this.pos++; // skip opening "
    const chars: string[] = [];
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      if (c === 0x22) {
        // closing "
        this.pos++;
        return chars.join('');
      }
      if (c === 0x5c) {
        // backslash
        this.pos++;
        if (this.pos >= src.length) {
          throw new XpmBadHeaderError('unexpected end-of-input inside string escape');
        }
        const esc = src.charCodeAt(this.pos);
        if (esc === 0x5c) {
          chars.push('\\');
        } else if (esc === 0x22) {
          chars.push('"');
        } else {
          throw new XpmBadHeaderError(
            `unsupported string escape '\\${src[this.pos]}' at position ${this.pos}`,
          );
        }
        this.pos++;
        continue;
      }
      chars.push(src[this.pos] ?? '');
      this.pos++;
    }
    throw new XpmBadHeaderError('unterminated string literal');
  }
}

// ---------------------------------------------------------------------------
// Colour value parser
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];

function parseHexNibble(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1; // invalid
}

function parseTwoByte(hex: string, offset: number): number {
  const hi = parseHexNibble(hex[offset] ?? '');
  const lo = parseHexNibble(hex[offset + 1] ?? '');
  if (hi < 0 || lo < 0) return -1;
  return (hi << 4) | lo;
}

/**
 * Parse a colour value token into RGBA.
 * Handles: None/none/transparent, #RGB, #RRGGBB, #RRRRGGGGBBBB, named colours.
 */
function parseColorValue(raw: string): RGBA {
  const lower = raw.toLowerCase();

  // None / transparent → alpha 0 (Trap #6)
  if (lower === 'none' || lower === 'transparent') {
    return [0, 0, 0, 0];
  }

  if (raw.startsWith('#')) {
    const hex = raw.slice(1);

    if (hex.length === 3) {
      // #RGB → nibble-doubled (Trap #5)
      const r = parseHexNibble(hex[0] ?? '');
      const g = parseHexNibble(hex[1] ?? '');
      const b = parseHexNibble(hex[2] ?? '');
      if (r < 0 || g < 0 || b < 0) throw new XpmBadHexColorError(raw);
      return [(r << 4) | r, (g << 4) | g, (b << 4) | b, 255];
    }

    if (hex.length === 6) {
      const r = parseTwoByte(hex, 0);
      const g = parseTwoByte(hex, 2);
      const b = parseTwoByte(hex, 4);
      if (r < 0 || g < 0 || b < 0) throw new XpmBadHexColorError(raw);
      return [r, g, b, 255];
    }

    if (hex.length === 12) {
      // #RRRRGGGGBBBB → narrow to high byte of each 16-bit channel (Trap #5)
      const r = parseTwoByte(hex, 0);
      const g = parseTwoByte(hex, 4);
      const b = parseTwoByte(hex, 8);
      if (r < 0 || g < 0 || b < 0) throw new XpmBadHexColorError(raw);
      return [r, g, b, 255];
    }

    throw new XpmBadHexColorError(raw);
  }

  // Named colour
  const named = X11_NAMED_COLORS[lower];
  if (named === undefined) throw new XpmUnknownColorError(raw);

  // 'transparent' was handled above; re-check 'none' alias in named table
  if (lower === 'none' || lower === 'transparent') return [0, 0, 0, 0];
  return [named[0], named[1], named[2], 255];
}

// ---------------------------------------------------------------------------
// Colour definition parser (Trap #3: byte-offset key extraction)
// ---------------------------------------------------------------------------

/**
 * Parse a colour definition string (content already extracted from quotes).
 * First `cpp` bytes = key (verbatim, may include space/comma/#).
 * Byte at offset `cpp` must be whitespace.
 * Remainder is tokenized to find first `c <value>` pair; siblings skipped.
 * Returns [key, rgba].
 */
function parseColorDef(content: string, cpp: number): [string, RGBA] {
  if (content.length < cpp) {
    throw new XpmBadColorDefError(`colour def too short for cpp=${cpp}: "${content}"`);
  }

  // Key is EXACTLY the first cpp bytes (Trap #3)
  const key = content.slice(0, cpp);

  // Byte immediately after key must be whitespace (Trap #3)
  if (content.length <= cpp) {
    throw new XpmBadColorDefError(`no colour class after key "${key}"`);
  }
  const sep = content.charCodeAt(cpp);
  if (!isWs(sep)) {
    throw new XpmBadColorDefError(`expected whitespace after key "${key}", got char code ${sep}`);
  }

  // Tokenize remainder after key — find first `c <value>` pair (Trap #11)
  const rest = content.slice(cpp + 1);

  // Simple token-walk: split on whitespace, find 'c' visual class token
  // We look for sequences: <visual-class> <value>
  // Known visual classes: c, m, s, g, g4
  const tokens = tokenizeWords(rest);

  let foundColor: RGBA | null = null;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (tok === 'c') {
      const val = tokens[i + 1];
      if (val === undefined) {
        throw new XpmBadColorDefError(`"c" visual class has no value for key "${key}"`);
      }
      foundColor = parseColorValue(val);
      break; // use first c pair; skip siblings
    }
    // Skip known sibling visual classes (m, s, g, g4) and their values
    if (tok === 'm' || tok === 's' || tok === 'g' || tok === 'g4') {
      i += 2; // skip class + value
      continue;
    }
    i++;
  }

  if (foundColor === null) {
    throw new XpmBadColorDefError(`no "c" visual class found for key "${key}" (Trap #11)`);
  }

  return [key, foundColor];
}

/**
 * Split a string on ASCII whitespace, returning non-empty tokens.
 * Hand-rolled — no split() regex (though split on fixed string is fine,
 * we use the character walk to be consistent).
 */
function tokenizeWords(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    // skip whitespace
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !isWs(s.charCodeAt(i))) i++;
    tokens.push(s.slice(start, i));
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// XPM detection helper (used by detect.ts)
// ---------------------------------------------------------------------------

/**
 * Look-ahead validation for XPM detection.
 * Bounded to ~1024 bytes to prevent O(N) scanning on non-XPM inputs.
 *
 * Returns true if, after skipping leading whitespace + one optional
 * `/* *\/` comment, the bytes match `/* XPM *\/` or contain
 * `static [const] char *<ident>[] = {` within the look-ahead window.
 */
export function isXpmHeader(input: Uint8Array): boolean {
  const slice = input.subarray(0, Math.min(input.length, 1024));

  let src: string;
  try {
    src = new TextDecoder('ascii', { fatal: true }).decode(slice);
  } catch {
    return false;
  }

  const tok = new XpmTokenizer(src);
  try {
    tok.skipWsAndComments();
    if (tok.done) return false;

    // Check for /* XPM */ comment
    if (tok.pos + 7 <= src.length && src.slice(tok.pos, tok.pos + 7) === '/* XPM ') {
      return true;
    }
    // Also match exact /* XPM */
    if (tok.pos + 9 <= src.length && src.slice(tok.pos, tok.pos + 9) === '/* XPM */') {
      return true;
    }

    // Check for static char * shape
    if (tok.pos + 6 <= src.length && src.slice(tok.pos, tok.pos + 6) === 'static') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an XPM3 file from raw bytes.
 *
 * Allocation order (from design note §"Security caps"):
 * 1. Validate input size
 * 2. ASCII decode (fatal)
 * 3. Scan to `static char *<name>[] = {`; capture name
 * 4. Read first string literal; parse header tokens
 * 5. Validate dimensions + caps
 * 6. Allocate colour Map
 * 7. Read ncolors colour-def strings; populate map
 * 8. ONLY THEN allocate pixelData
 * 9. Read height pixel strings; chunk; lookup; write RGBA
 */
export function parseXpm(input: Uint8Array): XpmFile {
  // Step 1: input size
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // Step 2: ASCII decode — fatal rejects non-ASCII bytes (Trap #9)
  let src: string;
  try {
    src = new TextDecoder('ascii', { fatal: true }).decode(input);
  } catch {
    throw new XpmBadHeaderError('input contains non-ASCII bytes');
  }

  const tok = new XpmTokenizer(src);

  // Step 3: Scan to `/* XPM */` magic comment, then to `static char *<name>[] = {`
  tok.skipWsAndComments();

  // After skipWsAndComments, we should be at `static`
  // (The /* XPM */ comment was consumed by skipWsAndComments)
  // But we need to also handle the case where /* XPM */ is the FIRST token
  // that hasn't been consumed. Let's re-check: skipWsAndComments skips /* */
  // comments, so after calling it the /* XPM */ header comment is gone.
  // Now read `static`
  if (tok.done) {
    throw new XpmBadHeaderError('unexpected end-of-input — missing static char* array');
  }

  // Parse `static char * <name>_xpm[] = {`
  let kw: string;
  try {
    kw = tok.readIdent();
  } catch {
    throw new XpmBadHeaderError('expected "static" keyword');
  }
  if (kw !== 'static') {
    throw new XpmBadHeaderError(`expected "static", got "${kw}"`);
  }

  tok.skipWsAndComments();

  // Optional `const`
  let next = tok.readIdent();
  if (next === 'const') {
    tok.skipWsAndComments();
    next = tok.readIdent();
  }

  // Must be `char`
  if (next !== 'char') {
    throw new XpmBadHeaderError(`expected "char" after "static", got "${next}"`);
  }

  tok.skipWsAndComments();

  // Consume `*`
  if (tok.peek() !== '*') {
    throw new XpmBadHeaderError(`expected '*' after "char", got "${tok.peek()}"`);
  }
  tok.pos++;

  tok.skipWsAndComments();

  // Read array name (e.g. `name_xpm`)
  let arrayName: string;
  try {
    arrayName = tok.readIdent();
  } catch {
    throw new XpmBadHeaderError('expected array name identifier');
  }

  // Strip trailing _xpm suffix if present; otherwise use as-is
  const name = arrayName.endsWith('_xpm') ? arrayName.slice(0, arrayName.length - 4) : arrayName;

  tok.skipWsAndComments();
  tok.consume('[');
  tok.skipWsAndComments();
  tok.consume(']');
  tok.skipWsAndComments();
  tok.consume('=');
  tok.skipWsAndComments();
  tok.consume('{');

  // Step 4: Read first string literal (header)
  tok.skipWsAndComments();
  const headerStr = tok.readStringLiteral();

  // Parse header: 4 or 6 decimal tokens
  const headerTokens = tokenizeWords(headerStr);
  if (headerTokens.length !== 4 && headerTokens.length !== 6) {
    throw new XpmBadValuesError(
      `header must have 4 or 6 tokens, got ${headerTokens.length}: "${headerStr}"`,
    );
  }

  const width = parseDecToken(headerTokens[0], 'width');
  const height = parseDecToken(headerTokens[1], 'height');
  const ncolors = parseDecToken(headerTokens[2], 'ncolors');
  const cppRaw = parseDecToken(headerTokens[3], 'chars_per_pixel');

  // Hotspot (Trap #7): only if 6 tokens
  let hotspot: XpmHotspot | null = null;
  if (headerTokens.length === 6) {
    const hx = parseDecToken(headerTokens[4], 'hotspot_x');
    const hy = parseDecToken(headerTokens[5], 'hotspot_y');
    hotspot = { x: hx, y: hy };
  }

  // Step 5: Validate dimensions + caps
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `XPM: dimensions ${width}×${height} exceed limits (max ${MAX_DIM} per axis).`,
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `XPM: pixel count ${width * height} exceeds maximum ${MAX_PIXELS}.`,
    );
  }
  if (ncolors < 1 || ncolors > XPM_MAX_COLORS) {
    throw new XpmBadValuesError(`ncolors ${ncolors} is out of range [1, ${XPM_MAX_COLORS}].`);
  }
  if (cppRaw < 1 || cppRaw > XPM_MAX_CHARS_PER_PIXEL) {
    throw new XpmBadValuesError(`chars_per_pixel ${cppRaw} is not in {1, 2}.`);
  }
  const cpp = cppRaw as 1 | 2;

  // Step 6: Allocate colour map
  const colorMap = new Map<string, RGBA>();

  // Step 7: Read ncolors colour-def strings
  for (let i = 0; i < ncolors; i++) {
    tok.skipWsAndComments();
    // Expect comma separator between strings (after header)
    if (tok.peek() === ',') {
      tok.pos++;
      tok.skipWsAndComments();
    }

    const defStr = tok.readStringLiteral();
    const [key, rgba] = parseColorDef(defStr, cpp);

    if (colorMap.has(key)) {
      throw new XpmDuplicateKeyError(key);
    }
    colorMap.set(key, rgba);
  }

  // Step 8: Allocate pixelData ONLY after colour map is complete
  const pixelData = new Uint8Array(width * height * 4);

  // Step 9: Read height pixel strings
  for (let row = 0; row < height; row++) {
    tok.skipWsAndComments();
    if (tok.peek() === ',') {
      tok.pos++;
      tok.skipWsAndComments();
    }

    const rowStr = tok.readStringLiteral();

    // Validate row length (Trap #8)
    if (rowStr.length !== width * cpp) {
      throw new XpmSizeMismatchError(
        `pixel row ${row} has length ${rowStr.length}, expected ${width * cpp} (width=${width}, cpp=${cpp}).`,
      );
    }

    // Chunk into cpp-byte keys; lookup; write RGBA
    const baseOut = row * width * 4;
    for (let col = 0; col < width; col++) {
      const keyStart = col * cpp;
      const key = rowStr.slice(keyStart, keyStart + cpp);
      const rgba = colorMap.get(key);
      if (rgba === undefined) {
        throw new XpmUnknownKeyError(key);
      }
      const outOffset = baseOut + col * 4;
      pixelData[outOffset] = rgba[0];
      pixelData[outOffset + 1] = rgba[1];
      pixelData[outOffset + 2] = rgba[2];
      pixelData[outOffset + 3] = rgba[3];
    }
  }

  // Consume closing `};` (trailing bytes tolerated)
  tok.skipWsAndComments();
  if (tok.peek() === ',') tok.pos++; // trailing comma before }
  tok.skipWsAndComments();
  if (!tok.done && tok.peek() === '}') {
    tok.pos++;
    tok.skipWsAndComments();
    if (!tok.done && tok.peek() === ';') tok.pos++;
  }

  return {
    format: 'xpm',
    width,
    height,
    channels: 4,
    bitDepth: 8,
    name: name.length > 0 ? name : XPM_DEFAULT_NAME,
    hotspot,
    charsPerPixel: cpp,
    pixelData,
  };
}

function parseDecToken(tok: string | undefined, field: string): number {
  if (tok === undefined) {
    throw new XpmBadValuesError(`missing "${field}" token in header`);
  }
  for (let i = 0; i < tok.length; i++) {
    if (!isDecDigit(tok.charCodeAt(i))) {
      throw new XpmBadValuesError(`"${field}" token "${tok}" is not a decimal integer`);
    }
  }
  return Number.parseInt(tok, 10);
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an XpmFile to canonical XPM3 source bytes.
 *
 * Canonical form:
 *   /* XPM *\/
 *   static char * <name>_xpm[] = {
 *   "<W> <H> <N> <cpp>[ <xh> <yh>]",
 *   "<k0> c <#RRGGBB|None>",
 *   ...
 *   "<pixel row 0>",
 *   ...
 *   "<pixel row H-1>"
 *   };
 *
 * Always emits 6-digit #RRGGBB hex (no shorthand); `None` for alpha=0.
 * Auto-picks cpp: 1 for ≤92 unique colours, else 2.
 */
export function serializeXpm(file: XpmFile): Uint8Array {
  const { width, height, pixelData } = file;
  const nm = file.name.length > 0 ? file.name : XPM_DEFAULT_NAME;

  // Validate name is a C identifier
  if (!isCIdentifier(nm)) {
    throw new XpmBadHeaderError(`name "${nm}" is not a valid C identifier`);
  }

  // Validate dimensions
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `XPM: dimensions ${width}×${height} exceed limits (max ${MAX_DIM} per axis).`,
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `XPM: pixel count ${width * height} exceeds maximum ${MAX_PIXELS}.`,
    );
  }

  // Build unique-colour map: packed RGBA uint32 → first-encountered index
  // Using a Map keyed by a string representation for correctness
  type ColorKey = string; // `r,g,b,a`
  const colorOrder: ColorKey[] = [];
  const colorIndexMap = new Map<ColorKey, number>();

  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const r = pixelData[off] ?? 0;
    const g = pixelData[off + 1] ?? 0;
    const b = pixelData[off + 2] ?? 0;
    const a = pixelData[off + 3] ?? 0;
    const ck: ColorKey = `${r},${g},${b},${a}`;
    if (!colorIndexMap.has(ck)) {
      colorIndexMap.set(ck, colorOrder.length);
      colorOrder.push(ck);
    }
  }

  const ncolors = colorOrder.length;
  if (ncolors > XPM_MAX_COLORS) {
    throw new XpmTooManyColorsError(ncolors, XPM_MAX_COLORS);
  }

  // Pick cpp: 1 for ≤92 unique colours (fits single-char keys), else 2.
  // The first 92 chars of XPM_KEY_ALPHABET are used for cpp=1 keys.
  const cpp: 1 | 2 = ncolors <= 92 ? 1 : 2;

  // Assign keys from XPM_KEY_ALPHABET in first-encountered order
  const colorKeys: string[] = [];
  if (cpp === 1) {
    for (let i = 0; i < ncolors; i++) {
      colorKeys.push(XPM_KEY_ALPHABET[i] ?? ' ');
    }
  } else {
    // cpp=2: generate 2-char keys from alphabet
    const alpha = XPM_KEY_ALPHABET;
    const alphaLen = alpha.length;
    for (let i = 0; i < ncolors; i++) {
      const hi = Math.floor(i / alphaLen);
      const lo = i % alphaLen;
      colorKeys.push((alpha[hi] ?? ' ') + (alpha[lo] ?? ' '));
    }
  }

  // Build colour def strings and collect xpm key → string mapping
  const colorDefLines: string[] = [];
  const colorKeyByIndex: string[] = colorKeys;
  for (let i = 0; i < ncolors; i++) {
    const ck = colorOrder[i] ?? '0,0,0,255';
    const parts = ck.split(',');
    const r = Number.parseInt(parts[0] ?? '0', 10);
    const g = Number.parseInt(parts[1] ?? '0', 10);
    const b = Number.parseInt(parts[2] ?? '0', 10);
    const a = Number.parseInt(parts[3] ?? '255', 10);
    const keyStr = colorKeyByIndex[i] ?? ' ';
    const colorSpec = a === 0 ? 'None' : `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    colorDefLines.push(`"${keyStr} c ${colorSpec}"`);
  }

  // Build pixel rows
  const pixelRowLines: string[] = [];
  for (let row = 0; row < height; row++) {
    let rowStr = '';
    for (let col = 0; col < width; col++) {
      const off = (row * width + col) * 4;
      const r = pixelData[off] ?? 0;
      const g = pixelData[off + 1] ?? 0;
      const b = pixelData[off + 2] ?? 0;
      const a = pixelData[off + 3] ?? 0;
      const ck: ColorKey = `${r},${g},${b},${a}`;
      const idx = colorIndexMap.get(ck) ?? 0;
      rowStr += colorKeyByIndex[idx] ?? ' ';
    }
    pixelRowLines.push(`"${rowStr}"`);
  }

  // Assemble canonical output
  const hotspotSuffix = file.hotspot !== null ? ` ${file.hotspot.x} ${file.hotspot.y}` : '';
  const headerLine = `"${width} ${height} ${ncolors} ${cpp}${hotspotSuffix}"`;

  const allStringLines = [headerLine, ...colorDefLines, ...pixelRowLines];

  const lines: string[] = [];
  lines.push('/* XPM */');
  lines.push(`static char * ${nm}_xpm[] = {`);
  for (let i = 0; i < allStringLines.length; i++) {
    const isLast = i === allStringLines.length - 1;
    lines.push(isLast ? (allStringLines[i] ?? '') : `${allStringLines[i] ?? ''},`);
  }
  lines.push('};');

  const text = `${lines.join('\n')}\n`;
  return new TextEncoder().encode(text);
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

// Re-export MIME for external use
export { XPM_MIME };
