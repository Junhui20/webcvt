/**
 * @catlabtech/webcvt-image-svg — Public API
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
 *  - SVGZ (compose with @catlabtech/webcvt-archive-zip)
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

// ---------------------------------------------------------------------------
// registerSvgBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { SvgBackend } from './backend.ts';

/**
 * Construct a SvgBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('image-svg')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerSvgBackend } from '@catlabtech/webcvt-image-svg';
 * registerSvgBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerSvgBackend(registry: BackendRegistry = defaultRegistry): SvgBackend {
  const backend = new SvgBackend();
  registry.register(backend);
  return backend;
}
