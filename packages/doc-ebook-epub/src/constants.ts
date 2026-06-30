/**
 * Shared security-cap and MIME constants for @catlabtech/webcvt-epub.
 *
 * An EPUB is untrusted input: a ZIP (OCF) container wrapping XML (OPF + OCF
 * container.xml) and XHTML content. ZIP-bomb / zip-slip protection is delegated
 * to @catlabtech/webcvt-archive-zip and XXE / billion-laughs protection to
 * @catlabtech/webcvt-data-text's `parseXml`. The caps below bound the work this
 * package itself performs (manifest/spine sizes, concatenated output, and the
 * depth of the OPF/container tree walk). Modules reference these constants; do
 * not hardcode the values inline.
 */

// ---------------------------------------------------------------------------
// Input + structural caps
// ---------------------------------------------------------------------------

/** Maximum raw input size in bytes (256 MiB). Checked BEFORE any parsing. */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/** Maximum number of `<item>` entries in the OPF manifest (10,000). */
export const MAX_MANIFEST_ITEMS = 10_000;

/** Maximum number of `<itemref>` entries in the OPF spine (5,000). */
export const MAX_SPINE_ITEMS = 5_000;

/**
 * Maximum cumulative size of a concatenated text/html conversion output in
 * bytes (64 MiB). Bounds memory even when the input is within MAX_INPUT_BYTES
 * but expands hugely after decompression + concatenation.
 */
export const MAX_TOTAL_TEXT_BYTES = 64 * 1024 * 1024;

/**
 * Maximum recursion depth while walking the parsed OPF / container.xml tree.
 * `parseXml` already caps element nesting at 64, so this is a defensive bound
 * that also stops the descendant collectors from unbounded recursion.
 */
export const MAX_XML_WALK_DEPTH = 64;

// ---------------------------------------------------------------------------
// OCF / OPF well-known paths and media types
// ---------------------------------------------------------------------------

/** Canonical MIME type of an EPUB Open Container Format file. */
export const EPUB_MIME = 'application/epub+zip';

/** The required first entry of an OCF ZIP, holding the EPUB MIME string. */
export const MIMETYPE_ENTRY = 'mimetype';

/** Fixed path of the OCF container descriptor (EPUB 3.3 OCF §3.5.2.1). */
export const CONTAINER_PATH = 'META-INF/container.xml';

/** The OPF package document media type used in the OCF `<rootfile>`. */
export const OPF_MEDIA_TYPE = 'application/oebps-package+xml';

// ---------------------------------------------------------------------------
// Output MIME types
// ---------------------------------------------------------------------------

/** Plain-text output MIME (the `txt` conversion target). */
export const TXT_MIME = 'text/plain';

/** HTML output MIME (the `html` conversion target). */
export const HTML_MIME = 'text/html';

/** JSON output MIME (the `json` conversion target). */
export const JSON_MIME = 'application/json';
