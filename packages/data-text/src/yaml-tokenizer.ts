/**
 * YAML 1.2 tokenizer for @webcvt/data-text.
 *
 * Hand-rolled character-at-a-time tokenizer. O(n) guaranteed.
 * NO regex on untrusted variable-length scalar bodies (ReDoS defense).
 * Regex used only for Core Schema plain-scalar classification on
 * already-extracted bounded-length scalars, directive parsing, and
 * anchor/alias name validation (bounded inputs per spec).
 *
 * Spec: YAML 1.2.2 (Oct 2021) https://yaml.org/spec/1.2.2/
 * Clean-room: no code from js-yaml, yaml (eemeli), yamljs, pyyaml, libyaml, snakeyaml.
 *
 * YAML 1.2.2 §6 character encoding: UTF-8 only; BOM allowed at start.
 * YAML 1.2.2 §6.1: Tab character FORBIDDEN in leading indentation.
 */

import {
  MAX_YAML_ANCHORS,
  MAX_YAML_MAP_KEYS,
  MAX_YAML_SCALAR_LEN,
  MAX_YAML_SEQ_ITEMS,
} from './constants.ts';
import {
  YamlAnchorLimitError,
  YamlBadEscapeError,
  YamlDirectiveForbiddenError,
  YamlIndentError,
  YamlMapTooLargeError,
  YamlMergeKeyForbiddenError,
  YamlMultiDocForbiddenError,
  YamlParseError,
  YamlScalarTooLongError,
  YamlSeqTooLargeError,
  YamlTagForbiddenError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public YAML value types
// ---------------------------------------------------------------------------

export type YamlValue =
  | string
  | number // Core Schema floats (incl. .inf / .nan)
  | bigint // all ints — matches TOML convention, preserves 2^53..2^63
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

// Internal AST nodes (pre-alias-expansion)
export type YamlNode =
  | { kind: 'scalar'; value: string; tag: string | null; anchor: string | null }
  | { kind: 'seq'; items: YamlNode[]; anchor: string | null }
  | { kind: 'map'; pairs: Array<{ key: YamlNode; value: YamlNode }>; anchor: string | null }
  | { kind: 'alias'; name: string };

// ---------------------------------------------------------------------------
// Tokenizer state
// ---------------------------------------------------------------------------

export interface TokenizerState {
  src: string;
  pos: number;
  line: number;
  col: number;
  /** Depth of flow context ([...] or {...}). 0 = block context. */
  flowDepth: number;
  /** Map of anchor name → YamlNode, populated during parse. */
  anchors: Map<string, YamlNode>;
  /** Count of distinct anchor declarations. */
  anchorCount: number;
  /** Total alias dereferences (billion-laughs cap). */
  aliasExpansions: number;
}

export function mkState(src: string): TokenizerState {
  return {
    src,
    pos: 0,
    line: 1,
    col: 1,
    flowDepth: 0,
    anchors: new Map(),
    anchorCount: 0,
    aliasExpansions: 0,
  };
}

// ---------------------------------------------------------------------------
// Basic navigation
// ---------------------------------------------------------------------------

export function peek(s: TokenizerState): string {
  return s.src[s.pos] ?? '';
}

export function peekAt(s: TokenizerState, offset: number): string {
  return s.src[s.pos + offset] ?? '';
}

export function advance(s: TokenizerState): string {
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

export function isEof(s: TokenizerState): boolean {
  return s.pos >= s.src.length;
}

export function errAt(s: TokenizerState, msg: string): YamlParseError {
  const start = Math.max(0, s.pos - 15);
  const snippet = s.src.slice(start, s.pos + 25).replace(/\r?\n/g, '\\n');
  return new YamlParseError(msg, s.line, s.col, snippet);
}

// ---------------------------------------------------------------------------
// Whitespace helpers (YAML 1.2.2 §6)
// ---------------------------------------------------------------------------

/** Skip spaces and tabs on current line (inline whitespace only). */
export function skipInlineWhitespace(s: TokenizerState): void {
  while (!isEof(s) && (peek(s) === ' ' || peek(s) === '\t')) {
    advance(s);
  }
}

/** Skip a '#' comment to end of line (does not consume the newline). */
export function skipComment(s: TokenizerState): void {
  while (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r') {
    advance(s);
  }
}

/** Skip a newline (\r\n or \n). */
export function skipNewline(s: TokenizerState): void {
  if (!isEof(s) && peek(s) === '\r') advance(s);
  if (!isEof(s) && peek(s) === '\n') advance(s);
}

/**
 * Skip blank lines and comment-only lines in block context.
 * Stops at the first line that has non-space, non-comment content.
 * Checks for tab in leading indent (YAML 1.2.2 §6.1, Trap 7).
 */
export function skipBlankAndCommentLines(s: TokenizerState): void {
  while (!isEof(s)) {
    // Scan ahead on this line
    let localPos = s.pos;
    let sawTab = false;
    while (localPos < s.src.length && (s.src[localPos] === ' ' || s.src[localPos] === '\t')) {
      if (s.src[localPos] === '\t') sawTab = true;
      localPos++;
    }
    const nextCh = s.src[localPos] ?? '';
    // Blank line or comment → skip entire line
    if (nextCh === '\n' || nextCh === '\r' || nextCh === '#' || nextCh === '') {
      while (s.pos < localPos) advance(s);
      if (!isEof(s) && peek(s) === '#') skipComment(s);
      if (!isEof(s) && (peek(s) === '\r' || peek(s) === '\n')) skipNewline(s);
      else break;
      continue;
    }
    // Content line: check for tab in leading indent
    if (sawTab) {
      // advance to tab position for precise error location
      while (s.pos < localPos && s.src[s.pos] !== '\t') advance(s);
      throw new YamlIndentError(s.line, s.col);
    }
    break;
  }
}

/**
 * Measure the column of the first non-space character from current position
 * (without advancing). Returns 1-based column.
 */
export function measureIndent(s: TokenizerState): number {
  let localPos = s.pos;
  while (localPos < s.src.length && s.src[localPos] === ' ') {
    localPos++;
  }
  const spaces = localPos - s.pos;
  return s.col + spaces;
}

// ---------------------------------------------------------------------------
// Tag parsing (YAML 1.2.2 §6.8)
// ---------------------------------------------------------------------------

/** Allowlist of permitted YAML tags (§10.3 Core Schema). */
const TAG_ALLOWLIST = new Set(['!!str', '!!int', '!!float', '!!bool', '!!null', '!!seq', '!!map']);

/**
 * Parse a tag starting at '!'. Returns the tag string or throws YamlTagForbiddenError.
 * YAML 1.2.2 §6.8.1.
 */
export function parseTag(s: TokenizerState): string {
  // consume '!'
  advance(s);
  if (!isEof(s) && peek(s) === '!') {
    advance(s);
    // '!!' prefix — read name
    let name = '';
    while (
      !isEof(s) &&
      peek(s) !== ' ' &&
      peek(s) !== '\t' &&
      peek(s) !== '\n' &&
      peek(s) !== '\r' &&
      peek(s) !== ',' &&
      peek(s) !== ']' &&
      peek(s) !== '}'
    ) {
      name += advance(s);
    }
    const tag = `!!${name}`;
    if (!TAG_ALLOWLIST.has(tag)) {
      throw new YamlTagForbiddenError(tag);
    }
    skipInlineWhitespace(s);
    return tag;
  }
  // Single '!' — local tag or '<uri>' form — forbidden
  let rest = '';
  while (!isEof(s) && peek(s) !== ' ' && peek(s) !== '\t' && peek(s) !== '\n' && peek(s) !== '\r') {
    rest += advance(s);
  }
  throw new YamlTagForbiddenError(`!${rest}`);
}

// ---------------------------------------------------------------------------
// Anchor / alias parsing (YAML 1.2.2 §6.9)
// ---------------------------------------------------------------------------

/** Regex for valid anchor/alias names: [A-Za-z0-9_-]+ (bounded). */
const ANCHOR_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Parse anchor name after '&' or '*'. Returns name string. */
export function parseAnchorName(s: TokenizerState): string {
  let name = '';
  while (
    !isEof(s) &&
    peek(s) !== ' ' &&
    peek(s) !== '\t' &&
    peek(s) !== '\n' &&
    peek(s) !== '\r' &&
    peek(s) !== ',' &&
    peek(s) !== ']' &&
    peek(s) !== '}'
  ) {
    name += advance(s);
  }
  if (name.length === 0 || !ANCHOR_NAME_RE.test(name)) {
    throw errAt(s, `Invalid anchor/alias name: "${name}". Must match [A-Za-z0-9_-]+`);
  }
  return name;
}

/** Register an anchor. Throws YamlAnchorLimitError if over cap. */
export function registerAnchor(s: TokenizerState, name: string, node: YamlNode): void {
  if (!s.anchors.has(name)) {
    s.anchorCount++;
    if (s.anchorCount > MAX_YAML_ANCHORS) {
      throw new YamlAnchorLimitError(s.anchorCount, MAX_YAML_ANCHORS);
    }
  }
  s.anchors.set(name, node);
}

// ---------------------------------------------------------------------------
// Document-level directive & marker scan
// ---------------------------------------------------------------------------

/** Regex for YAML directive version string (used on first ≤128 chars of directive line). */
const YAML_VERSION_RE = /^%YAML\s+(\S+)/;

/**
 * Scan and consume leading directives and the optional --- marker.
 * Returns { hadDirectivesEndMarker, hadYamlDirective }.
 * Throws YamlDirectiveForbiddenError, YamlMultiDocForbiddenError.
 */
export function scanDirectivesAndMarker(s: TokenizerState): {
  hadDirectivesEndMarker: boolean;
  hadYamlDirective: boolean;
} {
  let hadDirectivesEndMarker = false;
  let hadYamlDirective = false;

  while (!isEof(s)) {
    const ch = peek(s);

    if (ch === ' ' || ch === '\t') {
      skipInlineWhitespace(s);
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      skipNewline(s);
      continue;
    }

    if (ch === '#') {
      skipComment(s);
      skipNewline(s);
      continue;
    }

    if (ch === '%') {
      // Directive — collect up to 128 chars for safety
      let directive = '';
      while (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r' && directive.length < 128) {
        directive += advance(s);
      }
      skipNewline(s);

      const match = YAML_VERSION_RE.exec(directive);
      if (match !== null) {
        const version = match[1] ?? '';
        if (version !== '1.2') {
          throw new YamlDirectiveForbiddenError(directive.trim());
        }
        hadYamlDirective = true;
        continue;
      }
      // %TAG or any other directive → forbidden
      throw new YamlDirectiveForbiddenError(directive.trim());
    }

    // Check for '---' directives-end marker at this position
    if (ch === '-' && peekAt(s, 1) === '-' && peekAt(s, 2) === '-') {
      const after = peekAt(s, 3);
      if (after === ' ' || after === '\t' || after === '\n' || after === '\r' || after === '') {
        if (hadDirectivesEndMarker) {
          throw new YamlMultiDocForbiddenError('second --- marker');
        }
        hadDirectivesEndMarker = true;
        advance(s);
        advance(s);
        advance(s); // consume '---'
        skipInlineWhitespace(s);
        if (!isEof(s) && peek(s) === '#') skipComment(s);
        if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) skipNewline(s);
        break; // document body starts after ---
      }
    }

    // Not a directive or marker — document body starts here
    break;
  }

  return { hadDirectivesEndMarker, hadYamlDirective };
}

// ---------------------------------------------------------------------------
// Multi-doc sentinel check (YAML 1.2.2 §9.2, Trap 12)
// ---------------------------------------------------------------------------

/**
 * Check remaining content for a second '---' or any '...' at column 0.
 * Throws YamlMultiDocForbiddenError or YamlParseError for trailing garbage.
 */
export function checkNoMultiDoc(s: TokenizerState): void {
  while (!isEof(s)) {
    const ch = peek(s);
    if (ch === ' ' || ch === '\t') {
      skipInlineWhitespace(s);
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      skipNewline(s);
      continue;
    }
    if (ch === '#') {
      skipComment(s);
      continue;
    }
    // Check for '...' or '---'
    if (ch === '.' && peekAt(s, 1) === '.' && peekAt(s, 2) === '.') {
      throw new YamlMultiDocForbiddenError('document-end marker (...)');
    }
    if (ch === '-' && peekAt(s, 1) === '-' && peekAt(s, 2) === '-') {
      throw new YamlMultiDocForbiddenError('second document separator (---)');
    }
    // Trailing non-whitespace content
    throw errAt(s, 'Unexpected trailing content after document (Trap 15)');
  }
}

// ---------------------------------------------------------------------------
// Single-quoted scalar (YAML 1.2.2 §8.3.3)
// ---------------------------------------------------------------------------

/**
 * Parse a single-quoted scalar. Caller has consumed the opening '\''.
 * Only escape: '' → '. Everything else literal. Line folding applies.
 */
export function parseSingleQuotedScalar(s: TokenizerState): string {
  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated single-quoted scalar');
    const ch = peek(s);

    if (ch === "'") {
      advance(s);
      if (!isEof(s) && peek(s) === "'") {
        // '' escape → single '
        advance(s);
        parts.push("'");
        len++;
        if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
        continue;
      }
      break; // end of scalar
    }

    // Newline: line folding (YAML 1.2.2 §6.5)
    if (ch === '\n' || ch === '\r') {
      skipNewline(s);
      let blankLines = 0;
      while (!isEof(s)) {
        let lp = s.pos;
        while (lp < s.src.length && s.src[lp] === ' ') lp++;
        const nc = s.src[lp] ?? '';
        if (nc === '\n' || nc === '\r') {
          while (s.pos < lp) advance(s);
          skipNewline(s);
          blankLines++;
        } else break;
      }
      while (!isEof(s) && peek(s) === ' ') advance(s);
      if (blankLines === 0) {
        parts.push(' ');
        len++;
      } else {
        parts.push('\n'.repeat(blankLines));
        len += blankLines;
      }
      if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
      continue;
    }

    const c = advance(s);
    parts.push(c);
    len++;
    if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Double-quoted scalar (YAML 1.2.2 §8.3.2)
// ---------------------------------------------------------------------------

/**
 * Parse a double-quoted scalar. Caller has consumed the opening '"'.
 * Full escape set per YAML 1.2.2 §5.7.
 */
export function parseDoubleQuotedScalar(s: TokenizerState): string {
  const parts: string[] = [];
  let len = 0;

  while (true) {
    if (isEof(s)) throw errAt(s, 'Unterminated double-quoted scalar');
    const ch = peek(s);

    if (ch === '"') {
      advance(s);
      break;
    }

    if (ch === '\\') {
      advance(s);
      const esc = parseYamlEscapeSequence(s);
      len += esc.length;
      if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
      if (esc.length > 0) parts.push(esc);
      continue;
    }

    // Newline: line folding
    if (ch === '\n' || ch === '\r') {
      skipNewline(s);
      let blankLines = 0;
      while (!isEof(s)) {
        let lp = s.pos;
        while (lp < s.src.length && s.src[lp] === ' ') lp++;
        const nc = s.src[lp] ?? '';
        if (nc === '\n' || nc === '\r') {
          while (s.pos < lp) advance(s);
          skipNewline(s);
          blankLines++;
        } else break;
      }
      while (!isEof(s) && peek(s) === ' ') advance(s);
      if (blankLines === 0) {
        parts.push(' ');
        len++;
      } else {
        parts.push('\n'.repeat(blankLines));
        len += blankLines;
      }
      if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
      continue;
    }

    const c = advance(s);
    parts.push(c);
    len++;
    if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
  }

  return parts.join('');
}

/**
 * Parse YAML escape sequence after backslash.
 * YAML 1.2.2 §5.7 escape codes.
 * Returns decoded string, or '' for line continuation (\<newline>).
 */
function parseYamlEscapeSequence(s: TokenizerState): string {
  if (isEof(s)) throw errAt(s, 'Unexpected end after backslash in double-quoted scalar');
  const esc = advance(s);
  switch (esc) {
    case '0':
      return '\x00';
    case 'a':
      return '\x07';
    case 'b':
      return '\b';
    case 't':
      return '\t';
    case 'n':
      return '\n';
    case 'v':
      return '\x0B';
    case 'f':
      return '\f';
    case 'r':
      return '\r';
    case 'e':
      return '\x1B';
    case ' ':
      return ' ';
    case '"':
      return '"';
    case '/':
      return '/';
    case '\\':
      return '\\';
    case 'N':
      return '\u0085';
    case '_':
      return '\u00A0';
    case 'L':
      return '\u2028';
    case 'P':
      return '\u2029';
    case 'x':
      return parseHexEscape(s, 2);
    case 'u':
      return parseHexEscape(s, 4);
    case 'U':
      return parseHexEscape(s, 8);
    default: {
      // Line continuation: \<newline> trims whitespace
      if (esc === '\n' || esc === '\r') {
        if (esc === '\r' && !isEof(s) && peek(s) === '\n') advance(s);
        while (!isEof(s) && (peek(s) === ' ' || peek(s) === '\t')) advance(s);
        return '';
      }
      throw new YamlBadEscapeError(esc);
    }
  }
}

function parseHexEscape(s: TokenizerState, digits: number): string {
  let hex = '';
  for (let i = 0; i < digits; i++) {
    if (isEof(s)) throw errAt(s, `Expected ${digits} hex digits in escape, got ${i}`);
    const c = advance(s);
    if (!isHexDigit(c)) throw errAt(s, `Invalid hex digit '${c}' in escape`);
    hex += c;
  }
  const cp = Number.parseInt(hex, 16);
  if (cp >= 0xd800 && cp <= 0xdfff) {
    throw errAt(s, `Unicode escape U+${hex.toUpperCase()} is a surrogate (U+D800..U+DFFF)`);
  }
  if (cp > 0x10ffff) {
    throw errAt(s, `Unicode escape U+${hex.toUpperCase()} exceeds U+10FFFF`);
  }
  return String.fromCodePoint(cp);
}

function isHexDigit(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

// ---------------------------------------------------------------------------
// Block scalar (YAML 1.2.2 §8.1)
// ---------------------------------------------------------------------------

export type ChompMode = 'clip' | 'strip' | 'keep';

/**
 * Parse block scalar header line: style, chomp, indent-indicator.
 * Caller is positioned at '|' or '>'.
 */
export function parseBlockScalarHeader(s: TokenizerState): {
  style: '|' | '>';
  chomp: ChompMode;
  explicitIndent: number;
} {
  const style = advance(s) as '|' | '>';
  let chomp: ChompMode = 'clip';
  let explicitIndent = 0;

  while (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r' && peek(s) !== '#') {
    const c = peek(s);
    if (c === '+') {
      chomp = 'keep';
      advance(s);
    } else if (c === '-') {
      chomp = 'strip';
      advance(s);
    } else if (c >= '1' && c <= '9') {
      explicitIndent = Number(advance(s));
    } else if (c === ' ' || c === '\t') {
      advance(s);
    } else {
      throw errAt(s, `Unexpected character '${c}' in block scalar header`);
    }
  }
  if (!isEof(s) && peek(s) === '#') skipComment(s);
  skipNewline(s);

  return { style, chomp, explicitIndent };
}

/**
 * Parse block scalar content lines.
 * @param style        '|' literal or '>' folded
 * @param chomp        clip/strip/keep
 * @param explicitIndent  indent indicator (0 = auto-detect)
 * @param parentIndent 1-based column of the parent node's key
 */
export function parseBlockScalarContent(
  s: TokenizerState,
  style: '|' | '>',
  chomp: ChompMode,
  explicitIndent: number,
  parentIndent: number,
): string {
  // Auto-detect content indent from first non-empty line
  let contentIndent = explicitIndent > 0 ? parentIndent + explicitIndent - 1 : 0;

  if (contentIndent === 0) {
    let scanPos = s.pos;
    while (scanPos < s.src.length) {
      let spaceCount = 0;
      while (scanPos < s.src.length && s.src[scanPos] === ' ') {
        spaceCount++;
        scanPos++;
      }
      const nc = s.src[scanPos] ?? '';
      if (nc === '\n' || nc === '\r') {
        if (nc === '\r' && s.src[scanPos + 1] === '\n') scanPos += 2;
        else scanPos++;
        continue;
      }
      if (nc === '') break;
      contentIndent = spaceCount; // 0-based space count
      break;
    }
  }
  // else: contentIndent already set above from explicitIndent

  // contentIndent is 0-based count of spaces required
  const lines: string[] = [];
  const trailingEmpty: string[] = [];
  let contentLen = 0;

  while (!isEof(s)) {
    // Measure line indentation
    let spaceCount = 0;
    let localPos = s.pos;
    while (localPos < s.src.length && s.src[localPos] === ' ') {
      spaceCount++;
      localPos++;
    }
    const nc = s.src[localPos] ?? '';

    // Empty / blank line
    if (nc === '\n' || nc === '\r' || nc === '') {
      while (s.pos < localPos) advance(s);
      trailingEmpty.push('');
      // Count trailing blank lines against the scalar length cap (LOW fix)
      if (contentLen + trailingEmpty.length > MAX_YAML_SCALAR_LEN) {
        throw new YamlScalarTooLongError(contentLen + trailingEmpty.length, MAX_YAML_SCALAR_LEN);
      }
      if (nc !== '') skipNewline(s);
      else break;
      continue;
    }

    // Line indent < content indent → end of block scalar
    if (spaceCount < contentIndent) {
      break;
    }

    // Tab as first non-space character in content line → forbidden (Trap 7)
    if (nc === '\t') {
      while (s.pos < localPos) advance(s);
      throw new YamlIndentError(s.line, s.col);
    }

    // Flush trailing empty lines
    for (const _ of trailingEmpty) lines.push('');
    trailingEmpty.length = 0;

    // Consume exactly contentIndent spaces
    for (let i = 0; i < contentIndent; i++) {
      if (!isEof(s) && peek(s) === ' ') advance(s);
    }

    // Collect rest of line content
    let lineContent = '';
    while (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r') {
      lineContent += advance(s);
    }
    lines.push(lineContent);
    contentLen += lineContent.length + 1; // +1 for the \n separator
    if (contentLen > MAX_YAML_SCALAR_LEN) {
      throw new YamlScalarTooLongError(contentLen, MAX_YAML_SCALAR_LEN);
    }
    if (!isEof(s)) skipNewline(s);
  }

  return applyChomping(style, lines, trailingEmpty, chomp);
}

/**
 * Apply chomping and folding to produce final scalar string.
 * YAML 1.2.2 §8.1.1.2 chomping, §6.5 line folding.
 */
function applyChomping(
  style: '|' | '>',
  lines: string[],
  trailingEmpty: string[],
  chomp: ChompMode,
): string {
  if (style === '|') {
    // Literal: join with \n, one mandatory newline
    let body = lines.join('\n');
    if (chomp === 'strip') {
      return body;
    }
    if (chomp === 'keep') {
      if (lines.length > 0) body += '\n';
      return body + '\n'.repeat(trailingEmpty.length);
    }
    // clip: exactly one trailing newline
    if (lines.length > 0) body += '\n';
    return body;
  }
  // Folded '>' style: fold single newlines between non-empty non-indented lines
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    parts.push(line);
    if (i < lines.length - 1) {
      const next = lines[i + 1] ?? '';
      // Both non-empty and neither starts with space → fold to ' '
      if (line.length > 0 && next.length > 0 && !line.startsWith(' ') && !next.startsWith(' ')) {
        parts.push(' ');
      } else {
        parts.push('\n');
      }
    }
  }
  let result = parts.join('');
  if (chomp === 'strip') {
    return result.trimEnd();
  }
  if (chomp === 'keep') {
    if (lines.length > 0) result += '\n';
    return result + '\n'.repeat(trailingEmpty.length);
  }
  // clip
  result = result.trimEnd();
  if (lines.length > 0) result += '\n';
  return result;
}

// ---------------------------------------------------------------------------
// Plain scalar parsing (YAML 1.2.2 §7.3.3)
// ---------------------------------------------------------------------------

/**
 * Parse a plain (unquoted) scalar.
 * Multi-line continuation: lines indented >= minIndent.
 * Stops at block indicators, flow chars, comment-after-space.
 */
export function parsePlainScalar(s: TokenizerState, minIndent: number): string {
  const parts: string[] = [];
  let len = 0;

  // Read first line content
  const firstLine = readPlainScalarLine(s, s.flowDepth > 0);
  len += firstLine.length;
  if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
  parts.push(firstLine);

  // Continuation lines only in block context
  if (s.flowDepth === 0) {
    while (!isEof(s)) {
      const savedPos = s.pos;
      const savedLine = s.line;
      const savedCol = s.col;

      skipInlineWhitespace(s);
      const ch = peek(s);
      if (!isEof(s) && ch === '#') {
        // comment after scalar — restore and stop
        s.pos = savedPos;
        s.line = savedLine;
        s.col = savedCol;
        break;
      }
      if (!isEof(s) && (ch === '\n' || ch === '\r')) {
        skipNewline(s);
        // Count blank lines
        let blankLines = 0;
        while (!isEof(s)) {
          let lp = s.pos;
          while (lp < s.src.length && s.src[lp] === ' ') lp++;
          const nc = s.src[lp] ?? '';
          if (nc === '\n' || nc === '\r') {
            while (s.pos < lp) advance(s);
            skipNewline(s);
            blankLines++;
          } else break;
        }
        if (isEof(s)) break;
        const nextIndent = measureIndent(s);
        if (nextIndent < minIndent) break;
        // Check if next non-space char starts a block indicator
        let lp2 = s.pos;
        while (lp2 < s.src.length && s.src[lp2] === ' ') lp2++;
        const nc2 = s.src[lp2] ?? '';
        if (
          nc2 === '-' &&
          (s.src[lp2 + 1] === ' ' || s.src[lp2 + 1] === '\t' || s.src[lp2 + 1] === '\n')
        )
          break;
        if (nc2 === '#' || nc2 === '\n' || nc2 === '\r' || nc2 === '') break;
        if (nc2 === ':' || nc2 === '?') break;

        // Consume indent spaces
        while (!isEof(s) && peek(s) === ' ') advance(s);

        if (blankLines > 0) {
          parts.push('\n'.repeat(blankLines));
          len += blankLines;
        } else {
          parts.push(' ');
          len++;
        }
        if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
        const contLine = readPlainScalarLine(s, false);
        len += contLine.length;
        if (len > MAX_YAML_SCALAR_LEN) throw new YamlScalarTooLongError(len, MAX_YAML_SCALAR_LEN);
        parts.push(contLine);
        continue;
      }
      // Not newline or EOF → end of scalar
      s.pos = savedPos;
      s.line = savedLine;
      s.col = savedCol;
      break;
    }
  }

  return parts.join('');
}

/**
 * Read characters of a plain scalar on current line until a stopping condition.
 */
function readPlainScalarLine(s: TokenizerState, inFlow: boolean): string {
  let content = '';

  while (!isEof(s)) {
    const c = peek(s);
    if (c === '\n' || c === '\r') break;
    if (inFlow && (c === ',' || c === ']' || c === '}')) break;
    if (c === '#') {
      // # preceded by space → comment
      if (content.length > 0 && content[content.length - 1] === ' ') break;
      if (content.length === 0) break;
    }
    if (c === ':') {
      const next = peekAt(s, 1);
      if (
        next === ' ' ||
        next === '\t' ||
        next === '\n' ||
        next === '\r' ||
        next === '' ||
        (inFlow && (next === ',' || next === ']' || next === '}'))
      ) {
        break;
      }
    }
    content += advance(s);
  }

  return content.trimEnd();
}

// ---------------------------------------------------------------------------
// Size cap helpers
// ---------------------------------------------------------------------------

export function checkSeqCap(count: number): void {
  if (count > MAX_YAML_SEQ_ITEMS) throw new YamlSeqTooLargeError(count, MAX_YAML_SEQ_ITEMS);
}

export function checkMapCap(count: number): void {
  if (count > MAX_YAML_MAP_KEYS) throw new YamlMapTooLargeError(count, MAX_YAML_MAP_KEYS);
}

// ---------------------------------------------------------------------------
// Merge key check (Trap 4)
// ---------------------------------------------------------------------------

export function checkMergeKey(key: string): void {
  if (key === '<<') {
    throw new YamlMergeKeyForbiddenError();
  }
}
