/**
 * Shared security-cap constants for @catlabtech/webcvt-data-text.
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

// ---------------------------------------------------------------------------
// TOML-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum nesting depth for TOML tables and arrays (64).
 * Enforced incrementally during parse. Prevents stack-overflow DoS from
 * deeply nested inline tables or arrays.
 */
export const MAX_TOML_DEPTH = 64;

/**
 * Maximum number of characters in a single TOML string token (1,048,576 = 1 MiB).
 * Checked incrementally during string scanning. Prevents memory exhaustion
 * from a single huge string literal.
 */
export const MAX_TOML_STRING_LEN = 1_048_576;

/**
 * Maximum number of keys in a single TOML table (10,000).
 * Prevents DoS via tables with an extreme key count.
 */
export const MAX_TOML_KEYS_PER_TABLE = 10_000;

/**
 * Maximum number of elements in a TOML array (1,000,000).
 * Prevents DoS via huge inline arrays or array-of-tables.
 */
export const MAX_TOML_ARRAY_LEN = 1_000_000;

// ---------------------------------------------------------------------------
// TOML MIME
// ---------------------------------------------------------------------------

/** Canonical MIME type for TOML (application/toml). */
export const TOML_MIME = 'application/toml';

// ---------------------------------------------------------------------------
// FWF-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum number of columns in an FWF schema (1,024).
 * Matches MAX_CSV_COLS; prevents schema-bomb DoS where a caller declares
 * thousands of columns each requiring per-line slice operations.
 * Checked BEFORE any input processing (schema validation runs first).
 */
export const MAX_FWF_COLUMNS = 1024;

/**
 * Maximum number of raw lines after split in an FWF document (1,000,000).
 * Checked BEFORE the skip-empty walk to prevent DoS from huge split arrays
 * (e.g. 10 MiB of bare newlines produces ~10M lines → ~80 MiB array).
 * Matches MAX_JSONL_RECORDS.
 */
export const MAX_FWF_LINES = 1_000_000;

// ---------------------------------------------------------------------------
// XML-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum element nesting depth for XML documents (64).
 * Pre-scan rejects inputs exceeding this BEFORE DOMParser is called,
 * preventing stack-overflow exposure from deeply nested elements (Trap #12).
 */
export const MAX_XML_DEPTH = 64;

/**
 * Maximum number of elements in an XML document (100,000).
 * Approximate count — '<' characters outside quoted/comment/CDATA contexts.
 * Pre-scan rejects inputs exceeding this BEFORE DOMParser is called (Trap #13).
 */
export const MAX_XML_ELEMENTS = 100_000;

/**
 * Maximum number of attributes per element (1,024).
 * Checked during DOM-walk AFTER DOMParser (Trap #14).
 */
export const MAX_XML_ATTRS_PER_ELEMENT = 1024;

/**
 * Maximum concatenated text content per element in characters (1,048,576 = 1 MiB).
 * Checked during DOM-walk AFTER DOMParser (Trap #15).
 */
export const MAX_XML_TEXT_NODE_CHARS = 1_048_576;

// ---------------------------------------------------------------------------
// XML MIME
// ---------------------------------------------------------------------------

/** Canonical MIME type for XML (application/xml). */
export const XML_MIME = 'application/xml';

// ---------------------------------------------------------------------------
// FWF MIME
// ---------------------------------------------------------------------------

/**
 * MIME type for FWF files (text/plain).
 *
 * WARNING: FWF shares `text/plain` with ENV. The DataTextBackend.canHandle
 * MIME-routing CANNOT disambiguate them. FWF is therefore NOT added to
 * MIME_TO_FORMAT in backend.ts. FWF is reachable ONLY via direct
 * parseFwf / serializeFwf API or parseDataText(input, 'fwf', { columns }).
 */
export const FWF_MIME = 'text/plain';

// ---------------------------------------------------------------------------
// YAML-specific caps
// ---------------------------------------------------------------------------

/**
 * Maximum container nesting depth for YAML (64).
 * Enforced incrementally during parse. Matches XML and TOML depth caps.
 */
export const MAX_YAML_DEPTH = 64;

/**
 * Maximum number of distinct &name anchor declarations (100).
 * Prevents anchor-table DoS. Legitimate k8s manifests stay well under.
 */
export const MAX_YAML_ANCHORS = 100;

/**
 * Maximum total *name alias dereferences across the entire document (1000).
 * Core billion-laughs defense (Trap 2). Caps output at O(1000 × scalar-size).
 */
export const MAX_YAML_ALIASES = 1000;

/**
 * Maximum scalar token length in characters (1,048,576 = 1 MiB).
 * Checked incrementally during scalar scanning.
 */
export const MAX_YAML_SCALAR_LEN = 1_048_576;

/**
 * Maximum number of keys in a single YAML mapping (10,000).
 * Matches MAX_TOML_KEYS_PER_TABLE.
 */
export const MAX_YAML_MAP_KEYS = 10_000;

/**
 * Maximum number of items in a single YAML sequence (1,000,000).
 * Matches MAX_TOML_ARRAY_LEN and MAX_JSONL_RECORDS.
 */
export const MAX_YAML_SEQ_ITEMS = 1_000_000;

// ---------------------------------------------------------------------------
// YAML MIME
// ---------------------------------------------------------------------------

/** Canonical MIME type for YAML (application/yaml). */
export const YAML_MIME = 'application/yaml';

/** Alias MIME for YAML (application/x-yaml). */
export const YAML_MIME_ALIAS_X = 'application/x-yaml';

/** Alias MIME for YAML (text/yaml). */
export const YAML_MIME_ALIAS_TEXT = 'text/yaml';

/** Alias MIME for YAML (text/x-yaml). */
export const YAML_MIME_ALIAS_TEXT_X = 'text/x-yaml';
