/**
 * @webcvt/image-svg — Public API
 *
 * SVG support:
 *  - Detect SVG documents (byte array or string).
 *  - Parse and validate SVG root metadata (viewBox, width, height, xmlns).
 *  - Serialize back to source XML (pass-through, byte-identical).
 *  - Rasterize to PNG / JPEG / WebP via the browser Canvas API.
 *
 * Out of scope (Phase 4.5+):
 *  - SVG editing / DOM manipulation
 *  - @font-face resolution
 *  - Filter / animation / SMIL evaluation
 *  - SVGZ (compose with @webcvt/archive-zip)
 *
 * Security: all 10 known SVG traps are handled before DOMParser invocation.
 * See the design note docs/design-notes/image-svg.md for details.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ViewBox, SvgFile } from './parser.ts';
export type { RasterizeOptions } from './rasterizer.ts';

// ---------------------------------------------------------------------------
// Core SVG API
// ---------------------------------------------------------------------------

export { detectSvg, parseSvg, serializeSvg } from './parser.ts';
export { rasterizeSvg } from './rasterizer.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export { SvgBackend, SVG_FORMAT, PNG_FORMAT, JPEG_FORMAT, WEBP_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  SvgParseError,
  SvgUnsafeContentError,
  SvgInputTooLargeError,
  SvgRasterizeTooLargeError,
  SvgRasterizeError,
  SvgEncodeNotImplementedError,
} from './errors.ts';
