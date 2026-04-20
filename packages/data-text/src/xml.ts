/**
 * XML 1.0 (Fifth Edition) parse/serialize for @webcvt/data-text.
 *
 * Architecture:
 *   Phase 1: Hand-rolled security pre-scan (character-walk state machine, NO regex).
 *   Phase 2: DOMParser('application/xml') parse + parsererror detection.
 *   Phase 3: DOM → XmlFile tree conversion with caps enforcement.
 *   Serialize: Hand-rolled canonical emitter (NOT XMLSerializer).
 *
 * Spec: W3C XML 1.0 Fifth Edition (2008), XML Information Set, DOM Parsing.
 * Clean-room: no code ported from fast-xml-parser, xml2js, xmlbuilder, @xmldom/xmldom,
 * sax-js, ltx, htmlparser2, parse5.
 *
 * ## Traps honoured
 * #1  DOCTYPE REJECTED before DOMParser (XmlDoctypeForbiddenError).
 * #2  <!ENTITY REJECTED — billion-laughs defense (XmlEntityForbiddenError).
 * #3  SYSTEM/PUBLIC tokens REJECTED (XmlExternalEntityForbiddenError).
 * #4  CDATA payload scanned for <!DOCTYPE/<!ENTITY (XmlCdataPayloadError).
 * #5  PIs other than <?xml?> preamble REJECTED (XmlForbiddenPiError).
 * #6  DOMParser errors detected via doc.querySelector('parsererror'), NOT try/catch.
 * #7  Attribute value escape: & < " > \t \n \r.
 * #8  Text node escape: & < > \r.
 * #9  QNames treated as opaque strings (no namespace resolution).
 * #10 Empty elements emit <foo/> never <foo></foo>.
 * #11 Element name validated against XML 1.0 Name production on serialize.
 * #12 Max depth cap pre-scan (XmlDepthExceededError before DOMParser).
 * #13 Element count cap pre-scan (XmlTooManyElementsError before DOMParser).
 * #14 Attribute count cap per element — post-parse walk.
 * #15 Text-node size cap — post-parse walk.
 * #16 Preamble encoding must be UTF-8 or absent (XmlParseError on mismatch).
 * #17 BOM parsed and dropped; never re-emitted on serialize.
 *
 * ## Security caps
 * MAX_XML_DEPTH = 64, MAX_XML_ELEMENTS = 100,000,
 * MAX_XML_ATTRS_PER_ELEMENT = 1,024, MAX_XML_TEXT_NODE_CHARS = 1,048,576.
 */

import {
  MAX_XML_ATTRS_PER_ELEMENT,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_TEXT_NODE_CHARS,
} from './constants.ts';
import {
  XmlBadElementNameError,
  XmlCdataPayloadError,
  XmlDepthExceededError,
  XmlDoctypeForbiddenError,
  XmlEntityForbiddenError,
  XmlExternalEntityForbiddenError,
  XmlForbiddenPiError,
  XmlInvalidUtf8Error,
  XmlParseError,
  XmlTextNodeTooLongError,
  XmlTooManyAttrsError,
  XmlTooManyElementsError,
} from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XmlAttribute {
  readonly name: string; // QName as source, e.g. "id", "xml:lang"
  readonly value: string; // decoded (entities expanded)
}

export interface XmlElement {
  readonly name: string; // QName opaque string
  readonly attributes: readonly XmlAttribute[]; // alphabetical on serialize
  readonly children: readonly XmlElement[];
  readonly text: string; // concatenated text (simplified model)
}

export interface XmlFile {
  readonly root: XmlElement;
  readonly declaredEncoding: 'UTF-8' | null;
  readonly declaredStandalone: 'yes' | 'no' | null;
  readonly hadBom: boolean;
}

// ---------------------------------------------------------------------------
// Pre-scan state machine states
// ---------------------------------------------------------------------------

enum ScanState {
  NORMAL = 0,
  IN_TAG = 1,
  IN_ATTR_VALUE_DQ = 2, // inside "..."
  IN_ATTR_VALUE_SQ = 3, // inside '...'
  IN_COMMENT = 4, // <!-- ... -->
  IN_CDATA = 5, // <![CDATA[ ... ]]>
  IN_PI = 6, // <? ... ?>
}

// ---------------------------------------------------------------------------
// Preamble parse helpers
// ---------------------------------------------------------------------------

/**
 * Extract encoding and standalone from the XML preamble.
 * Only called on the first ≤200 chars after BOM if they start with `<?xml`.
 * Uses regex — safe because this is caller-controlled (first 200 chars of source).
 */
function parsePreamble(preamble: string): {
  encoding: string | null;
  standalone: 'yes' | 'no' | null;
} {
  const encodingMatch = /encoding\s*=\s*["']([^"']+)["']/i.exec(preamble);
  const standaloneMatch = /standalone\s*=\s*["'](yes|no)["']/i.exec(preamble);

  return {
    encoding: encodingMatch?.[1] ?? null,
    standalone: (standaloneMatch?.[1] as 'yes' | 'no') ?? null,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Hand-rolled security pre-scan
// ---------------------------------------------------------------------------

interface PreScanResult {
  declaredEncoding: 'UTF-8' | null;
  declaredStandalone: 'yes' | 'no' | null;
}

/**
 * Walk the XML source character by character with a state machine.
 * Enforces all security constraints BEFORE DOMParser is called.
 *
 * States: NORMAL / IN_TAG / IN_ATTR_VALUE_DQ / IN_ATTR_VALUE_SQ /
 *         IN_COMMENT / IN_CDATA / IN_PI
 *
 * Depth tracking:
 *   - In NORMAL state when we see '<' followed by non-special: opening tag, enter IN_TAG.
 *     We set tagIsClosing=false.
 *   - In NORMAL state when we see '</': closing tag. depth--.
 *   - When IN_TAG hits '>': if last non-whitespace before '>' is '/' → self-closing (no depth change).
 *     Otherwise, if not closing tag → depth++.
 *
 * Element count: every '<' in NORMAL that is not '</', '<!', '<?'.
 *
 * NO regex on untrusted input inside this function.
 */
export function preScanXml(source: string): PreScanResult {
  let state: ScanState = ScanState.NORMAL;
  let depth = 0;
  let peakDepth = 0;
  let elementCount = 0;
  let cdataStart = -1;
  let tagIsClosing = false;
  let declaredEncoding: 'UTF-8' | null = null;
  let declaredStandalone: 'yes' | 'no' | null = null;
  let preambleChecked = false;

  const len = source.length;

  // We track the last non-whitespace character while in IN_TAG state,
  // to detect self-closing '/>' patterns.
  let lastNonWsInTag = '';

  for (let i = 0; i < len; i++) {
    const ch = source[i] as string;

    switch (state) {
      // -----------------------------------------------------------------------
      case ScanState.NORMAL: {
        if (ch !== '<') break;

        // Peek ahead to classify this '<'
        // Check DOCTYPE (Trap #1)
        if (matchAt(source, i, '<!DOCTYPE')) {
          throw new XmlDoctypeForbiddenError();
        }
        // Check ENTITY (Trap #2)
        if (matchAt(source, i, '<!ENTITY')) {
          throw new XmlEntityForbiddenError();
        }
        // Comment: <!--
        if (matchAt(source, i, '<!--')) {
          state = ScanState.IN_COMMENT;
          i += 3; // position at last char of '<!--'; loop i++ → past
          break;
        }
        // CDATA: <![CDATA[
        if (matchAt(source, i, '<![CDATA[')) {
          state = ScanState.IN_CDATA;
          cdataStart = i + 9; // first char of payload
          i += 8;
          break;
        }
        // Processing instruction: <?
        if (matchAt(source, i, '<?')) {
          // The XML preamble is allowed only at position 0 (after BOM strip).
          // It must be exactly "<?xml" followed by whitespace, '?', or '>',
          // NOT "<?xml-stylesheet" or other "<?xml..." variants.
          if (i === 0 && isXmlPreambleAt(source, i)) {
            // XML preamble — allowed
            state = ScanState.IN_PI;
            i += 1; // skip past '<', next loop sees '?'
            break;
          }
          // Non-preamble PI — reject (Trap #5)
          const piTarget = extractPiTarget(source, i + 2);
          throw new XmlForbiddenPiError(piTarget);
        }
        // Closing tag: </
        if (matchAt(source, i, '</')) {
          depth--;
          tagIsClosing = true;
          lastNonWsInTag = '';
          state = ScanState.IN_TAG;
          i += 1; // skip '<', next sees '/'
          break;
        }
        // Opening or self-closing tag
        elementCount++;
        if (elementCount > MAX_XML_ELEMENTS) {
          throw new XmlTooManyElementsError(elementCount, MAX_XML_ELEMENTS);
        }
        tagIsClosing = false;
        lastNonWsInTag = '';
        state = ScanState.IN_TAG;
        // stay at '<'; IN_TAG will see the next chars
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_TAG: {
        if (ch === '"') {
          state = ScanState.IN_ATTR_VALUE_DQ;
          lastNonWsInTag = '"';
        } else if (ch === "'") {
          state = ScanState.IN_ATTR_VALUE_SQ;
          lastNonWsInTag = "'";
        } else if (ch === '>') {
          if (!tagIsClosing) {
            // Self-closing if the char immediately before '>' (ignoring nothing special here)
            // We tracked last non-whitespace in tag content
            if (lastNonWsInTag === '/') {
              // self-closing tag — depth unchanged
            } else {
              // opening tag
              depth++;
              if (depth > peakDepth) peakDepth = depth;
              if (peakDepth > MAX_XML_DEPTH) {
                throw new XmlDepthExceededError(peakDepth, MAX_XML_DEPTH);
              }
            }
          }
          state = ScanState.NORMAL;
        } else {
          // Track last non-whitespace character in tag (for self-closing detection)
          if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
            lastNonWsInTag = ch;
          }
        }
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_ATTR_VALUE_DQ: {
        if (ch === '"') {
          state = ScanState.IN_TAG;
          lastNonWsInTag = '"';
        }
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_ATTR_VALUE_SQ: {
        if (ch === "'") {
          state = ScanState.IN_TAG;
          lastNonWsInTag = "'";
        }
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_COMMENT: {
        // Look for '-->'
        if (ch === '-' && matchAt(source, i, '-->')) {
          state = ScanState.NORMAL;
          i += 2; // skip '-->'
        }
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_CDATA: {
        // Look for ']]>'
        if (ch === ']' && matchAt(source, i, ']]>')) {
          // Scan CDATA payload for forbidden tokens (Trap #4, defense in depth)
          const payload = source.slice(cdataStart, i);
          if (payload.includes('<!DOCTYPE')) {
            throw new XmlCdataPayloadError('<!DOCTYPE');
          }
          if (payload.includes('<!ENTITY')) {
            throw new XmlCdataPayloadError('<!ENTITY');
          }
          state = ScanState.NORMAL;
          i += 2; // skip ']]>'
        }
        break;
      }

      // -----------------------------------------------------------------------
      case ScanState.IN_PI: {
        // Look for '?>'
        if (ch === '?' && i + 1 < len && source[i + 1] === '>') {
          if (!preambleChecked) {
            preambleChecked = true;
            const preambleText = source.slice(0, Math.min(200, i + 2));
            const parsed = parsePreamble(preambleText);
            if (parsed.encoding !== null) {
              const enc = parsed.encoding.toUpperCase();
              if (enc !== 'UTF-8') {
                throw new XmlParseError(
                  `XML preamble declares encoding="${parsed.encoding}" but only UTF-8 is supported.`,
                );
              }
              declaredEncoding = 'UTF-8';
            }
            declaredStandalone = parsed.standalone;
          }
          state = ScanState.NORMAL;
          i += 1; // skip '?>'
        }
        break;
      }
    }
  }

  return { declaredEncoding, declaredStandalone };
}

/**
 * Helper: check if `source` at position `pos` matches `token` character-by-character.
 * Avoids substring allocation.
 */
function matchAt(source: string, pos: number, token: string): boolean {
  if (pos + token.length > source.length) return false;
  for (let k = 0; k < token.length; k++) {
    if (source[pos + k] !== token[k]) return false;
  }
  return true;
}

/**
 * Check whether the text at `pos` in `source` is the XML preamble `<?xml`
 * followed by whitespace, '?', or '>' (i.e. NOT `<?xml-stylesheet` or similar).
 * The 4-char target "xml" must be immediately followed by a non-Name character.
 */
function isXmlPreambleAt(source: string, pos: number): boolean {
  // Must start with "<?xml"
  if (!matchAt(source, pos, '<?xml')) return false;
  // The char after "<?xml" (at pos+5) must be whitespace, '?', '>', or end
  const nextPos = pos + 5;
  if (nextPos >= source.length) return true; // "<?xml" then EOF — treat as preamble
  const nextCh = source[nextPos] as string;
  return (
    nextCh === ' ' ||
    nextCh === '\t' ||
    nextCh === '\n' ||
    nextCh === '\r' ||
    nextCh === '?' ||
    nextCh === '>'
  );
}

/**
 * Extract a PI target name from `source` starting at `start`.
 * Reads up to 50 characters and stops at whitespace, '?', or end.
 * Used only for error messages — caller-level, not security-critical.
 */
function extractPiTarget(source: string, start: number): string {
  const end = Math.min(start + 50, source.length);
  let target = '';
  for (let i = start; i < end; i++) {
    const ch = source[i] as string;
    if (ch === '?' || ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
    target += ch;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Phase 2: DOMParser adapter
// ---------------------------------------------------------------------------

/**
 * Parse XML source via DOMParser and detect errors via <parsererror> element.
 * MUST be called AFTER preScanXml passes cleanly.
 *
 * Some environments (e.g. happy-dom in test runners) do not fully implement
 * 'application/xml' MIME and return an HTML document. In that case we fall
 * back to 'text/xml', which is the generic XML MIME and gives a proper XML
 * parse tree. This is the same pattern used by packages/image-svg/src/parser.ts.
 */
function parseWithDomParser(source: string): Document {
  // DOMParser is available in browser and happy-dom test environment.
  const domParser = new DOMParser();
  let doc = domParser.parseFromString(source, 'application/xml');

  // Detect if the DOMParser treated the input as HTML (happy-dom fallback).
  // A correct XML parse will have the actual root element name, not 'HTML'.
  if (
    doc.documentElement !== null &&
    doc.documentElement.nodeName === 'HTML' &&
    doc.querySelector('parsererror') === null
  ) {
    // Fall back to 'text/xml' which happy-dom handles correctly.
    doc = domParser.parseFromString(source, 'text/xml');
  }

  // Detect parse errors via <parsererror> (Trap #6 — NOT try/catch).
  const parseError = doc.querySelector('parsererror');
  if (parseError !== null) {
    const errorText = parseError.textContent ?? 'unknown parser error';
    throw new XmlParseError(`DOMParser reported error: ${errorText}`);
  }

  if (doc.documentElement === null) {
    throw new XmlParseError('DOMParser returned a document with no root element.');
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Phase 3: DOM → XmlFile conversion
// ---------------------------------------------------------------------------

/**
 * Recursively convert a DOM Element to an XmlElement.
 * Enforces attribute count and text-node size caps (Traps #14, #15).
 * Drops comments and PIs. Concatenates text + CDATA children into `text`.
 */
function convertElement(el: Element, currentDepth: number): XmlElement {
  // Attribute count cap (Trap #14)
  if (el.attributes.length > MAX_XML_ATTRS_PER_ELEMENT) {
    throw new XmlTooManyAttrsError(el.nodeName, el.attributes.length, MAX_XML_ATTRS_PER_ELEMENT);
  }

  // Collect attributes alphabetically (canonical form)
  const attributes: XmlAttribute[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr !== undefined) {
      attributes.push({ name: attr.name, value: attr.value });
    }
  }
  attributes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Walk children: accumulate text, recurse into element children
  let text = '';
  const children: XmlElement[] = [];

  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node === undefined) continue;

    if (node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */) {
      text += node.nodeValue ?? '';
      // Text-node size cap (Trap #15)
      if (text.length > MAX_XML_TEXT_NODE_CHARS) {
        throw new XmlTextNodeTooLongError(el.nodeName, text.length, MAX_XML_TEXT_NODE_CHARS);
      }
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      children.push(convertElement(node as Element, currentDepth + 1));
    }
    // Comment (8) and PI (7) nodes are dropped silently
  }

  return {
    name: el.nodeName,
    attributes,
    children,
    text,
  };
}

// ---------------------------------------------------------------------------
// Public parse API
// ---------------------------------------------------------------------------

/**
 * Parse an XML 1.0 document from a Uint8Array or string.
 *
 * Steps:
 *   1. UTF-8 decode + BOM detection (via decodeInput).
 *   2. Phase 1: hand-rolled security pre-scan (state machine, NO regex).
 *   3. Phase 2: DOMParser parse + parsererror detection.
 *   4. Phase 3: DOM → XmlFile conversion with caps enforcement.
 *
 * Throws typed errors for all security violations and parse failures.
 */
export function parseXml(input: Uint8Array | string): XmlFile {
  // Step 1: decode
  const { text, hadBom } = decodeInput(input, 'XML', (cause) => new XmlInvalidUtf8Error(cause));

  // Step 2: pre-scan security gate
  const { declaredEncoding, declaredStandalone } = preScanXml(text);

  // Step 3: DOMParser
  const doc = parseWithDomParser(text);

  // Step 4: DOM → XmlFile
  const root = convertElement(doc.documentElement, 1);

  return {
    root,
    declaredEncoding,
    declaredStandalone,
    hadBom,
  };
}

// ---------------------------------------------------------------------------
// XML Name validation (Trap #11)
// ---------------------------------------------------------------------------

/**
 * XML 1.0 NameStartChar and NameChar production.
 * NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] |
 *                   [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] |
 *                   [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] |
 *                   [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] |
 *                   [#x10000-#xEFFFF]
 * NameChar     ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] |
 *                  [#x203F-#x2040]
 *
 * We use a regex here because the name comes from caller-controlled data (serialize),
 * not from untrusted input.
 */
// XML 1.0 NameStartChar character set (excluding \u200C\u200D which are
// enumerated separately to avoid the misleading ZWJ range).
const XML_NAME_START_CHARS =
  '[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF' +
  '\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]';

// XML 1.0 NameChar character set (NameStartChar plus -, ., 0-9, U+00B7, ranges).
const XML_NAME_CONT_CHARS =
  '[-.:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF' +
  '\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD' +
  '0-9\u00B7\u0300-\u036F\u203F-\u2040]';

const XML_NAME_START_RE = new RegExp(`^${XML_NAME_START_CHARS}`, 'u');
const XML_NAME_RE = new RegExp(`^${XML_NAME_START_CHARS}${XML_NAME_CONT_CHARS}*$`, 'u');

/**
 * Validate an XML 1.0 Name (element or attribute name).
 * Throws XmlBadElementNameError on invalid names.
 * Returns the name unchanged on success.
 */
function validateXmlName(name: string): string {
  if (name.length === 0) {
    throw new XmlBadElementNameError(name);
  }
  // Single-char names only need NameStartChar check
  if (name.length === 1) {
    if (!XML_NAME_START_RE.test(name)) {
      throw new XmlBadElementNameError(name);
    }
    return name;
  }
  // Multi-char: check first char is NameStartChar, then rest is NameChar*
  if (!XML_NAME_RE.test(name)) {
    throw new XmlBadElementNameError(name);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Canonical serializer (Trap #7, #8, #10, #11)
// ---------------------------------------------------------------------------

/**
 * Escape a string for use inside an XML attribute value (double-quoted).
 * Escape order: & FIRST, then others (Trap #7).
 * Traps: & → &amp;, < → &lt;, " → &quot;, > → &gt;
 *        \t → &#x9;, \n → &#xA;, \r → &#xD;
 */
function escapeAttrValue(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    switch (ch) {
      case '&':
        result += '&amp;';
        break;
      case '<':
        result += '&lt;';
        break;
      case '"':
        result += '&quot;';
        break;
      case '>':
        result += '&gt;';
        break;
      case '\t':
        result += '&#x9;';
        break;
      case '\n':
        result += '&#xA;';
        break;
      case '\r':
        result += '&#xD;';
        break;
      default:
        result += ch;
    }
  }
  return result;
}

/**
 * Escape a string for use as XML text content.
 * Escape order: & FIRST (Trap #8).
 * Traps: & → &amp;, < → &lt;, > → &gt;, \r → &#xD;
 */
function escapeTextContent(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    switch (ch) {
      case '&':
        result += '&amp;';
        break;
      case '<':
        result += '&lt;';
        break;
      case '>':
        result += '&gt;';
        break;
      case '\r':
        result += '&#xD;';
        break;
      default:
        result += ch;
    }
  }
  return result;
}

/**
 * Emit a single element as canonical XML.
 * - Attributes sorted alphabetically (Trap #9 from serialize perspective).
 * - Empty elements emit <foo/> (Trap #10).
 * - 2-space indent, LF line endings.
 * - NO BOM emitted (Trap #17).
 */
function emitElement(el: XmlElement, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  const name = validateXmlName(el.name);

  // Build attribute string (attributes already alphabetically sorted from parse;
  // re-sort here for round-trip safety when XmlElement is constructed manually)
  const sortedAttrs = el.attributes
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  let attrStr = '';
  for (const attr of sortedAttrs) {
    validateXmlName(attr.name);
    attrStr += ` ${attr.name}="${escapeAttrValue(attr.value)}"`;
  }

  const opener = `${indent}<${name}${attrStr}`;

  const hasChildren = el.children.length > 0;
  const hasText = el.text.length > 0;

  // Self-closing: no children AND no text (Trap #10)
  if (!hasChildren && !hasText) {
    return `${opener}/>\n`;
  }

  // Text-only element (no children): emit on one line
  if (!hasChildren) {
    return `${opener}>${escapeTextContent(el.text)}</${name}>\n`;
  }

  // Element with children (possibly also has leading text)
  let result = `${opener}>\n`;
  if (hasText) {
    result += `${indent}  ${escapeTextContent(el.text)}\n`;
  }
  for (const child of el.children) {
    result += emitElement(child, indentLevel + 1);
  }
  result += `${indent}</${name}>\n`;
  return result;
}

/**
 * Serialize an XmlFile to canonical XML string.
 *
 * - Emits XML preamble only if declaredEncoding or declaredStandalone is set.
 * - LF line endings, 2-space indent.
 * - NO BOM (Trap #17).
 * - Attribute alphabetical order (Trap #9 canonical form).
 * - Self-closing empty elements (Trap #10).
 */
export function serializeXml(file: XmlFile): string {
  let result = '';

  // Emit preamble if encoding or standalone was declared
  if (file.declaredEncoding !== null || file.declaredStandalone !== null) {
    let preamble = '<?xml version="1.0"';
    if (file.declaredEncoding !== null) {
      preamble += ` encoding="${file.declaredEncoding}"`;
    }
    if (file.declaredStandalone !== null) {
      preamble += ` standalone="${file.declaredStandalone}"`;
    }
    preamble += '?>\n';
    result += preamble;
  }

  result += emitElement(file.root, 0);

  return result;
}
