/**
 * CSV / TSV parse/serialize for @catlabtech/webcvt-data-text.
 *
 * A single state-machine parser handles both CSV (delimiter=',') and
 * TSV (delimiter='\t'). parseTsv / serializeTsv in tsv.ts are thin wrappers.
 *
 * State machine states:
 *   FIELD_START      - at the beginning of a new field
 *   UNQUOTED_FIELD   - inside an unquoted field
 *   QUOTED_FIELD     - inside a quoted field
 *   QUOTE_IN_QUOTED  - just saw a '"' inside a quoted field (may be escape or close)
 *
 * Traps handled:
 *   §3  CSV quote-doubling: "" → " (QUOTE_IN_QUOTED state)
 *   §4  Embedded newlines: valid inside QUOTED_FIELD
 *   §5  BOM strip + hadBom recording
 *   §6  Bare-CR row terminator: \r and \r\n both accepted
 *   §7  Trailing newline: don't emit extra empty row
 *   §13 TextDecoder fatal mode (via decodeInput)
 */

import { MAX_CSV_CELLS, MAX_CSV_COLS, MAX_CSV_ROWS } from './constants.ts';
import {
  CsvBadQuoteError,
  CsvCellCapError,
  CsvColCapError,
  CsvDuplicateHeaderError,
  CsvInvalidUtf8Error,
  CsvRaggedRowError,
  CsvRowCapError,
  CsvUnexpectedQuoteError,
  CsvUnterminatedQuoteError,
} from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Parse options for CSV / TSV. */
export interface DelimitedParseOptions {
  /**
   * Whether to treat the first row as a header row.
   * When true: headers is string[], rows are Record<string, string>[].
   * When false (default): headers is null, rows are string[][].
   */
  header?: boolean;
}

/**
 * A parsed CSV or TSV table.
 *
 * When headers !== null, rows are keyed by header name (Record<string, string>[]).
 * When headers === null, rows are raw string arrays (string[][]).
 */
export interface DelimitedFile {
  delimiter: ',' | '\t';
  headers: string[] | null;
  rows: string[][] | Record<string, string>[];
  /** Whether the input had a UTF-8 BOM. Preserved on serialize. */
  hadBom: boolean;
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

enum State {
  FIELD_START = 0,
  UNQUOTED_FIELD = 1,
  QUOTED_FIELD = 2,
  QUOTE_IN_QUOTED = 3,
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a delimited (CSV or TSV) document.
 *
 * @param input      Raw bytes or string.
 * @param delimiter  Field delimiter: ',' for CSV, '\t' for TSV.
 * @param opts       Parse options (header row handling).
 */
export function parseDelimited(
  input: Uint8Array | string,
  delimiter: ',' | '\t',
  opts?: DelimitedParseOptions,
): DelimitedFile {
  const { text, hadBom } = decodeInput(
    input,
    delimiter === ',' ? 'CSV' : 'TSV',
    (cause) => new CsvInvalidUtf8Error(cause),
  );

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let state: State = State.FIELD_START;
  // Cumulative cell counter for Sec-M-3 cap (rows × cols product). Defends
  // against billion-cell DoS where individual row + col caps each pass but
  // the product exhausts memory.
  let totalCells = 0;

  /** Finalize the current field and push it to currentRow. */
  function pushField(): void {
    if (currentRow.length >= MAX_CSV_COLS) {
      throw new CsvColCapError(MAX_CSV_COLS);
    }
    if (totalCells >= MAX_CSV_CELLS) {
      throw new CsvCellCapError(MAX_CSV_CELLS);
    }
    currentRow.push(currentField);
    totalCells += 1;
    currentField = '';
  }

  /** Finalize the current row and push it to rows (no-op on empty trailing row). */
  function pushRow(): void {
    // Trap §7: don't emit an extra empty row for trailing newline
    if (currentField.length === 0 && currentRow.length === 0) {
      return;
    }
    pushField();
    if (rows.length >= MAX_CSV_ROWS) {
      throw new CsvRowCapError(MAX_CSV_ROWS);
    }
    rows.push(currentRow);
    currentRow = [];
    state = State.FIELD_START;
  }

  const len = text.length;
  let i = 0;

  while (i < len) {
    const c = text[i] as string;

    switch (state) {
      case State.FIELD_START: {
        if (c === '"') {
          state = State.QUOTED_FIELD;
        } else if (c === delimiter) {
          pushField(); // empty field
          // state stays FIELD_START
        } else if (c === '\r') {
          // Trap §6: bare-CR or CRLF
          if (i + 1 < len && text[i + 1] === '\n') {
            i += 1; // consume \n
          }
          pushRow();
        } else if (c === '\n') {
          pushRow();
        } else {
          currentField += c;
          state = State.UNQUOTED_FIELD;
        }
        break;
      }
      case State.UNQUOTED_FIELD: {
        if (c === delimiter) {
          pushField();
          state = State.FIELD_START;
        } else if (c === '\r') {
          if (i + 1 < len && text[i + 1] === '\n') {
            i += 1;
          }
          pushRow();
        } else if (c === '\n') {
          pushRow();
        } else if (c === '"') {
          throw new CsvUnexpectedQuoteError();
        } else {
          currentField += c;
        }
        break;
      }
      case State.QUOTED_FIELD: {
        if (c === '"') {
          state = State.QUOTE_IN_QUOTED;
        } else {
          // Trap §4: embedded \r, \n, delimiter are all literal inside quotes
          currentField += c;
        }
        break;
      }
      case State.QUOTE_IN_QUOTED: {
        if (c === '"') {
          // Trap §3: "" → literal "
          currentField += '"';
          state = State.QUOTED_FIELD;
        } else if (c === delimiter) {
          pushField();
          state = State.FIELD_START;
        } else if (c === '\r') {
          if (i + 1 < len && text[i + 1] === '\n') {
            i += 1;
          }
          pushRow();
        } else if (c === '\n') {
          pushRow();
        } else {
          throw new CsvBadQuoteError();
        }
        break;
      }
    }

    i += 1;
  }

  // End of input
  if (state === State.QUOTED_FIELD) {
    throw new CsvUnterminatedQuoteError();
  }

  // Flush final row (handles state QUOTE_IN_QUOTED = field just closed)
  if (state === State.QUOTE_IN_QUOTED) {
    pushField();
    if (rows.length >= MAX_CSV_ROWS) {
      throw new CsvRowCapError(MAX_CSV_ROWS);
    }
    rows.push(currentRow);
    currentRow = [];
  } else {
    // FIELD_START or UNQUOTED_FIELD
    pushRow();
  }

  // Header handling
  if (opts?.header === true) {
    const headerRow = rows[0];
    if (headerRow === undefined) {
      return { delimiter, headers: [], rows: [], hadBom };
    }

    const headers: string[] = headerRow;

    // Check for duplicate headers
    const seen = new Set<string>();
    for (const h of headers) {
      if (seen.has(h)) {
        throw new CsvDuplicateHeaderError(h);
      }
      seen.add(h);
    }

    const dataRows: Record<string, string>[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] as string[];
      if (row.length > headers.length) {
        throw new CsvRaggedRowError(r, row.length, headers.length);
      }
      const record: Record<string, string> = {};
      for (let c2 = 0; c2 < headers.length; c2++) {
        record[headers[c2] as string] = row[c2] ?? '';
      }
      dataRows.push(record);
    }

    return { delimiter, headers, rows: dataRows, hadBom };
  }

  return { delimiter, headers: null, rows, hadBom };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a DelimitedFile back to a string.
 *
 * - Emits CRLF row terminators (RFC 4180 §2.1) including after the last row.
 * - Quotes fields that contain the delimiter, `"`, `\r`, or `\n`.
 * - Inside quoted fields, `"` is doubled to `""` (RFC 4180 §2.5).
 * - If hadBom is true, prepends U+FEFF.
 */
export function serializeDelimited(file: DelimitedFile): string {
  const { delimiter, headers, rows, hadBom } = file;
  const parts: string[] = [];

  if (hadBom) {
    parts.push('\uFEFF');
  }

  /** Quote a field if it contains special characters; otherwise return as-is. */
  function quoteField(field: string): string {
    if (
      field.includes(delimiter) ||
      field.includes('"') ||
      field.includes('\r') ||
      field.includes('\n')
    ) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  /** Serialize one row of raw string fields. */
  function serializeRow(fields: string[]): void {
    parts.push(fields.map(quoteField).join(delimiter));
    parts.push('\r\n');
  }

  if (headers !== null) {
    serializeRow(headers);
    for (const row of rows as Record<string, string>[]) {
      const fields = headers.map((h) => row[h] ?? '');
      serializeRow(fields);
    }
  } else {
    for (const row of rows as string[][]) {
      serializeRow(row);
    }
  }

  return parts.join('');
}
