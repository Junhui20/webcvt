/**
 * FWF (Fixed-Width Format) parse/serialize for @catlabtech/webcvt-data-text.
 *
 * Each line in a FWF file holds one record. Fields are located at
 * caller-declared character ranges using 0-based half-open [start, end)
 * semantics — identical to String.slice(start, end). No delimiters between
 * fields. Typically space-padded. No published spec; implementation derived
 * from first principles.
 *
 * ## MIME disambiguation note
 * FWF shares the `text/plain` MIME type with ENV. DataTextBackend.canHandle
 * CANNOT distinguish them by MIME alone, so FWF is NOT registered in the
 * MIME_TO_FORMAT map in backend.ts. FWF is reachable ONLY via:
 *   - parseFwf(input, opts) / serializeFwf(file, opts) direct API
 *   - parseDataText(input, 'fwf', { columns }) explicit-format dispatch
 *
 * ## Column range semantics (Trap #1)
 * Column [start, end) is 0-based, half-open, matching String.slice().
 * IRS-style 1-based specs translate as: { start: irs_start - 1, end: irs_end }.
 * Width of a column is (end - start) UTF-16 code units.
 * ASCII-only schemas are guaranteed correct; astral characters (e.g. emoji)
 * occupy 2 code units and may produce unpaired surrogates if a schema splits
 * mid-surrogate pair.
 *
 * ## Traps honoured
 * #1  Column ranges are 0-based half-open [start, end) matching String.slice.
 * #2  Overlapping columns rejected; adjacent (touching) allowed.
 * #3  Short lines padded with padChar on parse; overflow throws on serialize.
 * #4  Lines longer than maxEnd accepted on parse; trailing chars ignored.
 * #5  UTF-16 code unit width math; pad char must be exactly 1 code unit.
 * #6  BOM stripped on parse, hadBom recorded, NEVER emitted on serialize.
 * #7  Pad char used uniformly; caller handles mixed-pad columns if needed.
 * #8  All-whitespace fields parse to '' and re-serialize to padded spaces.
 *
 * ## Security caps
 * - Input byte/char cap: inherited from decodeInput (MAX_INPUT_BYTES / MAX_INPUT_CHARS).
 * - Column count: MAX_FWF_COLUMNS = 1,024.
 * - Line count: MAX_FWF_LINES = 1,000,000 (checked on RAW split count).
 * - Schema validation runs BEFORE any input processing (fail fast).
 */

import { MAX_FWF_COLUMNS, MAX_FWF_LINES } from './constants.ts';
import {
  FwfBadPadCharError,
  FwfFieldOverflowError,
  FwfInvalidColumnError,
  FwfInvalidUtf8Error,
  FwfOverlappingColumnsError,
  FwfTooManyColumnsError,
  FwfTooManyLinesError,
} from './errors.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Alignment direction for a FWF column. */
export type FwfAlign = 'left' | 'right';

/**
 * Declares a single column in a FWF schema.
 *
 * IMPORTANT — Column range semantics (Trap #1):
 * `start` and `end` are 0-based, half-open [start, end), matching String.slice().
 * - `start` is the index of the first character (inclusive).
 * - `end` is the index one past the last character (exclusive).
 * - Column width = end - start (UTF-16 code units).
 *
 * IRS / mainframe specs are often 1-based inclusive [col_start, col_end].
 * Translate: { start: irs_start - 1, end: irs_end }.
 *
 * Example — name in columns 1-10 (1-based), age in 11-13 (1-based):
 *   { name: 'name', start: 0, end: 10 }
 *   { name: 'age',  start: 10, end: 13 }
 */
export interface FwfColumn {
  readonly name: string;
  /** 0-based inclusive start index (matches String.slice first argument). */
  readonly start: number;
  /** 0-based exclusive end index (matches String.slice second argument). */
  readonly end: number;
  /**
   * Trim direction: 'left' removes leading padChars (right-aligned data),
   * 'right' removes trailing padChars (left-aligned data).
   * Default: 'left'.
   */
  readonly align?: FwfAlign;
}

/** A parsed FWF document. */
export interface FwfFile {
  /** Column schema in original declaration order. */
  readonly columns: readonly FwfColumn[];
  /** Parsed records; each record maps column name to trimmed string value. */
  readonly records: ReadonlyArray<Readonly<Record<string, string>>>;
  /** Whether the input started with a UTF-8 BOM. BOM is NEVER re-emitted on serialize. */
  readonly hadBom: boolean;
}

/** Options for parseFwf. */
export interface FwfParseOptions {
  /** Column schema — required; defines how each line is sliced. */
  columns: readonly FwfColumn[];
  /**
   * Character used to pad short lines and to trim field values.
   * Must be exactly 1 UTF-16 code unit (Trap #5).
   * Default: ' ' (space).
   */
  padChar?: string;
}

/** Options for serializeFwf. */
export interface FwfSerializeOptions {
  /**
   * Character used to pad fields to their declared width.
   * Must be exactly 1 UTF-16 code unit (Trap #5).
   * Default: ' ' (space).
   */
  padChar?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Default pad character. */
const DEFAULT_PAD_CHAR = ' ';

/**
 * Remove trailing occurrences of `padChar` from `s` (O(n) walker, no regex).
 * Used for left-aligned columns where trailing padding is trimmed.
 */
function rtrim(s: string, padChar: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === padChar) {
    end--;
  }
  return end === s.length ? s : s.slice(0, end);
}

/**
 * Remove leading occurrences of `padChar` from `s` (O(n) walker, no regex).
 * Used for right-aligned columns where leading padding is trimmed.
 */
function ltrim(s: string, padChar: string): string {
  let start = 0;
  while (start < s.length && s[start] === padChar) {
    start++;
  }
  return start === 0 ? s : s.slice(start);
}

/**
 * Validate and normalise padChar.
 * Returns the padChar to use (default ' ' if undefined).
 * Throws FwfBadPadCharError if length !== 1.
 */
function resolvePadChar(padChar: string | undefined): string {
  const pc = padChar ?? DEFAULT_PAD_CHAR;
  if (pc.length !== 1) {
    throw new FwfBadPadCharError(pc);
  }
  return pc;
}

/**
 * Validate the column schema.
 *
 * Rules enforced:
 * 1. Column count <= MAX_FWF_COLUMNS.
 * 2. Each column: name non-empty, start >= 0, end > start, align in 'left'|'right'.
 * 3. No duplicate column names.
 * 4. No overlapping columns (sorted by start; prev.end > next.start is rejected;
 *    prev.end === next.start is allowed — adjacent/touching).
 *
 * Returns columns sorted by start ascending (for serializer gap-filling).
 */
function validateSchema(columns: readonly FwfColumn[]): readonly FwfColumn[] {
  if (columns.length > MAX_FWF_COLUMNS) {
    throw new FwfTooManyColumnsError(columns.length, MAX_FWF_COLUMNS);
  }

  const names = new Set<string>();

  for (const col of columns) {
    if (col.name.length === 0) {
      throw new FwfInvalidColumnError(col.name, 'name must not be empty');
    }
    if (col.start < 0) {
      throw new FwfInvalidColumnError(col.name, `start (${col.start}) must be >= 0`);
    }
    if (col.end <= col.start) {
      throw new FwfInvalidColumnError(
        col.name,
        `end (${col.end}) must be greater than start (${col.start}); zero-or-negative width columns are not allowed`,
      );
    }
    if (col.align !== undefined && col.align !== 'left' && col.align !== 'right') {
      throw new FwfInvalidColumnError(
        col.name,
        `align must be 'left' or 'right' but got '${col.align}'`,
      );
    }
    if (names.has(col.name)) {
      throw new FwfInvalidColumnError(col.name, 'duplicate column name');
    }
    names.add(col.name);
  }

  // Sort by start for overlap check and serializer gap-filling.
  const sorted = columns.slice().sort((a, b) => a.start - b.start);

  // Overlap check: walk consecutive pairs.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as FwfColumn;
    const next = sorted[i] as FwfColumn;
    if (prev.end > next.start) {
      throw new FwfOverlappingColumnsError(prev.name, next.name, prev.end, next.start);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a FWF document from raw bytes or an already-decoded string.
 *
 * Algorithm:
 * 1. Validate schema (count, bounds, names, overlap) — BEFORE any input work.
 * 2. Validate padChar.
 * 3. decodeInput → { text, hadBom }  (size cap, fatal UTF-8, BOM strip).
 * 4. Split lines on /\r\n|\n/.
 * 5. Cap raw line count against MAX_FWF_LINES BEFORE skip-empty walk (Trap #10).
 * 6. Walk lines:
 *    a. Skip whitespace-only lines.
 *    b. Pad short lines with padChar on the right (Trap #3 parse).
 *    c. For each column (declaration order): slice, trim per align.
 *    d. Push record.
 * 7. Return { columns, records, hadBom }.
 *
 * Lines longer than maxEnd are accepted; trailing chars after maxEnd are
 * ignored (Trap #4 — common "pad to 80/132 cols" convention).
 */
export function parseFwf(input: Uint8Array | string, opts: FwfParseOptions): FwfFile {
  // Step 1: validate schema BEFORE any input processing (fail fast).
  const sortedColumns = validateSchema(opts.columns);

  // Step 2: validate padChar.
  const padChar = resolvePadChar(opts.padChar);

  // Compute maxEnd = maximum column end index across all columns.
  // sortedColumns is guaranteed non-empty if we get here (zero columns
  // would fail validateSchema's first check only if columns.length === 0,
  // which is technically fine — just produces empty records. Handle it.)
  const maxEnd = sortedColumns.length > 0 ? Math.max(...sortedColumns.map((c) => c.end)) : 0;

  // Step 3: decode input.
  const { text, hadBom } = decodeInput(input, 'FWF', (cause) => new FwfInvalidUtf8Error(cause));

  // Step 4: split lines on \r\n | \n.
  const rawLines = text.split(/\r\n|\n/);

  // Step 5: cap raw line count BEFORE skip-empty walk (Trap #10 / design spec).
  if (rawLines.length > MAX_FWF_LINES) {
    throw new FwfTooManyLinesError(rawLines.length, MAX_FWF_LINES);
  }

  // Step 6: walk lines.
  const records: Record<string, string>[] = [];

  for (const rawLine of rawLines) {
    // 6a: skip whitespace-only lines (includes empty lines).
    if (rawLine.trim() === '') {
      continue;
    }

    // 6b: pad short lines to maxEnd with padChar (Trap #3 parse).
    // Long lines are accepted as-is; slice() handles truncation implicitly.
    const line =
      rawLine.length < maxEnd ? rawLine + padChar.repeat(maxEnd - rawLine.length) : rawLine;

    // 6c: build record — iterate columns in DECLARATION ORDER for key preservation.
    const record: Record<string, string> = {};
    for (const col of opts.columns) {
      const raw = line.slice(col.start, col.end);
      const align: FwfAlign = col.align ?? 'left';
      const value = align === 'left' ? rtrim(raw, padChar) : ltrim(raw, padChar);
      record[col.name] = value;
    }

    // 6d: push record.
    records.push(record);
  }

  return { columns: opts.columns, records, hadBom };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a FwfFile to a FWF string.
 *
 * Algorithm:
 * 1. Validate schema + padChar.
 * 2. For each record:
 *    a. Build a line buffer of maxEnd padChars (fills gaps between columns).
 *    b. For each column (sorted start-ascending):
 *       - value = record[col.name] ?? ''
 *       - If value.length > width → throw FwfFieldOverflowError (Trap #3 serialize).
 *       - Pad to width: left-aligned = value + padChar*(width-len);
 *                       right-aligned = padChar*(width-len) + value.
 *       - Write into line buffer at [start, end).
 *    c. Emit line.slice(0, maxEnd) + '\n'.
 * 3. If records.length === 0, return '' (not '\n').
 * 4. No BOM emitted (Trap #6 / BOM asymmetry).
 *
 * Note: emit exactly maxEnd characters per line — no trailing-space right-padding
 * beyond the last column's end (Trap #4 serialize: "emit exactly maxEnd chars").
 */
export function serializeFwf(file: FwfFile, opts?: FwfSerializeOptions): string {
  // Step 1: validate schema + padChar.
  const sortedColumns = validateSchema(file.columns);
  const padChar = resolvePadChar(opts?.padChar);

  if (sortedColumns.length === 0 || file.records.length === 0) {
    return '';
  }

  const maxEnd = Math.max(...sortedColumns.map((c) => c.end));

  // Step 2: serialize each record.
  let output = '';

  for (const record of file.records) {
    // 2a: start with a line of all padChars (fills declared gaps between columns).
    const lineChars: string[] = Array<string>(maxEnd).fill(padChar);

    // 2b: write each column.
    for (const col of sortedColumns) {
      const width = col.end - col.start;
      const rawValue = record[col.name] ?? '';
      const value = String(rawValue);

      if (value.length > width) {
        throw new FwfFieldOverflowError(col.name, value.length, width);
      }

      const align: FwfAlign = col.align ?? 'left';
      const padCount = width - value.length;
      let padded: string;
      if (align === 'left') {
        padded = value + padChar.repeat(padCount);
      } else {
        padded = padChar.repeat(padCount) + value;
      }

      // Write padded field into line buffer at [start, end).
      for (let k = 0; k < padded.length; k++) {
        lineChars[col.start + k] = padded[k] as string;
      }
    }

    // 2c: emit exactly maxEnd chars + '\n'.
    output += `${lineChars.join('')}\n`;
  }

  return output;
}
