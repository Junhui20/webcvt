/**
 * Shared security-cap constants for @catlabtech/webcvt-email.
 *
 * EML files are untrusted input. Every cap below exists to bound CPU, memory,
 * and recursion depth so a hostile message cannot exhaust the host. Modules
 * reference these constants; do not hardcode the values inline.
 */

// ---------------------------------------------------------------------------
// Universal input caps
// ---------------------------------------------------------------------------

/** Maximum raw input size in bytes (64 MiB). Checked BEFORE any parsing. */
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Header caps
// ---------------------------------------------------------------------------

/** Maximum number of header fields in a single entity's header section (1000). */
export const MAX_HEADERS = 1000;

/**
 * Maximum length of a single (physical, pre-unfolding) header line in bytes
 * (16 KiB). Guards against a single multi-megabyte header line.
 */
export const MAX_HEADER_LINE_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// MIME caps
// ---------------------------------------------------------------------------

/**
 * Maximum MIME nesting depth for multipart entities (20).
 * Enforced incrementally during recursive descent to prevent stack-overflow
 * DoS from a deeply nested multipart bomb.
 */
export const MAX_MIME_DEPTH = 20;

/**
 * Maximum total number of MIME parts across the entire message tree (1000).
 * Prevents a part-explosion DoS where a tiny payload yields a huge part array.
 */
export const MAX_MIME_PARTS = 1000;

/**
 * Maximum cumulative size of all decoded attachment payloads in bytes (64 MiB).
 * Prevents a base64/quoted-printable expansion bomb from exhausting memory even
 * when the raw input is within MAX_INPUT_BYTES.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

/** Canonical MIME type for an EML / RFC 5322 message. */
export const EML_MIME = 'message/rfc822';

/** Plain-text output MIME (the `txt` conversion target). */
export const TXT_MIME = 'text/plain';

/** JSON output MIME (the `json` conversion target). */
export const JSON_MIME = 'application/json';
