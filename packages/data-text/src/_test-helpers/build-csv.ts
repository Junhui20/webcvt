/**
 * CSV / TSV builder for @catlabtech/webcvt-data-text tests.
 *
 * Builds RFC 4180-quoted CSV or TSV strings from row arrays.
 * Used as parser input in round-trip and regression tests.
 *
 * NOT exported from the package index — test use only.
 */

export interface BuildCsvOptions {
  /** Field delimiter. Default: ',' (CSV). Use '\t' for TSV. */
  delimiter?: string;
  /**
   * Row terminator. Default: '\r\n' (RFC 4180).
   * Use '\n' to exercise LF-only parser tolerance.
   * Use '\r' to exercise bare-CR parser tolerance.
   */
  rowTerminator?: string;
  /** If true, append a trailing row terminator after the last row. Default: true. */
  trailingNewline?: boolean;
}

/**
 * Build a CSV or TSV string from rows.
 *
 * Fields containing the delimiter, `"`, `\r`, or `\n` are quoted using
 * RFC 4180 double-quote-doubling. Other fields are emitted raw.
 *
 * @param rows  2D array of string fields.
 * @param opts  Optional configuration.
 */
export function buildCsv(rows: string[][], opts?: BuildCsvOptions): string {
  const delimiter = opts?.delimiter ?? ',';
  const rowTerminator = opts?.rowTerminator ?? '\r\n';
  const trailingNewline = opts?.trailingNewline ?? true;

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

  const rowStrings = rows.map((row) => row.map(quoteField).join(delimiter));

  if (trailingNewline) {
    return rowStrings.join(rowTerminator) + rowTerminator;
  }
  return rowStrings.join(rowTerminator);
}
