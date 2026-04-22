/**
 * TSV (Tab-Separated Values) parse/serialize for @catlabtech/webcvt-data-text.
 *
 * TSV is identical to CSV with the delimiter set to '\t'.
 * Per IANA text/tab-separated-values, fields MUST NOT contain literal tabs
 * or newlines; however, in practice many TSV producers borrow CSV's
 * double-quote-doubling rule. We accept that on parse and emit RFC-4180-style
 * quoting on serialize when the field contains '\t', '"', '\r', or '\n'.
 *
 * This module is a thin wrapper over csv.ts; all logic lives there.
 */

import {
  type DelimitedFile,
  type DelimitedParseOptions,
  parseDelimited,
  serializeDelimited,
} from './csv.ts';

// Re-export types for callers who import from tsv.ts directly.
export type { DelimitedFile, DelimitedParseOptions };

/**
 * Parse a TSV document. Equivalent to calling the CSV parser with delimiter='\t'.
 */
export function parseTsv(input: Uint8Array | string, opts?: DelimitedParseOptions): DelimitedFile {
  return parseDelimited(input, '\t', opts);
}

/**
 * Serialize a TSV DelimitedFile back to a string.
 * The file's delimiter field must be '\t'; this is enforced by the type.
 */
export function serializeTsv(file: DelimitedFile): string {
  return serializeDelimited(file);
}
