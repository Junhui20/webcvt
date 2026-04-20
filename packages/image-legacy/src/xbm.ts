/**
 * XBM (X11 Bitmap) parser and serializer for @webcvt/image-legacy.
 *
 * XBM files are fragments of valid C source code: two `#define` lines
 * (width + height), optional `_x_hot`/`_y_hot` hotspot defines, and a
 * `static [unsigned] char <prefix>_bits[]` array of hex bytes.
 *
 * Key design constraints:
 *  - Bit packing is LSB-first within each byte (OPPOSITE of PBM P4 MSB-first).
 *  - Row stride = ceil(width / 8) bytes; trailing pad bits ignored on read.
 *  - Tokenizer is a hand-rolled character walk — NO REGEX (ReDoS defense).
 *  - Identifier prefix must be consistent across all defines and the array.
 *  - Hotspot defines (_x_hot / _y_hot) are both-or-neither (XOR → error).
 *  - Trailing comma before `}` is valid C99 — accepted; serializer omits it.
 *
 * Spec: X Consortium X11 R6 XReadBitmapFile(3) / XWriteBitmapFile(3) + C99 §6.4.4.1.
 * Clean-room: no code from ImageMagick, GIMP, libXpm, Netpbm, or stb_image.
 */

import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  XBM_BYTES_PER_LINE,
  XBM_DEFAULT_PREFIX,
  XBM_MAX_IDENTIFIER_LENGTH,
  XBM_MIME,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  XbmBadHeaderError,
  XbmBadHexByteError,
  XbmBadIdentifierError,
  XbmMissingDefineError,
  XbmPrefixMismatchError,
  XbmSizeMismatchError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XbmHotspot {
  readonly x: number;
  readonly y: number;
}

export interface XbmFile {
  readonly format: 'xbm';
  readonly width: number;
  readonly height: number;
  readonly channels: 1;
  readonly bitDepth: 1;
  /** Identifier prefix extracted from the source; preserved on round-trip. */
  readonly prefix: string;
  readonly hotspot: XbmHotspot | null;
  /**
   * One byte per pixel (0 or 1), row-major top-down.
   * Length = width × height.
   */
  readonly pixelData: Uint8Array;
}

// ---------------------------------------------------------------------------
// Internal tokenizer state
// ---------------------------------------------------------------------------

/**
 * Hand-rolled character-walk tokenizer for XBM's C-fragment dialect.
 *
 * The XBM dialect consists of:
 *  - Whitespace: space (0x20), tab (0x09), CR (0x0D), LF (0x0A)
 *  - Block comments: `/ * ... * /` (no nesting)
 *  - C preprocessor directives: `#define <ident> <decimal>`
 *  - C declarations: `static [unsigned] char <ident>[] = { ... };`
 *  - Hex literals: `0x[0-9a-fA-F]{1,2}`
 *  - Punctuation: `{`, `}`, `=`, `;`, `,`
 *
 * Design: all methods operate on `this.src` (the decoded ASCII string) and
 * advance `this.pos`. No regex is used anywhere — this is critical for
 * ReDoS defense against pathological whitespace in 200 MiB inputs.
 */
class XbmTokenizer {
  readonly src: string;
  pos: number;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
  }

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  /** Skip ASCII whitespace characters (space, tab, CR, LF). */
  skipWs(): void {
    const { src } = this;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      // 0x20=space 0x09=tab 0x0A=LF 0x0D=CR
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        this.pos++;
      } else if (c === 0x2f && src.charCodeAt(this.pos + 1) === 0x2a) {
        // Block comment: /* ... */
        this.pos += 2;
        while (this.pos < src.length) {
          if (src.charCodeAt(this.pos) === 0x2a && src.charCodeAt(this.pos + 1) === 0x2f) {
            this.pos += 2;
            break;
          }
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  /** Peek at the current character without advancing. Returns '' at end. */
  peek(): string {
    return this.pos < this.src.length ? (this.src[this.pos] ?? '') : '';
  }

  /**
   * Consume an exact literal string from the current position.
   * Throws XbmBadHeaderError if the literal does not match.
   */
  consume(literal: string): void {
    const { src, pos } = this;
    for (let i = 0; i < literal.length; i++) {
      if (pos + i >= src.length || src[pos + i] !== literal[i]) {
        throw new XbmBadHeaderError(
          `expected "${literal}" at position ${pos}, got "${src.slice(pos, pos + literal.length)}"`,
        );
      }
    }
    this.pos += literal.length;
  }

  /**
   * Read a C identifier (alphanumeric + underscore, not starting with a digit).
   * Returns the identifier string or throws XbmBadHeaderError if nothing valid.
   */
  readIdent(): string {
    const { src } = this;
    const start = this.pos;
    if (this.pos >= src.length) {
      throw new XbmBadHeaderError(`expected identifier at position ${this.pos}, got end-of-input`);
    }
    const first = src.charCodeAt(this.pos);
    // Must start with letter or underscore
    if (!isIdentStart(first)) {
      throw new XbmBadHeaderError(
        `expected identifier at position ${this.pos}, got "${src[this.pos]}"`,
      );
    }
    this.pos++;
    while (this.pos < src.length && isIdentCont(src.charCodeAt(this.pos))) {
      this.pos++;
    }
    return src.slice(start, this.pos);
  }

  /**
   * Read a decimal non-negative integer literal.
   * Returns the number or throws XbmBadHeaderError if nothing valid.
   */
  readDecimal(): number {
    const { src } = this;
    const start = this.pos;
    if (this.pos >= src.length) {
      throw new XbmBadHeaderError(`expected decimal at position ${this.pos}, got end-of-input`);
    }
    if (!isDecDigit(src.charCodeAt(this.pos))) {
      throw new XbmBadHeaderError(
        `expected decimal digit at position ${this.pos}, got "${src[this.pos]}"`,
      );
    }
    while (this.pos < src.length && isDecDigit(src.charCodeAt(this.pos))) {
      this.pos++;
    }
    return Number.parseInt(src.slice(start, this.pos), 10);
  }

  /**
   * Read a hex byte literal of the form `0x[0-9a-fA-F]{1,2}`.
   * Returns the byte value (0..255) or throws XbmBadHexByteError.
   * The `0x`/`0X` prefix is consumed; accepts 1 or 2 hex digits.
   */
  readHexByte(): number {
    const { src } = this;
    const start = this.pos;

    // Must be "0x" or "0X"
    if (
      this.pos + 1 >= src.length ||
      src.charCodeAt(this.pos) !== 0x30 ||
      (src.charCodeAt(this.pos + 1) !== 0x78 && src.charCodeAt(this.pos + 1) !== 0x58)
    ) {
      const token = src.slice(start, Math.min(start + 8, src.length));
      throw new XbmBadHexByteError(token === '' ? '(end-of-input)' : token);
    }
    this.pos += 2;

    const hexStart = this.pos;
    while (this.pos < src.length && isHexDigit(src.charCodeAt(this.pos))) {
      this.pos++;
    }
    const hexLen = this.pos - hexStart;

    if (hexLen === 0 || hexLen > 2) {
      throw new XbmBadHexByteError(src.slice(start, this.pos));
    }

    const value = Number.parseInt(src.slice(hexStart, this.pos), 16);
    if (value > 0xff) {
      throw new XbmBadHexByteError(src.slice(start, this.pos));
    }
    return value;
  }
}

// ---------------------------------------------------------------------------
// Character classification helpers (no regex — plain integer comparisons)
// ---------------------------------------------------------------------------

function isIdentStart(c: number): boolean {
  // A-Z, a-z, _
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
}

function isIdentCont(c: number): boolean {
  // A-Z, a-z, 0-9, _
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

function isDecDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isHexDigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

// ---------------------------------------------------------------------------
// Prefix validation
// ---------------------------------------------------------------------------

function validatePrefix(prefix: string): void {
  if (prefix.length === 0) {
    throw new XbmBadIdentifierError('prefix is empty');
  }
  if (prefix.length > XBM_MAX_IDENTIFIER_LENGTH) {
    throw new XbmBadIdentifierError(
      `prefix "${prefix.slice(0, 32)}..." exceeds maximum length ${XBM_MAX_IDENTIFIER_LENGTH}`,
    );
  }
  // Prefix must be a valid C identifier fragment: start with letter/underscore,
  // continue with alnum/underscore.
  const first = prefix.charCodeAt(0);
  if (!isIdentStart(first)) {
    throw new XbmBadIdentifierError(`prefix "${prefix}" starts with invalid character`);
  }
  for (let i = 1; i < prefix.length; i++) {
    if (!isIdentCont(prefix.charCodeAt(i))) {
      throw new XbmBadIdentifierError(
        `prefix "${prefix}" contains invalid character at index ${i}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an XBM file from raw bytes.
 *
 * Algorithm (from design note §"Parser algorithm"):
 * 1. Validate input size.
 * 2. Decode to ASCII (fatal mode).
 * 3. Parse `#define <prefix>_width <decimal>`.
 * 4. Parse `#define <prefix>_height <decimal>`.
 * 5. Parse optional `_x_hot`/`_y_hot` hotspot defines (both-or-neither).
 * 6. Parse `static [unsigned] char <prefix>_bits[<opt>] = {`.
 * 7. Validate dimensions vs caps.
 * 8. Allocate pixelData + packed buffer.
 * 9. Read hex bytes; validate count; consume `};`.
 * 10. Unpack packed bits LSB-first into pixelData.
 * 11. Return XbmFile.
 */
export function parseXbm(input: Uint8Array): XbmFile {
  // Step 1: input size
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // Step 2: ASCII decode — fatal rejects non-ASCII bytes
  let src: string;
  try {
    src = new TextDecoder('ascii', { fatal: true }).decode(input);
  } catch {
    throw new XbmBadHeaderError('input contains non-ASCII bytes');
  }

  const tok = new XbmTokenizer(src);

  // Step 3: `#define <prefix>_width <decimal>`
  tok.skipWs();
  tok.consume('#');
  tok.skipWs();

  let kw: string;
  try {
    kw = tok.readIdent();
  } catch {
    throw new XbmBadHeaderError('expected "define" after "#"');
  }
  if (kw !== 'define') {
    throw new XbmBadHeaderError(`expected "define" after "#", got "${kw}"`);
  }

  tok.skipWs();
  const widthIdent = tok.readIdent();
  // widthIdent must be <prefix>_width
  if (!widthIdent.endsWith('_width')) {
    throw new XbmBadHeaderError(`expected <prefix>_width, got "${widthIdent}"`);
  }
  const prefix = widthIdent.slice(0, widthIdent.length - '_width'.length);
  if (prefix.length === 0) {
    throw new XbmBadHeaderError('identifier prefix is empty — expected <prefix>_width');
  }
  validatePrefix(prefix);

  tok.skipWs();
  const width = tok.readDecimal();

  // Step 4: `#define <prefix>_height <decimal>`
  tok.skipWs();
  try {
    tok.consume('#');
  } catch {
    throw new XbmMissingDefineError(`${prefix}_height`);
  }
  tok.skipWs();

  let kw2: string;
  try {
    kw2 = tok.readIdent();
  } catch {
    throw new XbmMissingDefineError(`${prefix}_height`);
  }
  if (kw2 !== 'define') {
    throw new XbmMissingDefineError(`${prefix}_height`);
  }

  tok.skipWs();
  const heightIdent = tok.readIdent();
  if (heightIdent !== `${prefix}_height`) {
    // Could be a mismatch or wrong define
    if (heightIdent.endsWith('_height')) {
      const gotPrefix = heightIdent.slice(0, heightIdent.length - '_height'.length);
      throw new XbmPrefixMismatchError(prefix, gotPrefix, heightIdent);
    }
    throw new XbmMissingDefineError(`${prefix}_height`);
  }

  tok.skipWs();
  const height = tok.readDecimal();

  // Step 5: optional hotspot + bits array detection
  // We need to parse up to 2 optional hotspot defines before 'static'.
  // Hotspot defines may appear in any order but must be both-or-neither.
  let hotspotX: number | null = null;
  let hotspotY: number | null = null;

  // Peek at the next '#define' to see if it's a hotspot or we're at 'static'
  for (let round = 0; round < 4; round++) {
    tok.skipWs();
    if (tok.done) {
      throw new XbmMissingDefineError(`${prefix}_bits`);
    }
    const ch = tok.peek();
    if (ch === 's') {
      // 'static' keyword — end of header section
      break;
    }
    if (ch !== '#') {
      throw new XbmBadHeaderError(`unexpected character "${ch}" — expected "#define" or "static"`);
    }

    // We have a '#' — consume it and the 'define'
    tok.consume('#');
    tok.skipWs();
    const kw3 = tok.readIdent();
    if (kw3 !== 'define') {
      throw new XbmBadHeaderError(`expected "define" after "#", got "${kw3}"`);
    }
    tok.skipWs();
    const hotIdent = tok.readIdent();
    tok.skipWs();
    const hotVal = tok.readDecimal();

    if (hotIdent === `${prefix}_x_hot`) {
      if (hotspotX !== null) {
        throw new XbmMissingDefineError(`duplicate ${prefix}_x_hot`);
      }
      hotspotX = hotVal;
    } else if (hotIdent === `${prefix}_y_hot`) {
      if (hotspotY !== null) {
        throw new XbmMissingDefineError(`duplicate ${prefix}_y_hot`);
      }
      hotspotY = hotVal;
    } else if (hotIdent.startsWith(`${prefix}_`)) {
      // Unknown suffix — could be _bits starting with unexpected token
      // Check if it ends with _bits — that should have been 'static', not '#define'
      throw new XbmBadHeaderError(`unexpected define "${hotIdent}"`);
    } else {
      // Prefix mismatch
      if (hotIdent.endsWith('_x_hot') || hotIdent.endsWith('_y_hot')) {
        const gotPrefix = hotIdent.slice(0, hotIdent.lastIndexOf('_'));
        const gotPrefix2 = gotPrefix.slice(0, gotPrefix.lastIndexOf('_'));
        throw new XbmPrefixMismatchError(prefix, gotPrefix2, hotIdent);
      }
      throw new XbmBadHeaderError(`unexpected define "${hotIdent}"`);
    }

    // After 2 hotspot defines, we must have both or neither
    if (hotspotX !== null && hotspotY !== null) break;
  }

  // Validate both-or-neither (Trap #7)
  if ((hotspotX === null) !== (hotspotY === null)) {
    const missing = hotspotX === null ? `${prefix}_x_hot` : `${prefix}_y_hot`;
    throw new XbmMissingDefineError(missing);
  }

  const hotspot: XbmHotspot | null =
    hotspotX !== null && hotspotY !== null ? { x: hotspotX, y: hotspotY } : null;

  // Step 6: `static [unsigned] char <prefix>_bits[<opt>] = {`
  tok.skipWs();
  // Consume 'static'
  const staticKw = tok.readIdent();
  if (staticKw !== 'static') {
    throw new XbmBadHeaderError(`expected "static", got "${staticKw}"`);
  }

  tok.skipWs();
  // Consume optional 'unsigned'
  let charKw = tok.readIdent();
  if (charKw === 'unsigned') {
    tok.skipWs();
    charKw = tok.readIdent();
  }
  if (charKw !== 'char') {
    throw new XbmBadHeaderError(`expected "char" (possibly after "unsigned"), got "${charKw}"`);
  }

  tok.skipWs();
  const bitsIdent = tok.readIdent();
  if (bitsIdent !== `${prefix}_bits`) {
    if (bitsIdent.endsWith('_bits')) {
      const gotPrefix = bitsIdent.slice(0, bitsIdent.length - '_bits'.length);
      throw new XbmPrefixMismatchError(prefix, gotPrefix, bitsIdent);
    }
    throw new XbmBadHeaderError(`expected "${prefix}_bits", got "${bitsIdent}"`);
  }

  tok.skipWs();
  tok.consume('[');

  // Optional explicit length: `foo_bits[64]` — Trap #10
  tok.skipWs();
  let explicitLength: number | null = null;
  if (tok.peek() !== ']') {
    // There's a decimal inside the brackets
    try {
      explicitLength = tok.readDecimal();
    } catch {
      throw new XbmBadHeaderError('expected decimal or "]" inside brackets after bits identifier');
    }
    tok.skipWs();
  }
  tok.consume(']');

  tok.skipWs();
  tok.consume('=');
  tok.skipWs();
  tok.consume('{');

  // Step 7: validate dimensions against caps
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `XBM: dimensions ${width}×${height} exceed limits (max ${MAX_DIM} per axis).`,
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `XBM: pixel count ${width * height} exceeds maximum ${MAX_PIXELS}.`,
    );
  }

  // Step 8: allocate packed buffer (stride = ceil(width/8))
  const stride = Math.ceil(width / 8);
  const totalPackedBytes = height * stride;

  // Validate explicit length if present
  if (explicitLength !== null && explicitLength !== totalPackedBytes) {
    throw new XbmSizeMismatchError(explicitLength, totalPackedBytes);
  }

  const packed = new Uint8Array(totalPackedBytes);

  // Step 9: read hex bytes
  let byteCount = 0;
  while (true) {
    tok.skipWs();
    const ch = tok.peek();
    if (ch === '}') break;
    if (ch === '') {
      throw new XbmBadHeaderError('unexpected end-of-input inside hex array');
    }
    if (ch === ',') {
      // Trailing comma before '}' is valid (Trap #5)
      tok.pos++;
      tok.skipWs();
      if (tok.peek() === '}') break;
      continue;
    }

    // Read hex byte
    const hexByte = tok.readHexByte();

    if (byteCount < totalPackedBytes) {
      packed[byteCount] = hexByte;
    }
    byteCount++;

    tok.skipWs();
    const sep = tok.peek();
    if (sep === ',') {
      tok.pos++;
    } else if (sep !== '}') {
      if (sep === '') {
        throw new XbmBadHeaderError('unexpected end-of-input after hex byte');
      }
      throw new XbmBadHeaderError(`expected "," or "}" after hex byte, got "${sep}"`);
    }
  }

  tok.consume('}');
  tok.skipWs();
  // Trailing semicolon is standard but we accept it if present
  if (tok.peek() === ';') {
    tok.pos++;
  }

  // Validate byte count (Trap size mismatch)
  if (byteCount !== totalPackedBytes) {
    throw new XbmSizeMismatchError(byteCount, totalPackedBytes);
  }

  // Step 10: allocate pixelData and unpack LSB-first (Trap #1)
  const pixelData = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    const rowBase = row * stride;
    for (let col = 0; col < width; col++) {
      const byteIdx = rowBase + Math.floor(col / 8);
      const bitIdx = col % 8; // LSB-first: bit 0 = leftmost pixel
      // byteIdx is always in bounds (row < height, col < width →
      // byteIdx < height * stride = packed.length); ?? 0 satisfies
      // noUncheckedIndexedAccess.
      const packedByte = packed[byteIdx] ?? 0;
      pixelData[row * width + col] = (packedByte >> bitIdx) & 1;
    }
  }

  return {
    format: 'xbm',
    width,
    height,
    channels: 1,
    bitDepth: 1,
    prefix,
    hotspot,
    pixelData,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an XbmFile to canonical XBM source bytes.
 *
 * Canonical format:
 *  - `#define <prefix>_width <N>`
 *  - `#define <prefix>_height <N>`
 *  - (optional hotspot defines)
 *  - `static char <prefix>_bits[] = {`
 *  - 12 hex bytes per line, lowercase 0x, comma-separated, no trailing comma
 *  - `   0xNN };`
 */
export function serializeXbm(file: XbmFile): Uint8Array {
  const prefix = file.prefix.length > 0 ? file.prefix : XBM_DEFAULT_PREFIX;

  // Validate prefix
  validatePrefix(prefix);

  const { width, height, hotspot, pixelData } = file;

  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `XBM: dimensions ${width}×${height} exceed limits (max ${MAX_DIM} per axis).`,
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `XBM: pixel count ${width * height} exceeds maximum ${MAX_PIXELS}.`,
    );
  }

  // Pack pixelData LSB-first into packed (Trap #1)
  const stride = Math.ceil(width / 8);
  const packed = new Uint8Array(height * stride);

  for (let row = 0; row < height; row++) {
    const rowBase = row * stride;
    for (let col = 0; col < width; col++) {
      const pixel = pixelData[row * width + col] ?? 0;
      if (pixel !== 0) {
        const byteIdx = rowBase + Math.floor(col / 8);
        const bitIdx = col % 8; // LSB-first
        // byteIdx is always within bounds (byteIdx < height * stride), but
        // noUncheckedIndexedAccess requires a null-coalescing guard.
        packed[byteIdx] = (packed[byteIdx] ?? 0) | (1 << bitIdx);
      }
    }
  }

  // Build source text
  const lines: string[] = [];

  lines.push(`#define ${prefix}_width ${width}`);
  lines.push(`#define ${prefix}_height ${height}`);

  if (hotspot !== null) {
    lines.push(`#define ${prefix}_x_hot ${hotspot.x}`);
    lines.push(`#define ${prefix}_y_hot ${hotspot.y}`);
  }

  lines.push(`static char ${prefix}_bits[] = {`);

  // Emit hex bytes: XBM_BYTES_PER_LINE per line, lowercase 0x, 2 digits always
  const hexParts: string[] = [];
  for (let i = 0; i < packed.length; i++) {
    hexParts.push(`0x${(packed[i] ?? 0).toString(16).padStart(2, '0')}`);
  }

  // Group into rows of XBM_BYTES_PER_LINE
  const bodyLines: string[] = [];
  for (let i = 0; i < hexParts.length; i += XBM_BYTES_PER_LINE) {
    const chunk = hexParts.slice(i, i + XBM_BYTES_PER_LINE);
    const isLast = i + XBM_BYTES_PER_LINE >= hexParts.length;
    if (isLast) {
      // Last line: append `}` with final element (no trailing comma)
      // Format: `   0xNN, ..., 0xNN };`
      bodyLines.push(`   ${chunk.join(', ')} };`);
    } else {
      bodyLines.push(`   ${chunk.join(', ')},`);
    }
  }

  // Handle empty image (width=0 or height=0 is already rejected above,
  // but stride*height=0 is impossible given width>=1, height>=1)
  if (bodyLines.length === 0) {
    bodyLines.push('   };');
  }

  lines.push(...bodyLines);

  const text = `${lines.join('\n')}\n`;
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Detection helper (used by detect.ts)
// ---------------------------------------------------------------------------

/**
 * Look-ahead validation for XBM detection.
 *
 * Returns true if the first ~512 bytes of ASCII text, after skipping leading
 * whitespace and optional `/ * ... * /` comments, starts with
 * `#define <ident>_width <decimal>`.
 *
 * This is the "LOOKAHEAD-VALIDATED #define" detection described in Trap #6.
 * It does NOT accept arbitrary `#define FOO 1` files — the `_width` suffix
 * and a decimal value are required.
 *
 * NOTE: the lookahead is bounded to 512 bytes to prevent O(N) scanning on
 * non-XBM inputs.
 */
export function isXbmHeader(input: Uint8Array): boolean {
  // Bound lookahead to 512 bytes
  const slice = input.subarray(0, Math.min(input.length, 512));

  let src: string;
  try {
    src = new TextDecoder('ascii', { fatal: true }).decode(slice);
  } catch {
    return false;
  }

  const tok = new XbmTokenizer(src);
  try {
    tok.skipWs();
    if (tok.done) return false;
    if (tok.peek() !== '#') return false;
    tok.consume('#');
    tok.skipWs();
    const kw = tok.readIdent();
    if (kw !== 'define') return false;
    tok.skipWs();
    const ident = tok.readIdent();
    // Must end with _width
    if (!ident.endsWith('_width')) return false;
    // Prefix must be non-empty
    if (ident.length === '_width'.length) return false;
    tok.skipWs();
    // Must be followed by a decimal digit
    if (tok.done) return false;
    if (!isDecDigit(src.charCodeAt(tok.pos))) return false;
    return true;
  } catch {
    return false;
  }
}

// Re-export MIME for external use
export { XBM_MIME };
