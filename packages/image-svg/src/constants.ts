/**
 * Shared constants for @webcvt/image-svg.
 *
 * All security caps are derived from the design note §"Security caps".
 * Centralised here so validator.ts, parser.ts, rasterizer.ts, and
 * backend.ts cannot drift.
 */

// ---------------------------------------------------------------------------
// Security caps
// ---------------------------------------------------------------------------

/** Maximum raw input size in bytes (10 MiB). Must be the FIRST check in the demuxer. */
export const MAX_SVG_INPUT_BYTES = 10 * 1024 * 1024;

/** Maximum rasterized output width in pixels. Checked BEFORE canvas allocation. */
export const MAX_RASTERIZE_WIDTH = 8192;

/** Maximum rasterized output height in pixels. Checked BEFORE canvas allocation. */
export const MAX_RASTERIZE_HEIGHT = 8192;

/** Maximum time in milliseconds allowed for Image.decode() during rasterization. */
export const MAX_SVG_PARSE_TIME_MS = 5000;

// ---------------------------------------------------------------------------
// SVG namespace
// ---------------------------------------------------------------------------

/** Canonical SVG 1.1 / SVG 2 namespace URI. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

/** SVG MIME type. */
export const SVG_MIME = 'image/svg+xml';

/** PNG MIME type. */
export const PNG_MIME = 'image/png';

/** JPEG MIME type. */
export const JPEG_MIME = 'image/jpeg';

/** WebP MIME type. */
export const WEBP_MIME = 'image/webp';

// ---------------------------------------------------------------------------
// Rasterize output formats
// ---------------------------------------------------------------------------

/** Set of MIME types that rasterizeSvg can output. */
export const RASTERIZE_OUTPUT_MIMES = new Set<string>([PNG_MIME, JPEG_MIME, WEBP_MIME]);

// ---------------------------------------------------------------------------
// String-based security reject patterns
// ---------------------------------------------------------------------------

/**
 * Reject on literal `<!ENTITY` — covers XXE and billion-laughs attacks.
 * Must be checked BEFORE DOMParser invocation.
 */
export const REJECT_ENTITY = '<!ENTITY';

/**
 * Reject on literal `<!DOCTYPE` — any DTD is unsafe and slows the parser.
 * Must be checked BEFORE DOMParser invocation.
 */
export const REJECT_DOCTYPE = '<!DOCTYPE';

/**
 * Regex matching `<script` case-insensitively — covers all script tag variants.
 * Must be checked BEFORE DOMParser invocation.
 */
export const REJECT_SCRIPT_RE = /<script/i;

/**
 * Regex matching `<foreignObject` case-insensitively.
 * Must be checked BEFORE DOMParser invocation.
 */
export const REJECT_FOREIGN_OBJECT_RE = /<foreignObject/i;

/**
 * Regex matching any href / xlink:href attribute whose value does NOT start with `#`.
 * Catches external resource references (http, https, data, file, relative paths, etc.).
 * Must be checked BEFORE DOMParser invocation.
 */
export const REJECT_EXTERNAL_HREF_RE = /(?:xlink:)?href\s*=\s*["']([^"'#][^"']*)["']/;

// ---------------------------------------------------------------------------
// Default rasterize background
// ---------------------------------------------------------------------------

/** Default opaque background fill for JPEG rasterization. */
export const JPEG_DEFAULT_BACKGROUND = '#fff';

/** Default fallback intrinsic width when viewBox and width are absent (HTML spec). */
export const DEFAULT_RASTER_WIDTH = 300;

/** Default fallback intrinsic height when viewBox and height are absent (HTML spec). */
export const DEFAULT_RASTER_HEIGHT = 150;
