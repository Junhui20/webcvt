/**
 * Shared security-cap constants for @webcvt/data-text.
 *
 * All values are derived from the design note §"Security caps".
 * Every format module references these constants; do not hardcode them inline.
 */

// ---------------------------------------------------------------------------
// Universal input caps
// ---------------------------------------------------------------------------

/** Maximum raw input size in bytes (10 MiB). Checked BEFORE TextDecoder. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** Maximum decoded character count (10,485,760). Checked AFTER TextDecoder. */
export const MAX_INPUT_CHARS = 10_485_760;

// ---------------------------------------------------------------------------
// JSON-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum nesting depth allowed in a JSON document (256).
 * Pre-scan rejects inputs exceeding this BEFORE JSON.parse is called,
 * preventing V8 stack-overflow exposure from deeply nested arrays/objects.
 */
export const MAX_JSON_DEPTH = 256;

// ---------------------------------------------------------------------------
// CSV / TSV-specific caps
// ---------------------------------------------------------------------------

/** Maximum number of rows in a CSV/TSV document (1,000,000). */
export const MAX_CSV_ROWS = 1_000_000;

/** Maximum number of columns per row in a CSV/TSV document (1,024). */
export const MAX_CSV_COLS = 1024;

/**
 * Maximum cumulative number of cells (rows × cols) across the entire CSV/TSV
 * document (8,000,000). Per-row + per-cell caps still apply, but this caps
 * the multiplicative product so that an attacker can't reach 1M rows × 1024
 * cols ≈ 1B cells (~8 GiB of pointer space) before either individual cap
 * would fire. Sec-M-3 defense from review.
 */
export const MAX_CSV_CELLS = 8_000_000;

// ---------------------------------------------------------------------------
// INI-specific caps
// ---------------------------------------------------------------------------

/** Maximum number of sections in an INI document (1,024). */
export const MAX_INI_SECTIONS = 1024;

/** Maximum total number of keys across all sections in an INI document (100,000). */
export const MAX_INI_KEYS = 100_000;

// ---------------------------------------------------------------------------
// ENV-specific caps
// ---------------------------------------------------------------------------

/** Maximum number of key/value pairs in an ENV document (100,000). */
export const MAX_ENV_KEYS = 100_000;

// ---------------------------------------------------------------------------
// JSONL-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum number of raw lines after split in a JSONL document (1,000,000).
 * Checked BEFORE the skip-empty walk to prevent DoS from huge split arrays
 * (Trap #6: 10 MiB of bare newlines = ~10M lines → ~80 MiB array).
 */
export const MAX_JSONL_RECORDS = 1_000_000;

/**
 * Maximum number of characters in a single JSONL record line (1,048,576 = 1 MiB).
 * Checked BEFORE the depth pre-scan to prevent memory exhaustion from a single
 * very long line (Trap #7: one 10 MiB padded line overwhelms JSON.parse).
 */
export const MAX_JSONL_RECORD_CHARS = 1_048_576;

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const JSON_MIME = 'application/json';
export const CSV_MIME = 'text/csv';
export const TSV_MIME = 'text/tab-separated-values';
export const INI_MIME = 'text/x-ini';
export const ENV_MIME = 'text/plain';

/** Canonical MIME type for JSONL / JSON Lines (application/jsonl). */
export const JSONL_MIME = 'application/jsonl';

/**
 * Alias MIME type for JSONL (application/x-ndjson).
 * Accepted by the backend as an identity-within-format alias.
 */
export const JSONL_MIME_ALIAS = 'application/x-ndjson';
