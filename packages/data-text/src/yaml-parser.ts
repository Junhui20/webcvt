/**
 * YAML 1.2 recursive-descent parser for @catlabtech/webcvt-data-text.
 *
 * Indent-aware recursive descent over the YamlNode AST from yaml-tokenizer.ts.
 * Phase 3 of the parse pipeline (decode → directives → parse → expand).
 *
 * Spec: YAML 1.2.2 https://yaml.org/spec/1.2.2/
 * Core Schema: https://yaml.org/spec/1.2.2/#103-core-schema
 * Clean-room: no code ported from js-yaml, yaml (eemeli), yamljs, pyyaml, libyaml.
 */

import { MAX_YAML_ALIASES, MAX_YAML_DEPTH } from './constants.ts';
import {
  YamlAliasLimitError,
  YamlAnchorCycleError,
  YamlAnchorUndefinedError,
  YamlComplexKeyForbiddenError,
  YamlDepthExceededError,
  YamlDuplicateKeyError,
  YamlInvalidUtf8Error,
  YamlParseError,
} from './errors.ts';
import { decodeInput } from './utf8.ts';
import {
  type TokenizerState,
  type YamlNode,
  type YamlValue,
  advance,
  checkMapCap,
  checkMergeKey,
  checkNoMultiDoc,
  checkSeqCap,
  errAt,
  isEof,
  measureIndent,
  mkState,
  parseAnchorName,
  parseBlockScalarContent,
  parseBlockScalarHeader,
  parseDoubleQuotedScalar,
  parsePlainScalar,
  parseSingleQuotedScalar,
  parseTag,
  peek,
  peekAt,
  registerAnchor,
  scanDirectivesAndMarker,
  skipBlankAndCommentLines,
  skipComment,
  skipInlineWhitespace,
  skipNewline,
} from './yaml-tokenizer.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { YamlValue };

export interface YamlFile {
  readonly value: YamlValue;
  readonly hadBom: boolean;
  readonly hadDirectivesEndMarker: boolean;
  readonly hadYamlDirective: boolean;
}

// ---------------------------------------------------------------------------
// Core Schema type classification (YAML 1.2.2 §10.3.2)
// Regex on already-extracted bounded scalars — NOT on untrusted variable-length input.
// Spec source: https://yaml.org/spec/1.2.2/#103-core-schema
// ---------------------------------------------------------------------------

/** Null: null | Null | NULL | ~ | (empty string) */
const NULL_RE = /^(null|Null|NULL|~|)$/;

/** Boolean true: true | True | TRUE */
const BOOL_TRUE_RE = /^(true|True|TRUE)$/;

/** Boolean false: false | False | FALSE */
const BOOL_FALSE_RE = /^(false|False|FALSE)$/;

/**
 * Core Schema integer: optional sign, then 0 or [1-9][0-9]*.
 * No leading zeros, no 0x/0o/0b (YAML 1.1 only — Trap 6).
 */
const INT_RE = /^[-+]?(?:0|[1-9][0-9]*)$/;

/**
 * Core Schema float per §10.3.2 + .inf / -.inf / .nan specials.
 * MUST contain a decimal point OR exponent to be a float (not just digits).
 * This prevents "0123" from being classified as float — it has no dot/exponent
 * and was already rejected by INT_RE, so it must stay as string (Trap 6).
 */
const FLOAT_RE =
  /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)(?:[eE][-+]?[0-9]+)?$|^[-+]?[0-9]+[eE][-+]?[0-9]+$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/;

/**
 * Classify a plain scalar string per Core Schema.
 * Fixed order: null → bool → int → float → string (Trap 6).
 */
function classifyPlainScalar(raw: string): YamlValue {
  if (NULL_RE.test(raw)) return null;
  if (BOOL_TRUE_RE.test(raw)) return true;
  if (BOOL_FALSE_RE.test(raw)) return false;
  if (INT_RE.test(raw)) {
    return BigInt(raw.startsWith('+') ? raw.slice(1) : raw);
  }
  if (FLOAT_RE.test(raw)) {
    const lower = raw.toLowerCase();
    if (lower.includes('.nan')) return Number.NaN;
    if (lower.endsWith('.inf'))
      return lower.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return Number.parseFloat(raw);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Parser: recursive descent with indent tracking
// ---------------------------------------------------------------------------

/**
 * Parse a YAML node starting at the current position.
 * @param s          Tokenizer state
 * @param minIndent  Minimum column (1-based) for block content
 * @param depth      Current nesting depth (incremented at each container)
 */
function parseNode(s: TokenizerState, minIndent: number, depth: number): YamlNode {
  if (depth > MAX_YAML_DEPTH) throw new YamlDepthExceededError(depth, MAX_YAML_DEPTH);

  skipBlankAndCommentLines(s);
  if (isEof(s)) {
    return { kind: 'scalar', value: '', tag: null, anchor: null };
  }

  // Stop at document markers (--- or ...) in block context (Trap 12 / 15)
  // These will be caught by checkNoMultiDoc after the top-level parse returns.
  if (s.flowDepth === 0 && s.col === 1) {
    const ch0 = peek(s);
    const ch1 = peekAt(s, 1);
    const ch2 = peekAt(s, 2);
    const ch3 = peekAt(s, 3);
    if (
      ch0 === '-' &&
      ch1 === '-' &&
      ch2 === '-' &&
      (ch3 === ' ' || ch3 === '\t' || ch3 === '\n' || ch3 === '\r' || ch3 === '')
    ) {
      // Document marker — stop parsing, return empty node; caller will handle
      return { kind: 'scalar', value: '', tag: null, anchor: null };
    }
    if (ch0 === '.' && ch1 === '.' && ch2 === '.') {
      return { kind: 'scalar', value: '', tag: null, anchor: null };
    }
  }

  let tag: string | null = null;
  let anchor: string | null = null;

  // Read optional tag and/or anchor (YAML allows either order)
  let readMeta = true;
  while (readMeta) {
    const ch = peek(s);
    if (ch === '!') {
      tag = parseTag(s);
      skipInlineWhitespace(s);
    } else if (ch === '&') {
      advance(s); // consume '&'
      anchor = parseAnchorName(s);
      skipInlineWhitespace(s);
    } else {
      readMeta = false;
    }
  }

  const ch = peek(s);

  // Alias node
  if (ch === '*') {
    advance(s); // consume '*'
    const aliasName = parseAnchorName(s);
    // YAML 1.2 spec §3.2.3: anchor must be declared before its alias (no forward refs)
    if (!s.anchors.has(aliasName)) throw new YamlAnchorUndefinedError(aliasName);
    return { kind: 'alias', name: aliasName };
  }

  // Block sequence (only in block context): '- ' at start of content
  if (s.flowDepth === 0 && ch === '-') {
    const next = peekAt(s, 1);
    if (next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '') {
      return parseBlockSeq(s, s.col, depth, anchor);
    }
  }

  // Block scalar: '|' or '>' (only in block context)
  if (s.flowDepth === 0 && (ch === '|' || ch === '>')) {
    const { style, chomp, explicitIndent } = parseBlockScalarHeader(s);
    const value = parseBlockScalarContent(s, style, chomp, explicitIndent, minIndent);
    // Block scalars are always !!str unless an explicit tag overrides (YAML spec §3.2.1.2)
    const effectiveTagBlock = tag ?? '!!str';
    const node: YamlNode = { kind: 'scalar', value, tag: effectiveTagBlock, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Flow sequence
  if (ch === '[') {
    return parseFlowSeq(s, depth, anchor);
  }

  // Flow mapping
  if (ch === '{') {
    return parseFlowMap(s, depth, anchor);
  }

  // Complex key (Trap 16): '? ' in block context
  if (s.flowDepth === 0 && ch === '?') {
    const next = peekAt(s, 1);
    if (next === ' ' || next === '\t' || next === '\n' || next === '\r') {
      throw new YamlComplexKeyForbiddenError();
    }
  }

  // Single-quoted scalar
  if (ch === "'") {
    advance(s);
    const value = parseSingleQuotedScalar(s);
    // Quoted scalars are always !!str unless an explicit tag overrides (YAML spec §3.2.1.2)
    const effectiveTagSq = tag ?? '!!str';
    const node: YamlNode = { kind: 'scalar', value, tag: effectiveTagSq, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Double-quoted scalar
  if (ch === '"') {
    advance(s);
    const value = parseDoubleQuotedScalar(s);
    // Quoted scalars are always !!str unless an explicit tag overrides (YAML spec §3.2.1.2)
    const effectiveTagDq = tag ?? '!!str';
    const node: YamlNode = { kind: 'scalar', value, tag: effectiveTagDq, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Tag/anchor followed by newline in block context: value is on the next line.
  // Skip the newline and parse the following block node with the accumulated tag/anchor.
  if (s.flowDepth === 0 && (ch === '\n' || ch === '\r') && (tag !== null || anchor !== null)) {
    skipNewline(s);
    skipBlankAndCommentLines(s);
    if (!isEof(s)) {
      const nextIndent = measureIndent(s);
      if (nextIndent >= minIndent) {
        while (!isEof(s) && peek(s) === ' ') advance(s);
        // Recurse without the tag/anchor (we pass them to the inner call implicitly
        // by splicing the accumulated state). Since parseNode reads tag/anchor from
        // the stream, and we've already consumed them, we call parseNodeWithMeta.
        return parseNodeWithMeta(s, minIndent, depth, tag, anchor);
      }
    }
    // Indented content not found — the anchor/tag binds to null scalar
    const emptyNode: YamlNode = { kind: 'scalar', value: '', tag, anchor };
    if (anchor !== null) registerAnchor(s, anchor, emptyNode);
    return emptyNode;
  }

  // Try block mapping before plain scalar
  if (s.flowDepth === 0 && ch !== '' && ch !== '\n' && ch !== '\r') {
    const mapNode = tryBlockMapping(s, minIndent, depth, anchor, tag);
    if (mapNode !== null) return mapNode;
  }

  // Plain scalar
  if (ch !== '' && ch !== '\n' && ch !== '\r') {
    const value = parsePlainScalar(s, minIndent);
    const node: YamlNode = { kind: 'scalar', value, tag, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Empty / null node
  const node: YamlNode = { kind: 'scalar', value: '', tag, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);
  return node;
}

/**
 * Parse a YAML node with pre-consumed tag and anchor metadata.
 * Used when tag/anchor appear on a line before the actual value.
 */
function parseNodeWithMeta(
  s: TokenizerState,
  minIndent: number,
  depth: number,
  tag: string | null,
  anchor: string | null,
): YamlNode {
  if (depth > MAX_YAML_DEPTH) throw new YamlDepthExceededError(depth, MAX_YAML_DEPTH);

  const ch = peek(s);

  // Block sequence
  if (s.flowDepth === 0 && ch === '-') {
    const next = peekAt(s, 1);
    if (next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '') {
      return parseBlockSeq(s, s.col, depth, anchor);
    }
  }

  // Block scalar
  if (s.flowDepth === 0 && (ch === '|' || ch === '>')) {
    const { style, chomp, explicitIndent } = parseBlockScalarHeader(s);
    const value = parseBlockScalarContent(s, style, chomp, explicitIndent, minIndent);
    const effectiveTag = tag ?? '!!str';
    const node: YamlNode = { kind: 'scalar', value, tag: effectiveTag, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Flow sequence
  if (ch === '[') {
    return parseFlowSeq(s, depth, anchor);
  }

  // Flow mapping
  if (ch === '{') {
    return parseFlowMap(s, depth, anchor);
  }

  // Try block mapping
  if (s.flowDepth === 0 && ch !== '' && ch !== '\n' && ch !== '\r') {
    const mapNode = tryBlockMapping(s, minIndent, depth, anchor, tag);
    if (mapNode !== null) return mapNode;
  }

  // Plain scalar
  if (ch !== '' && ch !== '\n' && ch !== '\r') {
    const value = parsePlainScalar(s, minIndent);
    const node: YamlNode = { kind: 'scalar', value, tag, anchor };
    if (anchor !== null) registerAnchor(s, anchor, node);
    return node;
  }

  // Empty node
  const node: YamlNode = { kind: 'scalar', value: '', tag, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);
  return node;
}

/**
 * Attempt to parse a block mapping starting at current position.
 * Returns null if no ':' with space found on this line (not a mapping).
 */
function tryBlockMapping(
  s: TokenizerState,
  minIndent: number,
  depth: number,
  anchor: string | null,
  tag: string | null,
): YamlNode | null {
  // Scan ahead for ':' followed by space/newline/eof on this line
  let scanPos = s.pos;
  let inSq = false;
  let inDq = false;
  while (scanPos < s.src.length) {
    const c = s.src[scanPos] ?? '';
    if (c === '\n' || c === '\r') break;
    if (!inDq && c === "'") inSq = !inSq;
    else if (!inSq && c === '"') inDq = !inDq;
    if (!inSq && !inDq) {
      if (c === ':') {
        const nc = s.src[scanPos + 1] ?? '';
        if (nc === ' ' || nc === '\t' || nc === '\n' || nc === '\r' || nc === '') {
          return parseBlockMap(s, minIndent, depth, anchor, tag);
        }
      }
      if (c === '#') break;
    }
    scanPos++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Block sequence (YAML 1.2.2 §8.2.1)
// ---------------------------------------------------------------------------

function parseBlockSeq(
  s: TokenizerState,
  seqIndent: number,
  depth: number,
  anchor: string | null,
): YamlNode {
  const items: YamlNode[] = [];
  const node: YamlNode = { kind: 'seq', items, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);

  while (!isEof(s)) {
    skipBlankAndCommentLines(s);
    if (isEof(s)) break;

    // Stop at document markers (Trap 12)
    if (isDocumentMarker(s)) break;

    // Check column of '- '
    const currentIndent = measureIndent(s);
    if (currentIndent !== seqIndent) break;

    // Look ahead to confirm it's '- '
    const dashPos = s.pos + (currentIndent - s.col);
    const dashCh = s.src[dashPos] ?? '';
    if (dashCh !== '-') break;
    const afterDash = s.src[dashPos + 1] ?? '';
    if (
      afterDash !== ' ' &&
      afterDash !== '\t' &&
      afterDash !== '\n' &&
      afterDash !== '\r' &&
      afterDash !== ''
    )
      break;

    // Consume leading spaces
    while (!isEof(s) && peek(s) === ' ') advance(s);
    advance(s); // consume '-'

    checkSeqCap(items.length + 1);

    const itemIndent = seqIndent + 2;
    const afterDashNow = peek(s);

    if (afterDashNow === ' ' || afterDashNow === '\t') {
      advance(s); // consume space/tab after '-'
      skipInlineWhitespace(s);
      // Item may be on same line or next line
      if (!isEof(s) && peek(s) !== '\n' && peek(s) !== '\r') {
        const item = parseNode(s, itemIndent, depth + 1);
        items.push(item);
        skipInlineWhitespace(s);
        if (!isEof(s) && peek(s) === '#') skipComment(s);
        if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) skipNewline(s);
      } else {
        if (!isEof(s)) skipNewline(s);
        skipBlankAndCommentLines(s);
        if (!isEof(s) && measureIndent(s) >= itemIndent) {
          while (!isEof(s) && peek(s) === ' ') advance(s);
          const item = parseNode(s, itemIndent, depth + 1);
          items.push(item);
        } else {
          items.push({ kind: 'scalar', value: '', tag: null, anchor: null });
        }
      }
    } else if (afterDashNow === '\n' || afterDashNow === '\r') {
      skipNewline(s);
      skipBlankAndCommentLines(s);
      if (!isEof(s) && measureIndent(s) >= itemIndent) {
        while (!isEof(s) && peek(s) === ' ') advance(s);
        const item = parseNode(s, itemIndent, depth + 1);
        items.push(item);
      } else {
        items.push({ kind: 'scalar', value: '', tag: null, anchor: null });
      }
    } else {
      items.push({ kind: 'scalar', value: '', tag: null, anchor: null });
    }
  }

  return node;
}

// ---------------------------------------------------------------------------
// Block mapping (YAML 1.2.2 §8.2.2)
// ---------------------------------------------------------------------------

function parseBlockMap(
  s: TokenizerState,
  mapIndent: number,
  depth: number,
  anchor: string | null,
  tag: string | null,
): YamlNode {
  const pairs: Array<{ key: YamlNode; value: YamlNode }> = [];
  const seenKeys = new Set<string>();
  const node: YamlNode = { kind: 'map', pairs, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);

  while (!isEof(s)) {
    skipBlankAndCommentLines(s);
    if (isEof(s)) break;

    // Stop at document markers (--- or ...) at column 1 — they will be
    // caught by checkNoMultiDoc after the parse returns (Trap 12).
    if (isDocumentMarker(s)) break;

    const col = measureIndent(s);
    if (col < mapIndent) break;
    if (col > mapIndent && pairs.length === 0) {
      // first key at higher indent is fine; set mapIndent
    } else if (col !== mapIndent && pairs.length > 0) {
      break; // subsequent keys must be at same indent
    }

    // Consume spaces to reach key
    while (!isEof(s) && peek(s) === ' ') advance(s);

    // Check again for document marker after consuming spaces
    if (isDocumentMarkerAt(s, s.pos)) break;

    // Complex key check (Trap 16)
    if (peek(s) === '?') {
      const next = peekAt(s, 1);
      if (next === ' ' || next === '\t' || next === '\n' || next === '\r') {
        throw new YamlComplexKeyForbiddenError();
      }
    }

    // Parse key
    const keyNode = parseKeyNode(s);
    const keyStr = nodeToKeyString(keyNode);
    checkMergeKey(keyStr);

    skipInlineWhitespace(s);
    if (isEof(s) || peek(s) !== ':') break;
    advance(s); // consume ':'
    const afterColon = peek(s);
    if (
      afterColon !== ' ' &&
      afterColon !== '\t' &&
      afterColon !== '\n' &&
      afterColon !== '\r' &&
      afterColon !== ''
    ) {
      // Not a valid mapping separator
      break;
    }

    // Duplicate key (Trap 17)
    if (seenKeys.has(keyStr)) throw new YamlDuplicateKeyError(keyStr);
    seenKeys.add(keyStr);
    checkMapCap(pairs.length + 1);

    skipInlineWhitespace(s);

    let valueNode: YamlNode;
    const vCh = peek(s);
    if (isEof(s) || vCh === '\n' || vCh === '\r' || vCh === '#') {
      // Value on next line
      if (!isEof(s) && vCh === '#') skipComment(s);
      if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) skipNewline(s);
      skipBlankAndCommentLines(s);
      const valueIndent = mapIndent + 2;
      if (!isEof(s) && measureIndent(s) >= valueIndent) {
        while (!isEof(s) && peek(s) === ' ') advance(s);
        valueNode = parseNode(s, valueIndent, depth + 1);
      } else {
        valueNode = { kind: 'scalar', value: '', tag: null, anchor: null };
      }
    } else {
      // Inline value
      valueNode = parseNode(s, mapIndent + 2, depth + 1);
      skipInlineWhitespace(s);
      if (!isEof(s) && peek(s) === '#') skipComment(s);
      if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) skipNewline(s);
    }

    pairs.push({ key: keyNode, value: valueNode });
  }

  return node;
}

/**
 * Parse a mapping key node. Only scalar keys allowed (Trap 16).
 */
function parseKeyNode(s: TokenizerState): YamlNode {
  const ch = peek(s);
  if (ch === "'") {
    advance(s);
    return { kind: 'scalar', value: parseSingleQuotedScalar(s), tag: null, anchor: null };
  }
  if (ch === '"') {
    advance(s);
    return { kind: 'scalar', value: parseDoubleQuotedScalar(s), tag: null, anchor: null };
  }
  return { kind: 'scalar', value: parsePlainScalar(s, 1), tag: null, anchor: null };
}

/**
 * Check if current position has a document marker (--- or ...) at column 1.
 * Does not advance.
 */
function isDocumentMarker(s: TokenizerState): boolean {
  // We're at the start of a potential marker line (after skipBlankAndCommentLines).
  // The marker must be at column 1 (no leading spaces consumed yet).
  return isDocumentMarkerAt(s, s.pos);
}

function isDocumentMarkerAt(s: TokenizerState, pos: number): boolean {
  const c0 = s.src[pos] ?? '';
  const c1 = s.src[pos + 1] ?? '';
  const c2 = s.src[pos + 2] ?? '';
  const c3 = s.src[pos + 3] ?? '';
  if (
    c0 === '-' &&
    c1 === '-' &&
    c2 === '-' &&
    (c3 === ' ' || c3 === '\t' || c3 === '\n' || c3 === '\r' || c3 === '')
  ) {
    return true;
  }
  if (c0 === '.' && c1 === '.' && c2 === '.') {
    return true;
  }
  return false;
}

function nodeToKeyString(node: YamlNode): string {
  if (node.kind !== 'scalar') throw new YamlComplexKeyForbiddenError();
  return node.value;
}

// ---------------------------------------------------------------------------
// Flow sequence (YAML 1.2.2 §7.4.2)
// ---------------------------------------------------------------------------

function parseFlowSeq(s: TokenizerState, depth: number, anchor: string | null): YamlNode {
  if (depth > MAX_YAML_DEPTH) throw new YamlDepthExceededError(depth, MAX_YAML_DEPTH);
  advance(s); // consume '['
  s.flowDepth++;

  const items: YamlNode[] = [];
  const node: YamlNode = { kind: 'seq', items, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);

  skipInlineWhitespace(s);
  if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
    skipNewline(s);
    skipBlankAndCommentLines(s);
  }

  while (!isEof(s) && peek(s) !== ']') {
    checkSeqCap(items.length + 1);
    skipInlineWhitespace(s);
    if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
      skipNewline(s);
      skipBlankAndCommentLines(s);
    }
    if (isEof(s) || peek(s) === ']') break;

    const item = parseNode(s, 1, depth + 1);
    items.push(item);

    skipInlineWhitespace(s);
    if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
      skipNewline(s);
      skipBlankAndCommentLines(s);
    }
    if (!isEof(s) && peek(s) === ',') {
      advance(s);
      skipInlineWhitespace(s);
      if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
        skipNewline(s);
        skipBlankAndCommentLines(s);
      }
    }
  }

  if (isEof(s)) throw errAt(s, 'Unterminated flow sequence');
  advance(s); // consume ']'
  s.flowDepth--;
  return node;
}

// ---------------------------------------------------------------------------
// Flow mapping (YAML 1.2.2 §7.4.1)
// ---------------------------------------------------------------------------

function parseFlowMap(s: TokenizerState, depth: number, anchor: string | null): YamlNode {
  if (depth > MAX_YAML_DEPTH) throw new YamlDepthExceededError(depth, MAX_YAML_DEPTH);
  advance(s); // consume '{'
  s.flowDepth++;

  const pairs: Array<{ key: YamlNode; value: YamlNode }> = [];
  const seenKeys = new Set<string>();
  const node: YamlNode = { kind: 'map', pairs, anchor };
  if (anchor !== null) registerAnchor(s, anchor, node);

  skipInlineWhitespace(s);
  if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
    skipNewline(s);
    skipBlankAndCommentLines(s);
  }

  while (!isEof(s) && peek(s) !== '}') {
    checkMapCap(pairs.length + 1);
    skipInlineWhitespace(s);
    if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
      skipNewline(s);
      skipBlankAndCommentLines(s);
    }
    if (isEof(s) || peek(s) === '}') break;

    const keyNode = parseNode(s, 1, depth + 1);
    const keyStr = nodeToKeyString(keyNode);
    checkMergeKey(keyStr);

    skipInlineWhitespace(s);
    if (isEof(s) || peek(s) !== ':') throw errAt(s, "Expected ':' after key in flow mapping");
    advance(s); // ':'
    skipInlineWhitespace(s);
    if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
      skipNewline(s);
      skipBlankAndCommentLines(s);
    }

    if (seenKeys.has(keyStr)) throw new YamlDuplicateKeyError(keyStr);
    seenKeys.add(keyStr);

    const valueNode = parseNode(s, 1, depth + 1);
    pairs.push({ key: keyNode, value: valueNode });

    skipInlineWhitespace(s);
    if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
      skipNewline(s);
      skipBlankAndCommentLines(s);
    }
    if (!isEof(s) && peek(s) === ',') {
      advance(s);
      skipInlineWhitespace(s);
      if (!isEof(s) && (peek(s) === '\n' || peek(s) === '\r')) {
        skipNewline(s);
        skipBlankAndCommentLines(s);
      }
    }
  }

  if (isEof(s)) throw errAt(s, 'Unterminated flow mapping');
  advance(s); // consume '}'
  s.flowDepth--;
  return node;
}

// ---------------------------------------------------------------------------
// Phase 4: Alias expansion + cycle detection + cap enforcement
// ---------------------------------------------------------------------------

interface ExpandState {
  expansions: number;
}

/**
 * Expand alias nodes into resolved YamlValue.
 * DFS with per-resolution cycle detection set (Trap 1).
 * Tracks total expansions (Trap 2 — billion-laughs cap).
 */
function expandNode(
  node: YamlNode,
  anchors: Map<string, YamlNode>,
  resolving: Set<string>,
  state: ExpandState,
): YamlValue {
  if (node.kind === 'alias') {
    const name = node.name;
    if (resolving.has(name)) throw new YamlAnchorCycleError(name);
    const target = anchors.get(name);
    if (target === undefined) throw new YamlAnchorUndefinedError(name);

    state.expansions++;
    if (state.expansions > MAX_YAML_ALIASES) {
      throw new YamlAliasLimitError(state.expansions, MAX_YAML_ALIASES);
    }

    resolving.add(name);
    const expanded = expandNode(target, anchors, resolving, state);
    resolving.delete(name);
    return expanded;
  }

  if (node.kind === 'scalar') {
    return applyTag(node.tag, node.value);
  }

  if (node.kind === 'seq') {
    const arr: YamlValue[] = [];
    for (const item of node.items) {
      arr.push(expandNode(item, anchors, resolving, state));
    }
    return arr;
  }

  // map
  const obj: { [key: string]: YamlValue } = Object.create(null) as { [key: string]: YamlValue };
  for (const { key, value } of node.pairs) {
    if (key.kind !== 'scalar') throw new YamlComplexKeyForbiddenError();
    obj[key.value] = expandNode(value, anchors, resolving, state);
  }
  return obj;
}

/** Apply an explicit tag override to a scalar value. */
function applyTag(tag: string | null, raw: string): YamlValue {
  if (tag === null) return classifyPlainScalar(raw);
  switch (tag) {
    case '!!str':
      return raw;
    case '!!null':
      return null;
    case '!!bool': {
      if (BOOL_TRUE_RE.test(raw)) return true;
      if (BOOL_FALSE_RE.test(raw)) return false;
      return raw === '' ? null : raw;
    }
    case '!!int': {
      // Validate before coercion: strip optional leading '+', then must match Core Schema int
      const intRaw = raw.startsWith('+') ? raw.slice(1) : raw;
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(intRaw)) {
        throw new YamlParseError(
          `!!int tag applied to non-integer scalar: "${raw}"`,
          0,
          0,
          raw.slice(0, 40),
        );
      }
      return BigInt(intRaw);
    }
    case '!!float': {
      // Accept .nan / .inf / -.inf / +.inf (case-insensitive) and decimal/exponent forms
      const floatLower = raw.toLowerCase();
      if (floatLower === '.nan') return Number.NaN;
      if (floatLower === '.inf' || floatLower === '+.inf') return Number.POSITIVE_INFINITY;
      if (floatLower === '-.inf') return Number.NEGATIVE_INFINITY;
      if (!FLOAT_RE.test(raw)) {
        throw new YamlParseError(
          `!!float tag applied to non-float scalar: "${raw}"`,
          0,
          0,
          raw.slice(0, 40),
        );
      }
      return Number.parseFloat(raw);
    }
    default:
      return classifyPlainScalar(raw);
  }
}

// ---------------------------------------------------------------------------
// Public parse API
// ---------------------------------------------------------------------------

/**
 * Parse a YAML 1.2 document from bytes or a string.
 *
 * Pipeline:
 *   Phase 1: UTF-8 decode + BOM detection (decodeInput)
 *   Phase 2: Directive + marker scan (scanDirectivesAndMarker)
 *   Phase 3: Recursive-descent parse → YamlNode AST
 *   Phase 4: Alias expansion + cycle check + cap enforcement
 */
export function parseYaml(input: Uint8Array | string): YamlFile {
  // Phase 1: UTF-8 decode + BOM gate
  // Also reject non-UTF-8 BOMs before decodeInput strips them (Trap 11)
  if (input instanceof Uint8Array) {
    const b0 = input[0] ?? 0;
    const b1 = input[1] ?? 0;
    const b2 = input[2] ?? 0;
    const b3 = input[3] ?? 0;
    // UTF-16 BE: FE FF
    if (b0 === 0xfe && b1 === 0xff) {
      throw new YamlInvalidUtf8Error('UTF-16 BE BOM detected. Only UTF-8 is supported.');
    }
    // UTF-16 LE: FF FE (not followed by 00 00 which would be UTF-32)
    if (b0 === 0xff && b1 === 0xfe && !(b2 === 0x00 && b3 === 0x00)) {
      throw new YamlInvalidUtf8Error('UTF-16 LE BOM detected. Only UTF-8 is supported.');
    }
    // UTF-32 BE: 00 00 FE FF
    if (b0 === 0x00 && b1 === 0x00 && b2 === 0xfe && b3 === 0xff) {
      throw new YamlInvalidUtf8Error('UTF-32 BE BOM detected. Only UTF-8 is supported.');
    }
    // UTF-32 LE: FF FE 00 00
    if (b0 === 0xff && b1 === 0xfe && b2 === 0x00 && b3 === 0x00) {
      throw new YamlInvalidUtf8Error('UTF-32 LE BOM detected. Only UTF-8 is supported.');
    }
  }

  const { text, hadBom } = decodeInput(input, 'YAML', (cause) => new YamlInvalidUtf8Error(cause));

  // Phase 2: directive + marker scan
  const s = mkState(text);
  const { hadDirectivesEndMarker, hadYamlDirective } = scanDirectivesAndMarker(s);

  // Phase 3: parse document body
  skipBlankAndCommentLines(s);

  let rootNode: YamlNode;
  if (isEof(s)) {
    // Empty document → implicit null (Trap 14)
    rootNode = { kind: 'scalar', value: '', tag: null, anchor: null };
  } else {
    // Consume any leading spaces then parse
    while (!isEof(s) && peek(s) === ' ') advance(s);
    rootNode = parseNode(s, 1, 0);
  }

  // Phase 4: alias expansion, cycle detection, cap enforcement
  const expandState: ExpandState = { expansions: 0 };
  const value = expandNode(rootNode, s.anchors, new Set<string>(), expandState);

  // Check for trailing multi-doc markers / garbage (Traps 12, 15)
  checkNoMultiDoc(s);

  return {
    value,
    hadBom,
    hadDirectivesEndMarker,
    hadYamlDirective,
  };
}
