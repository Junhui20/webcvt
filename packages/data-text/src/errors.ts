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
