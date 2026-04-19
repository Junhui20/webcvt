/**
 * SVG demuxer: decode → security-validate → DOMParser → extract metadata.
 *
 * Implements the "Demuxer (read) algorithm" from the design note §"Demuxer":
 *  1. Coerce input to UTF-8 string (fatal mode).
 *  2. Reject if size exceeds MAX_SVG_INPUT_BYTES.
 *  3. Run string-based security reject pass (validator.ts) — BEFORE DOMParser.
 *  4. Scan first 1 KiB for `<svg` root signal.
 *  5. Parse via DOMParser.
 *  6. Validate namespace and root localName.
 *  7. Extract viewBox, width, height.
 */

import { MAX_SVG_INPUT_BYTES, SVG_NAMESPACE } from './constants.ts';
import { SvgInputTooLargeError, SvgParseError } from './errors.ts';
import { validateSvgSecurity } from './validator.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgFile {
  /** Original XML source, UTF-8. Never mutated. */
  readonly source: string;
  /** Parsed viewBox if present and well-formed. */
  readonly viewBox?: ViewBox;
  /** Pixel width attribute on root <svg>, if present and unitless / px. */
  readonly width?: number;
  /** Pixel height attribute on root <svg>, if present and unitless / px. */
  readonly height?: number;
  /** Always 'http://www.w3.org/2000/svg' if validation passed. */
  readonly xmlns: string;
}

// ---------------------------------------------------------------------------
// Module-level reusable decoder — fatal mode rejects malformed UTF-8 sequences.
// ---------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------------------
// Pixel dimension attribute parsing
// ---------------------------------------------------------------------------

/**
 * Parse a root `<svg>` width or height attribute to a pixel number.
 *
 * Accepts:
 *  - bare integer:   "100"
 *  - bare decimal:   "100.5"
 *  - integer + px:   "100px"
 *  - decimal + px:   "100.5px"
 *
 * Rejects (returns undefined):
 *  - percentage:  "50%"
 *  - em/rem/vw/vh and other relative units
 *  - empty string or missing attribute
 */
function parseDimension(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;

  // Strip optional trailing 'px' (case-insensitive to match real-world SVGs).
  const trimmed = value.trim().replace(/px$/i, '');

  // Reject anything that still contains a non-numeric character (unit remnant).
  if (/[^0-9.\-]/.test(trimmed)) return undefined;

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;

  return n;
}

// ---------------------------------------------------------------------------
// viewBox attribute parsing
// ---------------------------------------------------------------------------

/**
 * Parse an SVG viewBox attribute string to a `ViewBox` object.
 *
 * Expects four whitespace/comma-separated finite numeric tokens.
 * Returns `undefined` if the attribute is missing, malformed, or has
 * NaN / non-finite values.
 */
function parseViewBox(value: string | null): ViewBox | undefined {
  if (value === null) return undefined;

  const tokens = value
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (tokens.length !== 4) return undefined;

  const nums = tokens.map((t) => Number(t));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;

  const [minX, minY, width, height] = nums as [number, number, number, number];
  return { minX, minY, width, height };
}

// ---------------------------------------------------------------------------
// SVG root element scanner
// ---------------------------------------------------------------------------

/**
 * Scan the first 1 KiB of source for a `<svg` token that is preceded only
 * by whitespace, an XML declaration, or XML/HTML comments.
 *
 * Returns `true` if the document looks like a valid SVG root.
 * This is a lightweight pre-check before the full DOMParser invocation.
 */
function hasSvgRootSignal(source: string): boolean {
  const head = source.slice(0, 1024);

  // Strip BOM if present.
  const stripped = head.replace(/^\uFEFF/, '');

  // Strip XML declaration: <?xml ... ?>
  const afterXml = stripped.replace(/^<\?xml[^?]*\?>\s*/i, '');

  // Strip leading XML/HTML comments: <!-- ... -->
  const afterComments = afterXml.replace(/^(<!--[\s\S]*?-->\s*)*/g, '');

  // After all preamble, the first non-whitespace tag must start with `<svg`.
  const trimmed = afterComments.trimStart();
  return trimmed.startsWith('<svg') || trimmed.startsWith('<SVG');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether a byte array or string looks like an SVG document.
 * Lightweight — does NOT invoke DOMParser.
 */
export function detectSvg(input: Uint8Array | string): boolean {
  let source: string;
  try {
    source = input instanceof Uint8Array ? UTF8_DECODER.decode(input) : input;
  } catch {
    return false;
  }
  // Quick size guard — avoid processing huge inputs in detect.
  if (source.length > MAX_SVG_INPUT_BYTES) return false;
  return hasSvgRootSignal(source);
}

/**
 * Fully parse and validate an SVG document.
 *
 * Steps:
 *  1. Decode to UTF-8 string (fatal mode).
 *  2. Reject if byte length > MAX_SVG_INPUT_BYTES.
 *  3. Run string-based security reject pass (BEFORE DOMParser).
 *  4. Check for `<svg` root signal in first 1 KiB.
 *  5. Parse via DOMParser.
 *  6. Validate namespace + localName.
 *  7. Extract viewBox, width, height.
 *
 * Throws:
 *  - `SvgInputTooLargeError` — input exceeds 10 MiB.
 *  - `SvgUnsafeContentError` — security reject pass hit.
 *  - `SvgParseError` — DOMParser error, wrong namespace, or bad root.
 */
export function parseSvg(input: Uint8Array | string): SvgFile {
  // Step 1: decode.
  let source: string;
  if (input instanceof Uint8Array) {
    // Step 2: size check on raw bytes.
    if (input.byteLength > MAX_SVG_INPUT_BYTES) {
      throw new SvgInputTooLargeError(input.byteLength, MAX_SVG_INPUT_BYTES);
    }
    try {
      source = UTF8_DECODER.decode(input);
    } catch (err) {
      throw new SvgParseError(`Malformed UTF-8 byte sequence: ${String(err)}`);
    }
  } else {
    source = input;
    // Step 2: size check on string character count (conservative — UTF-8 bytes >= chars).
    if (source.length > MAX_SVG_INPUT_BYTES) {
      throw new SvgInputTooLargeError(source.length, MAX_SVG_INPUT_BYTES);
    }
  }

  // Step 3: string-based security reject pass — MUST run BEFORE DOMParser.
  validateSvgSecurity(source);

  // Step 4: lightweight root signal check.
  if (!hasSvgRootSignal(source)) {
    throw new SvgParseError(
      'Document does not appear to be an SVG (no <svg root element in first 1 KiB).',
    );
  }

  // Step 5: parse via DOMParser.
  // Preferred MIME is 'image/svg+xml' (full SVG namespace awareness).
  // Some environments (e.g. happy-dom test runners) do not implement this MIME
  // and return null documentElement. In that case we fall back to 'text/xml'
  // which is the generic XML parser and still gives us a namespaced SVG tree.
  const domParser = new DOMParser();
  let doc = domParser.parseFromString(source, 'image/svg+xml');

  // If the preferred MIME produced no documentElement, try 'text/xml' fallback.
  if (doc.documentElement === null) {
    doc = domParser.parseFromString(source, 'text/xml');
  }

  // Step 5 (cont.): detect parser errors.
  if (doc.querySelector('parsererror') !== null) {
    const errorText = doc.querySelector('parsererror')?.textContent ?? 'unknown parser error';
    throw new SvgParseError(`DOMParser reported error: ${errorText}`);
  }

  // If documentElement is still null after both attempts, treat as parse error.
  if (doc.documentElement === null) {
    throw new SvgParseError('DOMParser returned a document with no root element.');
  }

  // Step 6: validate root element.
  const root = doc.documentElement;
  if (root.localName !== 'svg') {
    throw new SvgParseError(`Root element is <${root.localName}>, expected <svg>.`);
  }
  if (root.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgParseError(
      `Root element namespace is "${root.namespaceURI ?? 'null'}", expected "${SVG_NAMESPACE}".`,
    );
  }

  // Step 7: extract attributes.
  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const width = parseDimension(root.getAttribute('width'));
  const height = parseDimension(root.getAttribute('height'));

  return {
    source,
    viewBox,
    width,
    height,
    xmlns: SVG_NAMESPACE,
  };
}

/**
 * Serialize an SvgFile back to its original XML source.
 * First-pass is a pass-through: returns `file.source` unchanged.
 */
export function serializeSvg(file: SvgFile): string {
  return file.source;
}
