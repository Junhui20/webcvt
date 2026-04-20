/**
 * Typed error classes for @webcvt/data-text.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from data-text — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@webcvt/core';

// ---------------------------------------------------------------------------
// Universal errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the raw input exceeds MAX_INPUT_BYTES (10 MiB).
 */
export class InputTooLargeError extends WebcvtError {
  constructor(size: number, max: number, format: string) {
    super(
      'DATA_TEXT_INPUT_TOO_LARGE',
      `${format} input is ${size} bytes; maximum supported is ${max} bytes (10 MiB).`,
    );
    this.name = 'InputTooLargeError';
  }
}

/**
 * Thrown when the decoded character count exceeds MAX_INPUT_CHARS.
 */
export class InputTooManyCharsError extends WebcvtError {
  constructor(count: number, max: number, format: string) {
    super(
      'DATA_TEXT_INPUT_TOO_MANY_CHARS',
      `${format} input has ${count} characters after decoding; maximum is ${max}.`,
    );
    this.name = 'InputTooManyCharsError';
  }
}

// ---------------------------------------------------------------------------
// JSON errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array input contains malformed UTF-8 bytes.
 */
export class JsonInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('JSON_INVALID_UTF8', 'JSON input contains malformed UTF-8 bytes.', { cause });
    this.name = 'JsonInvalidUtf8Error';
  }
}

/**
 * Thrown when the JSON pre-scan detects nesting depth exceeding MAX_JSON_DEPTH (256).
 * This is raised BEFORE JSON.parse to prevent V8 stack-overflow exposure.
 */
export class JsonDepthExceededError extends WebcvtError {
  constructor(depth: number, max: number) {
    super(
      'JSON_DEPTH_EXCEEDED',
      `JSON document nesting depth ${depth} exceeds the cap of ${max}. Deeply nested inputs are rejected before JSON.parse to prevent stack overflow.`,
    );
    this.name = 'JsonDepthExceededError';
  }
}

/**
 * Thrown when JSON.parse throws a SyntaxError.
 */
export class JsonParseError extends WebcvtError {
  constructor(cause: unknown) {
    super('JSON_PARSE_ERROR', `JSON parse failed: ${String(cause)}`, { cause });
    this.name = 'JsonParseError';
  }
}

// ---------------------------------------------------------------------------
// CSV / TSV errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array input contains malformed UTF-8 bytes.
 */
export class CsvInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('CSV_INVALID_UTF8', 'CSV/TSV input contains malformed UTF-8 bytes.', { cause });
    this.name = 'CsvInvalidUtf8Error';
  }
}

/**
 * Thrown when a quoted field is opened but never closed (end-of-input inside quotes).
 */
export class CsvUnterminatedQuoteError extends WebcvtError {
  constructor() {
    super('CSV_UNTERMINATED_QUOTE', 'CSV/TSV quoted field was opened but never closed.');
    this.name = 'CsvUnterminatedQuoteError';
  }
}

/**
 * Thrown when a `"` appears inside an unquoted field (RFC 4180 §2.5 violation).
 */
export class CsvUnexpectedQuoteError extends WebcvtError {
  constructor() {
    super(
      'CSV_UNEXPECTED_QUOTE',
      'CSV/TSV unquoted field contains a bare `"` character (RFC 4180 §2.5).',
    );
    this.name = 'CsvUnexpectedQuoteError';
  }
}

/**
 * Thrown when a closing `"` is followed by a character that is not another `"`,
 * a delimiter, or an end-of-row character — i.e. a malformed quoted field.
 */
export class CsvBadQuoteError extends WebcvtError {
  constructor() {
    super(
      'CSV_BAD_QUOTE',
      'CSV/TSV quoted field has an invalid character after a closing `"`. ' +
        'Expected `""` (escaped quote), delimiter, or end-of-row.',
    );
    this.name = 'CsvBadQuoteError';
  }
}

/**
 * Thrown when the number of rows exceeds MAX_CSV_ROWS (1,000,000).
 */
export class CsvRowCapError extends WebcvtError {
  constructor(max: number) {
    super('CSV_ROW_CAP_EXCEEDED', `CSV/TSV row count exceeds the cap of ${max}.`);
    this.name = 'CsvRowCapError';
  }
}

/**
 * Thrown when a row has more columns than MAX_CSV_COLS (1,024).
 */
export class CsvColCapError extends WebcvtError {
  constructor(max: number) {
    super('CSV_COL_CAP_EXCEEDED', `CSV/TSV column count per row exceeds the cap of ${max}.`);
    this.name = 'CsvColCapError';
  }
}

/**
 * Thrown when convert() is called with a MIME that's in the canHandle
 * allowlist gate but not actually supported by the format dispatcher.
 * Defensive guard for an internally inconsistent state; never reached via
 * the public canHandle -> convert flow.
 */
export class UnsupportedFormatError extends WebcvtError {
  constructor(mime: string) {
    super('UNSUPPORTED_FORMAT', `data-text does not support MIME '${mime}'.`);
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * Thrown when the cumulative cell count (rows × cols) exceeds MAX_CSV_CELLS
 * (8,000,000). Defends against billion-cell DoS where individual row + col
 * caps each pass but the product exhausts memory.
 */
export class CsvCellCapError extends WebcvtError {
  constructor(max: number) {
    super('CSV_CELL_CAP_EXCEEDED', `CSV/TSV total cell count exceeds the cap of ${max}.`);
    this.name = 'CsvCellCapError';
  }
}

/**
 * Thrown when the header row contains duplicate field names.
 */
export class CsvDuplicateHeaderError extends WebcvtError {
  constructor(name: string) {
    super('CSV_DUPLICATE_HEADER', `CSV/TSV header row contains duplicate column name: "${name}".`);
    this.name = 'CsvDuplicateHeaderError';
  }
}

/**
 * Thrown when a data row has more fields than there are headers.
 */
export class CsvRaggedRowError extends WebcvtError {
  constructor(rowIndex: number, fieldCount: number, headerCount: number) {
    super(
      'CSV_RAGGED_ROW',
      `CSV/TSV row ${rowIndex} has ${fieldCount} fields but only ${headerCount} headers are defined.`,
    );
    this.name = 'CsvRaggedRowError';
  }
}

// ---------------------------------------------------------------------------
// INI errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array input contains malformed UTF-8 bytes.
 */
export class IniInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('INI_INVALID_UTF8', 'INI input contains malformed UTF-8 bytes.', { cause });
    this.name = 'IniInvalidUtf8Error';
  }
}

/**
 * Thrown when a key=value line has an empty key string.
 */
export class IniEmptyKeyError extends WebcvtError {
  constructor(lineNumber: number) {
    super('INI_EMPTY_KEY', `INI key is empty at line ${lineNumber}.`);
    this.name = 'IniEmptyKeyError';
  }
}

/**
 * Thrown when a line cannot be classified as a comment, section header,
 * key=value pair, or blank line.
 */
export class IniSyntaxError extends WebcvtError {
  constructor(lineNumber: number, line: string) {
    super(
      'INI_SYNTAX_ERROR',
      `INI syntax error at line ${lineNumber}: "${line}". Expected a blank line, comment (;/#), section header ([name]), or key=value pair.`,
    );
    this.name = 'IniSyntaxError';
  }
}

// ---------------------------------------------------------------------------
// ENV errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array input contains malformed UTF-8 bytes.
 */
export class EnvInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('ENV_INVALID_UTF8', 'ENV input contains malformed UTF-8 bytes.', { cause });
    this.name = 'EnvInvalidUtf8Error';
  }
}

/**
 * Thrown when a line does not match the expected KEY=value pattern.
 */
export class EnvSyntaxError extends WebcvtError {
  constructor(lineNumber: number) {
    super(
      'ENV_SYNTAX_ERROR',
      `ENV syntax error at line ${lineNumber}. Expected KEY=value, KEY="value", KEY=\'value\', or a comment/blank line.`,
    );
    this.name = 'EnvSyntaxError';
  }
}

/**
 * Thrown when a double-quoted ENV value contains an unrecognized escape sequence.
 * Recognized escapes: \\n, \\t, \\\\, \\".
 */
export class EnvBadEscapeError extends WebcvtError {
  constructor(lineNumber: number, escapeChar: string) {
    super(
      'ENV_BAD_ESCAPE',
      `ENV bad escape sequence "\\${escapeChar}" at line ${lineNumber}. Recognized escapes inside double-quoted values: \\n, \\t, \\\\, \\".`,
    );
    this.name = 'EnvBadEscapeError';
  }
}

// ---------------------------------------------------------------------------
// JSONL errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array input contains malformed UTF-8 bytes for JSONL.
 */
export class JsonlInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('JSONL_INVALID_UTF8', 'JSONL input contains malformed UTF-8 bytes.', { cause });
    this.name = 'JsonlInvalidUtf8Error';
  }
}

/**
 * Thrown when a JSONL record fails JSON.parse, or when JSON.stringify produces
 * undefined for a record during serialize (Trap #8 — undefined/function values).
 * Carries a 1-based lineNumber.
 */
export class JsonlRecordParseError extends WebcvtError {
  readonly lineNumber: number;
  constructor(lineNumber: number, cause?: unknown) {
    super(
      'JSONL_RECORD_PARSE',
      `JSONL record at line ${lineNumber} failed to parse.`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = 'JsonlRecordParseError';
    this.lineNumber = lineNumber;
  }
}

/**
 * Thrown when a JSONL record's nesting depth exceeds MAX_JSON_DEPTH (256).
 * Detected BEFORE JSON.parse to prevent V8 stack-overflow (Trap #3).
 * Carries a 1-based lineNumber.
 */
export class JsonlRecordDepthExceededError extends WebcvtError {
  readonly lineNumber: number;
  constructor(lineNumber: number, depth: number, max: number) {
    super(
      'JSONL_RECORD_DEPTH_EXCEEDED',
      `JSONL record at line ${lineNumber} has nesting depth ${depth} which exceeds the cap of ${max}. Rejected before JSON.parse to prevent stack overflow.`,
    );
    this.name = 'JsonlRecordDepthExceededError';
    this.lineNumber = lineNumber;
  }
}

/**
 * Thrown when the raw split line count exceeds MAX_JSONL_RECORDS (1,000,000).
 * Checked BEFORE the walk to prevent DoS from huge arrays of empty lines (Trap #6).
 */
export class JsonlTooManyRecordsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'JSONL_TOO_MANY_RECORDS',
      `JSONL input has ${count} lines which exceeds the cap of ${max}. Check Trap #6: 10 MiB of bare newlines produces ~10M lines.`,
    );
    this.name = 'JsonlTooManyRecordsError';
  }
}

/**
 * Thrown when a single JSONL record line exceeds MAX_JSONL_RECORD_CHARS (1,048,576).
 * Checked BEFORE depth scan to prevent memory exhaustion (Trap #7).
 * Carries a 1-based lineNumber.
 */
export class JsonlRecordTooLongError extends WebcvtError {
  readonly lineNumber: number;
  constructor(lineNumber: number, length: number, max: number) {
    super(
      'JSONL_RECORD_TOO_LONG',
      `JSONL record at line ${lineNumber} is ${length} characters which exceeds the per-record cap of ${max} (1 MiB).`,
    );
    this.name = 'JsonlRecordTooLongError';
    this.lineNumber = lineNumber;
  }
}

// ---------------------------------------------------------------------------
// TOML errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array TOML input contains malformed UTF-8 bytes.
 */
export class TomlInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('TOML_INVALID_UTF8', 'TOML input contains malformed UTF-8 bytes.', { cause });
    this.name = 'TomlInvalidUtf8Error';
  }
}

/**
 * Thrown for generic TOML parse failures.
 * Carries a 1-based line/column and a source snippet for diagnostic context.
 */
export class TomlParseError extends WebcvtError {
  readonly line: number;
  readonly col: number;
  readonly snippet: string;
  constructor(message: string, line: number, col: number, snippet: string) {
    super(
      'TOML_PARSE_ERROR',
      `TOML parse error at line ${line}, col ${col}: ${message}\n  Near: ${snippet}`,
    );
    this.name = 'TomlParseError';
    this.line = line;
    this.col = col;
    this.snippet = snippet;
  }
}

/**
 * Thrown when the same key is defined twice within the same table
 * (Trap #3 / #4 — dotted key or direct key collision).
 */
export class TomlDuplicateKeyError extends WebcvtError {
  readonly key: string;
  constructor(key: string) {
    super('TOML_DUPLICATE_KEY', `TOML duplicate key: "${key}" is already defined in this table.`);
    this.name = 'TomlDuplicateKeyError';
    this.key = key;
  }
}

/**
 * Thrown when a [table] header attempts to redefine a table that was
 * already closed via a prior [table] header (Trap #4).
 */
export class TomlRedefineTableError extends WebcvtError {
  readonly path: string;
  constructor(path: string) {
    super(
      'TOML_REDEFINE_TABLE',
      `TOML table [${path}] is being redefined. A table can only be defined once via a header.`,
    );
    this.name = 'TomlRedefineTableError';
    this.path = path;
  }
}

/**
 * Thrown when a dotted key attempts to assign through a value that is not
 * a table (e.g. a.b = 1 followed by a.b.c = 2, Trap #3).
 */
export class TomlConflictingTypeError extends WebcvtError {
  readonly key: string;
  constructor(key: string) {
    super(
      'TOML_CONFLICTING_TYPE',
      `TOML key "${key}" has conflicting types: dotted-key assignment conflicts with an existing non-table value.`,
    );
    this.name = 'TomlConflictingTypeError';
    this.key = key;
  }
}

/**
 * Thrown when a basic string contains an unrecognized escape sequence (Trap #13).
 * Recognized escapes: \\b \\t \\n \\f \\r \\" \\\\ \\uXXXX \\UXXXXXXXX.
 */
export class TomlBadEscapeError extends WebcvtError {
  readonly escapeChar: string;
  constructor(escapeChar: string, line: number, col: number) {
    super(
      'TOML_BAD_ESCAPE',
      `TOML bad escape sequence "\\${escapeChar}" at line ${line}, col ${col}. Recognized escapes: \\b \\t \\n \\f \\r \\" \\\\ \\uXXXX \\UXXXXXXXX.`,
    );
    this.name = 'TomlBadEscapeError';
    this.escapeChar = escapeChar;
  }
}

/**
 * Thrown when an integer has leading zeros (Trap #12), overflows the
 * signed 64-bit range, or has a bare underscore / adjacent underscores.
 */
export class TomlBadNumberError extends WebcvtError {
  readonly raw: string;
  constructor(reason: string, raw: string) {
    super('TOML_BAD_NUMBER', `TOML bad number "${raw}": ${reason}.`);
    this.name = 'TomlBadNumberError';
    this.raw = raw;
  }
}

/**
 * Thrown when a date/time value has an out-of-range component (month 13,
 * day 32, etc.) or an invalid offset (Trap — Bad Date).
 */
export class TomlBadDateError extends WebcvtError {
  readonly raw: string;
  constructor(reason: string, raw: string) {
    super('TOML_BAD_DATE', `TOML bad date/time "${raw}": ${reason}.`);
    this.name = 'TomlBadDateError';
    this.raw = raw;
  }
}

/**
 * Thrown when table/array nesting exceeds MAX_TOML_DEPTH (64).
 * Enforced incrementally during parse to prevent stack-overflow DoS.
 */
export class TomlDepthExceededError extends WebcvtError {
  constructor(depth: number, max: number) {
    super(
      'TOML_DEPTH_EXCEEDED',
      `TOML nesting depth ${depth} exceeds the cap of ${max}. Deeply nested structures are rejected to prevent stack overflow.`,
    );
    this.name = 'TomlDepthExceededError';
  }
}

/**
 * Thrown when a TOML string token exceeds MAX_TOML_STRING_LEN (1 MiB).
 */
export class TomlStringTooLongError extends WebcvtError {
  constructor(length: number, max: number) {
    super(
      'TOML_STRING_TOO_LONG',
      `TOML string token is ${length} characters which exceeds the cap of ${max} (1 MiB).`,
    );
    this.name = 'TomlStringTooLongError';
  }
}

/**
 * Thrown when serializeToml encounters a value that cannot be serialized
 * to TOML (e.g. undefined, Function, Symbol, or circular reference).
 */
export class TomlSerializeError extends WebcvtError {
  constructor(reason: string) {
    super('TOML_SERIALIZE_ERROR', `TOML serialize error: ${reason}.`);
    this.name = 'TomlSerializeError';
  }
}

// ---------------------------------------------------------------------------
// XML errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array XML input contains malformed UTF-8 bytes.
 */
export class XmlInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('XML_INVALID_UTF8', 'XML input contains malformed UTF-8 bytes.', { cause });
    this.name = 'XmlInvalidUtf8Error';
  }
}

/**
 * Thrown when the pre-scan detects a `<!DOCTYPE` declaration (Trap #1).
 * DOCTYPE is the root cause of XXE attacks and is rejected BEFORE DOMParser.
 */
export class XmlDoctypeForbiddenError extends WebcvtError {
  constructor() {
    super(
      'XML_DOCTYPE_FORBIDDEN',
      'XML input contains a <!DOCTYPE declaration which is forbidden. DTDs are rejected to prevent XXE and entity-expansion attacks.',
    );
    this.name = 'XmlDoctypeForbiddenError';
  }
}

/**
 * Thrown when the pre-scan detects a `<!ENTITY` declaration (Trap #2).
 * Even pure-internal entity declarations can enable billion-laughs attacks.
 */
export class XmlEntityForbiddenError extends WebcvtError {
  constructor() {
    super(
      'XML_ENTITY_FORBIDDEN',
      'XML input contains a <!ENTITY declaration which is forbidden. Entity declarations enable billion-laughs and XXE attacks.',
    );
    this.name = 'XmlEntityForbiddenError';
  }
}

/**
 * Thrown when the pre-scan detects a SYSTEM or PUBLIC external entity reference
 * (Trap #3). Cannot appear outside DTD context; treated as hostile input.
 */
export class XmlExternalEntityForbiddenError extends WebcvtError {
  constructor(token: string) {
    super(
      'XML_EXTERNAL_ENTITY_FORBIDDEN',
      `XML input contains a forbidden external entity reference token "${token}". External entity loading is disabled.`,
    );
    this.name = 'XmlExternalEntityForbiddenError';
  }
}

/**
 * Thrown when a processing instruction other than the `<?xml?>` preamble is
 * found (Trap #5). PIs like `<?xml-stylesheet?>` and `<?php?>` are rejected.
 */
export class XmlForbiddenPiError extends WebcvtError {
  constructor(target: string) {
    super(
      'XML_FORBIDDEN_PI',
      `XML input contains a forbidden processing instruction "<?${target}". Only the <?xml?> preamble is allowed.`,
    );
    this.name = 'XmlForbiddenPiError';
  }
}

/**
 * Thrown when the CDATA section payload contains a forbidden token such as
 * `<!DOCTYPE` or `<!ENTITY` (Trap #4 — defense in depth).
 */
export class XmlCdataPayloadError extends WebcvtError {
  constructor(token: string) {
    super(
      'XML_CDATA_PAYLOAD_FORBIDDEN',
      `XML CDATA section contains forbidden token "${token}". This is rejected as a defense-in-depth measure against rewrite attacks.`,
    );
    this.name = 'XmlCdataPayloadError';
  }
}

/**
 * Thrown when DOMParser reports a parse error via `<parsererror>` (Trap #6),
 * or when the preamble declares a non-UTF-8 encoding (Trap #16).
 */
export class XmlParseError extends WebcvtError {
  constructor(reason: string) {
    super('XML_PARSE_ERROR', `XML parse error: ${reason}`);
    this.name = 'XmlParseError';
  }
}

/**
 * Thrown when the pre-scan detects tag nesting depth exceeding MAX_XML_DEPTH (64).
 * Raised BEFORE DOMParser to prevent stack-overflow exposure (Trap #12).
 */
export class XmlDepthExceededError extends WebcvtError {
  constructor(depth: number, max: number) {
    super(
      'XML_DEPTH_EXCEEDED',
      `XML document nesting depth ${depth} exceeds the cap of ${max}. Deeply nested documents are rejected before DOMParser to prevent stack overflow.`,
    );
    this.name = 'XmlDepthExceededError';
  }
}

/**
 * Thrown when the pre-scan counts more than MAX_XML_ELEMENTS (100,000) opening
 * tags outside quoted/comment/CDATA contexts (Trap #13).
 */
export class XmlTooManyElementsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'XML_TOO_MANY_ELEMENTS',
      `XML document contains more than ${max} elements (counted ${count}). Large documents are rejected to prevent memory exhaustion.`,
    );
    this.name = 'XmlTooManyElementsError';
  }
}

/**
 * Thrown during DOM-walk when a single element has more than
 * MAX_XML_ATTRS_PER_ELEMENT (1024) attributes (Trap #14).
 */
export class XmlTooManyAttrsError extends WebcvtError {
  constructor(elementName: string, count: number, max: number) {
    super(
      'XML_TOO_MANY_ATTRS',
      `XML element <${elementName}> has ${count} attributes which exceeds the cap of ${max}.`,
    );
    this.name = 'XmlTooManyAttrsError';
  }
}

/**
 * Thrown during DOM-walk when the concatenated text content of a single element
 * exceeds MAX_XML_TEXT_NODE_CHARS (1 MiB) (Trap #15).
 */
export class XmlTextNodeTooLongError extends WebcvtError {
  constructor(elementName: string, length: number, max: number) {
    super(
      'XML_TEXT_NODE_TOO_LONG',
      `XML element <${elementName}> has ${length} text characters which exceeds the cap of ${max} (1 MiB).`,
    );
    this.name = 'XmlTextNodeTooLongError';
  }
}

/**
 * Thrown by the serializer when an element or attribute name fails the XML 1.0
 * Name production validation (Trap #11).
 */
export class XmlBadElementNameError extends WebcvtError {
  constructor(name: string) {
    super(
      'XML_BAD_ELEMENT_NAME',
      `"${name}" is not a valid XML 1.0 Name. Names must start with a letter, underscore, or colon, and contain only name characters.`,
    );
    this.name = 'XmlBadElementNameError';
  }
}

/**
 * Thrown by the serializer when a value cannot be serialized to well-formed XML.
 */
export class XmlSerializeError extends WebcvtError {
  constructor(reason: string) {
    super('XML_SERIALIZE_ERROR', `XML serialize error: ${reason}`);
    this.name = 'XmlSerializeError';
  }
}

// ---------------------------------------------------------------------------
// FWF errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array FWF input contains malformed UTF-8 bytes.
 */
export class FwfInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    super('FWF_INVALID_UTF8', 'FWF input contains malformed UTF-8 bytes.', { cause });
    this.name = 'FwfInvalidUtf8Error';
  }
}

/**
 * Thrown when two declared columns overlap (prev.end > next.start).
 * Adjacent columns (prev.end === next.start) are allowed.
 */
export class FwfOverlappingColumnsError extends WebcvtError {
  constructor(prevName: string, nextName: string, prevEnd: number, nextStart: number) {
    super(
      'FWF_OVERLAPPING_COLUMNS',
      `FWF columns "${prevName}" (end=${prevEnd}) and "${nextName}" (start=${nextStart}) overlap. Column ranges must not overlap; adjacent ranges (end === start) are allowed.`,
    );
    this.name = 'FwfOverlappingColumnsError';
  }
}

/**
 * Thrown when a column declaration is invalid:
 * - end <= start (zero-or-negative width)
 * - start < 0
 * - empty name
 * - align not 'left' | 'right'
 * - duplicate name
 */
export class FwfInvalidColumnError extends WebcvtError {
  constructor(name: string, reason: string) {
    super('FWF_INVALID_COLUMN', `FWF column "${name}" is invalid: ${reason}.`);
    this.name = 'FwfInvalidColumnError';
  }
}

/**
 * Thrown when the number of declared columns exceeds MAX_FWF_COLUMNS (1,024).
 */
export class FwfTooManyColumnsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'FWF_TOO_MANY_COLUMNS',
      `FWF schema declares ${count} columns which exceeds the cap of ${max}. Large schemas are rejected to prevent schema-bomb DoS.`,
    );
    this.name = 'FwfTooManyColumnsError';
  }
}

/**
 * Thrown when the raw line count (after split, before skip-empty walk)
 * exceeds MAX_FWF_LINES (1,000,000).
 * Checked BEFORE the skip-empty walk to prevent DoS from huge arrays of
 * whitespace-only lines.
 */
export class FwfTooManyLinesError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'FWF_TOO_MANY_LINES',
      `FWF input has ${count} raw lines which exceeds the cap of ${max}. Cap is checked on raw split count before empty-line skipping.`,
    );
    this.name = 'FwfTooManyLinesError';
  }
}

/**
 * Thrown by serializeFwf when a field value is longer than its declared
 * column width (value.length > end - start).
 * NEVER truncates silently — callers must pre-truncate if desired.
 */
export class FwfFieldOverflowError extends WebcvtError {
  readonly column: string;
  readonly valueLength: number;
  readonly columnWidth: number;
  constructor(column: string, valueLength: number, columnWidth: number) {
    super(
      'FWF_FIELD_OVERFLOW',
      `FWF field "${column}" value length ${valueLength} exceeds declared column width ${columnWidth}. Truncation is never silent — shorten the value or widen the column.`,
    );
    this.name = 'FwfFieldOverflowError';
    this.column = column;
    this.valueLength = valueLength;
    this.columnWidth = columnWidth;
  }
}

/**
 * Thrown when padChar is not exactly 1 UTF-16 code unit.
 * FWF column width math is UTF-16 code unit based; a multi-unit or empty
 * padChar would corrupt column boundaries.
 */
export class FwfBadPadCharError extends WebcvtError {
  constructor(padChar: string) {
    super(
      'FWF_BAD_PAD_CHAR',
      `FWF padChar must be exactly 1 UTF-16 code unit but received "${padChar}" ` +
        `(length=${padChar.length}). Use a single ASCII character such as ' ' or '0'.`,
    );
    this.name = 'FwfBadPadCharError';
  }
}

// ---------------------------------------------------------------------------
// YAML errors (19)
// ---------------------------------------------------------------------------

/**
 * Thrown when a Uint8Array YAML input contains malformed UTF-8 bytes,
 * or a non-UTF-8 BOM (UTF-16/UTF-32) is detected (Trap 11).
 */
export class YamlInvalidUtf8Error extends WebcvtError {
  constructor(cause?: unknown) {
    const msg =
      typeof cause === 'string'
        ? cause
        : 'YAML input contains malformed UTF-8 bytes or a non-UTF-8 BOM.';
    super(
      'YAML_INVALID_UTF8',
      msg,
      typeof cause === 'object' && cause !== null ? { cause } : undefined,
    );
    this.name = 'YamlInvalidUtf8Error';
  }
}

/**
 * Thrown for generic YAML parse failures.
 * Carries a 1-based line/column and source snippet for diagnostics.
 */
export class YamlParseError extends WebcvtError {
  readonly line: number;
  readonly col: number;
  readonly snippet: string;
  constructor(message: string, line: number, col: number, snippet: string) {
    super(
      'YAML_PARSE_ERROR',
      `YAML parse error at line ${line}, col ${col}: ${message}\n  Near: ${snippet}`,
    );
    this.name = 'YamlParseError';
    this.line = line;
    this.col = col;
    this.snippet = snippet;
  }
}

/**
 * Thrown when a tab character appears in leading indentation (Trap 7).
 * YAML 1.2.2 §6.1 forbids tabs as indentation whitespace.
 */
export class YamlIndentError extends WebcvtError {
  constructor(line: number, col: number) {
    super(
      'YAML_INDENT_ERROR',
      `YAML indentation error at line ${line}, col ${col}: tab character in leading indentation. YAML 1.2.2 §6.1 forbids tabs as indentation.`,
    );
    this.name = 'YamlIndentError';
  }
}

/**
 * Thrown when a second '---' marker or any '...' document-end marker is
 * encountered after the first document (Trap 12).
 */
export class YamlMultiDocForbiddenError extends WebcvtError {
  constructor(detail: string) {
    super(
      'YAML_MULTI_DOC_FORBIDDEN',
      `YAML multi-document stream is not supported: ${detail}. Only single-document YAML is accepted.`,
    );
    this.name = 'YamlMultiDocForbiddenError';
  }
}

/**
 * Thrown when a directive other than '%YAML 1.2' is encountered (Trap 13).
 * '%YAML 1.1' and '%TAG' are rejected to prevent schema confusion.
 */
export class YamlDirectiveForbiddenError extends WebcvtError {
  constructor(directive: string) {
    super(
      'YAML_DIRECTIVE_FORBIDDEN',
      `YAML directive "${directive}" is not allowed. Only "%YAML 1.2" is accepted.`,
    );
    this.name = 'YamlDirectiveForbiddenError';
  }
}

/**
 * Thrown when a tag outside the 7-entry allowlist is encountered (Trap 3).
 * Allowlist: !!str !!int !!float !!bool !!null !!seq !!map.
 */
export class YamlTagForbiddenError extends WebcvtError {
  readonly tag: string;
  constructor(tag: string) {
    super(
      'YAML_TAG_FORBIDDEN',
      `YAML tag "${tag}" is not allowed. Only !!str !!int !!float !!bool !!null !!seq !!map are accepted. This guard neutralises YAML type-tag RCE attacks.`,
    );
    this.name = 'YamlTagForbiddenError';
    this.tag = tag;
  }
}

/**
 * Thrown when a merge key '<<:' is encountered (Trap 4).
 * Merge keys are a YAML 1.1 extension and a known footgun.
 */
export class YamlMergeKeyForbiddenError extends WebcvtError {
  constructor() {
    super(
      'YAML_MERGE_KEY_FORBIDDEN',
      'YAML merge key "<<:" is not supported. Merge keys are a YAML 1.1 extension and are rejected to prevent silent override bugs.',
    );
    this.name = 'YamlMergeKeyForbiddenError';
  }
}

/**
 * Thrown when an anchor cycle is detected during alias expansion (Trap 1).
 * Example: &a [*a] creates an infinite structure.
 */
export class YamlAnchorCycleError extends WebcvtError {
  readonly anchorName: string;
  constructor(anchorName: string) {
    super(
      'YAML_ANCHOR_CYCLE',
      `YAML anchor cycle detected: alias *${anchorName} references itself directly or indirectly.`,
    );
    this.name = 'YamlAnchorCycleError';
    this.anchorName = anchorName;
  }
}

/**
 * Thrown when an alias references an undefined anchor (no matching &name).
 */
export class YamlAnchorUndefinedError extends WebcvtError {
  readonly anchorName: string;
  constructor(anchorName: string) {
    super(
      'YAML_ANCHOR_UNDEFINED',
      `YAML alias *${anchorName} references an undefined anchor. Anchors must appear before their aliases.`,
    );
    this.name = 'YamlAnchorUndefinedError';
    this.anchorName = anchorName;
  }
}

/**
 * Thrown when the number of distinct anchor declarations exceeds
 * MAX_YAML_ANCHORS (100). Prevents anchor-table DoS.
 */
export class YamlAnchorLimitError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'YAML_ANCHOR_LIMIT',
      `YAML anchor count ${count} exceeds the cap of ${max}. Documents with excessive anchors are rejected.`,
    );
    this.name = 'YamlAnchorLimitError';
  }
}

/**
 * Thrown when total alias dereferences exceed MAX_YAML_ALIASES (1000).
 * This is the primary billion-laughs defense (Trap 2).
 */
export class YamlAliasLimitError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'YAML_ALIAS_LIMIT',
      `YAML alias expansion count ${count} exceeds the cap of ${max}. This prevents billion-laughs exponential expansion attacks (Trap 2).`,
    );
    this.name = 'YamlAliasLimitError';
  }
}

/**
 * Thrown when container nesting depth exceeds MAX_YAML_DEPTH (64).
 */
export class YamlDepthExceededError extends WebcvtError {
  constructor(depth: number, max: number) {
    super(
      'YAML_DEPTH_EXCEEDED',
      `YAML nesting depth ${depth} exceeds the cap of ${max}. Deeply nested documents are rejected to prevent stack overflow.`,
    );
    this.name = 'YamlDepthExceededError';
  }
}

/**
 * Thrown when a scalar token exceeds MAX_YAML_SCALAR_LEN (1 MiB).
 */
export class YamlScalarTooLongError extends WebcvtError {
  constructor(length: number, max: number) {
    super(
      'YAML_SCALAR_TOO_LONG',
      `YAML scalar token is ${length} characters which exceeds the cap of ${max} (1 MiB).`,
    );
    this.name = 'YamlScalarTooLongError';
  }
}

/**
 * Thrown when a single mapping has more than MAX_YAML_MAP_KEYS (10,000) keys.
 */
export class YamlMapTooLargeError extends WebcvtError {
  constructor(count: number, max: number) {
    super('YAML_MAP_TOO_LARGE', `YAML mapping has ${count} keys which exceeds the cap of ${max}.`);
    this.name = 'YamlMapTooLargeError';
  }
}

/**
 * Thrown when a sequence has more than MAX_YAML_SEQ_ITEMS (1,000,000) items.
 */
export class YamlSeqTooLargeError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'YAML_SEQ_TOO_LARGE',
      `YAML sequence has ${count} items which exceeds the cap of ${max}.`,
    );
    this.name = 'YamlSeqTooLargeError';
  }
}

/**
 * Thrown when a complex (non-scalar) mapping key is encountered (Trap 16).
 * Only scalar keys are supported.
 */
export class YamlComplexKeyForbiddenError extends WebcvtError {
  constructor() {
    super(
      'YAML_COMPLEX_KEY_FORBIDDEN',
      'YAML complex mapping keys (non-scalar keys such as sequences or mappings as keys) are not supported. Only scalar keys are allowed.',
    );
    this.name = 'YamlComplexKeyForbiddenError';
  }
}

/**
 * Thrown when a double-quoted scalar contains an unknown escape sequence (Trap 18).
 */
export class YamlBadEscapeError extends WebcvtError {
  readonly escapeChar: string;
  constructor(escapeChar: string) {
    super(
      'YAML_BAD_ESCAPE',
      `YAML bad escape sequence "\\${escapeChar}" in double-quoted scalar. Recognized escapes: \\0 \\a \\b \\t \\n \\v \\f \\r \\e \\ \\\" \\/ \\N \\_ \\L \\P \\xHH \\uHHHH \\UHHHHHHHH.`,
    );
    this.name = 'YamlBadEscapeError';
    this.escapeChar = escapeChar;
  }
}

/**
 * Thrown when the same key appears twice in the same mapping (Trap 17).
 * YAML 1.2 leaves duplicate keys as "undefined behaviour"; we reject them.
 */
export class YamlDuplicateKeyError extends WebcvtError {
  readonly key: string;
  constructor(key: string) {
    super(
      'YAML_DUPLICATE_KEY',
      `YAML duplicate key: "${key}" appears more than once in the same mapping.`,
    );
    this.name = 'YamlDuplicateKeyError';
    this.key = key;
  }
}

/**
 * Thrown when serializeYaml encounters a value that cannot be serialized
 * to valid YAML (e.g. non-string map keys, Symbol, Function).
 */
export class YamlSerializeError extends WebcvtError {
  constructor(reason: string) {
    super('YAML_SERIALIZE_ERROR', `YAML serialize error: ${reason}.`);
    this.name = 'YamlSerializeError';
  }
}
