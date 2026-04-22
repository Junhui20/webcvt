/**
 * JSONL (JSON Lines / NDJSON) parse/serialize for @catlabtech/webcvt-data-text.
 *
 * Each line in a JSONL file holds one valid JSON value. Lines are separated
 * by LF (`\n`) or CRLF (`\r\n`). Bare `\r` is NOT recognised as a line
 * terminator (Trap #10).
 *
 * References: https://jsonlines.org/  and  http://ndjson.org/
 * Clean-room: no code ported from ndjson, ld-jsonstream, stream-json, or
 * jsonlines npm packages.
 *
 * ## Traps honoured
 * #1  Empty/whitespace-only lines are skipped silently.
 * #2  Trailing newline optional on parse; emitted by default on serialize.
 * #3  Per-record depth pre-scan via shared prescanJsonDepth BEFORE JSON.parse.
 * #4  BOM stripped on parse; NEVER re-emitted on serialize (deviation from JsonFile).
 * #5  CRLF normalised to LF on serialize (serializer emits \n only).
 * #6  Record-count cap on raw split line count BEFORE skip-empty walk.
 * #7  Per-record length cap BEFORE depth scan.
 * #8  JSON.stringify(undefined) → undefined detection → JsonlRecordParseError.
 * #9  Duplicate keys within a record: JSON.parse last-wins (inherited, documented).
 * #10 Bare \r NOT recognised as line terminator.
 *
 * ## Security caps
 * - Input byte/char cap: inherited from decodeInput (MAX_INPUT_BYTES / MAX_INPUT_CHARS).
 * - Per-record depth: MAX_JSON_DEPTH = 256 (shared constant).
 * - Record count: MAX_JSONL_RECORDS = 1,000,000.
 * - Per-record chars: MAX_JSONL_RECORD_CHARS = 1,048,576 (1 MiB).
 */

import { MAX_JSONL_RECORDS, MAX_JSONL_RECORD_CHARS, MAX_JSON_DEPTH } from './constants.ts';
import {
  JsonlInvalidUtf8Error,
  JsonlRecordDepthExceededError,
  JsonlRecordParseError,
  JsonlRecordTooLongError,
  JsonlTooManyRecordsError,
} from './errors.ts';
import { prescanJsonDepth } from './json.ts';
import type { JsonValue } from './json.ts';
import { decodeInput } from './utf8.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A parsed JSONL document. */
export interface JsonlFile {
  /** Ordered array of parsed JSON values — one per non-empty line. */
  records: JsonValue[];
  /** Whether the input started with a UTF-8 BOM. Preserved for diagnostics only;
   *  BOM is NEVER re-emitted on serialize (Trap #4). */
  hadBom: boolean;
  /** Whether the input ended with a newline (`\n` or `\r\n`).
   *  Captured for round-trip fidelity reporting; does not affect parse. */
  trailingNewline: boolean;
}

/** Options for serializeJsonl. */
export interface JsonlSerializeOptions {
  /**
   * Whether to append a trailing `\n` after the last record.
   * Defaults to `true` (POSIX-friendly — most JSONL tools expect it).
   * Pass `false` to suppress the trailing newline.
   */
  trailingNewline?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split `text` on LF and CRLF only (NOT bare \r — Trap #10).
 * Returns raw segments; does NOT strip the trailing empty element yet.
 */
function splitLines(text: string): string[] {
  // /\r\n|\n/ — matches CRLF first (greedy left-to-right), then standalone LF.
  // Bare \r is treated as ordinary content (Trap #10).
  return text.split(/\r\n|\n/);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL document from raw bytes or an already-decoded string.
 *
 * Algorithm:
 * 1. decodeInput → { text, hadBom }  (size cap, fatal UTF-8, BOM strip).
 * 2. Record trailingNewline from text tail.
 * 3. Split on /\r\n|\n/ — NOT bare \r (Trap #10).
 * 4. Drop the trailing empty element produced by the trailing newline (Trap #2).
 * 5. Cap raw line count against MAX_JSONL_RECORDS BEFORE walking (Trap #6).
 * 6. Walk lines with 1-based lineNumber:
 *    a. Skip empty / whitespace-only lines (Trap #1).
 *    b. Cap line length against MAX_JSONL_RECORD_CHARS (Trap #7).
 *    c. Per-record depth pre-scan (Trap #3) — throws JsonlRecordDepthExceededError.
 *    d. JSON.parse — wraps SyntaxError in JsonlRecordParseError.
 *    e. Push to records.
 * 7. Return { records, hadBom, trailingNewline }.
 */
export function parseJsonl(input: Uint8Array | string): JsonlFile {
  // Step 1: decode
  const { text, hadBom } = decodeInput(input, 'JSONL', (cause) => new JsonlInvalidUtf8Error(cause));

  // Step 2: detect trailing newline BEFORE splitting (Trap #2).
  // Any string ending in \r\n also ends in \n, so the second clause is
  // redundant — the LF check alone is sufficient.
  const trailingNewline = text.endsWith('\n');

  // Step 3: split on LF / CRLF only (Trap #10)
  const lines = splitLines(text);

  // Step 4: remove the trailing empty element created by the trailing newline.
  // splitLines('a\nb\n') → ['a', 'b', ''] — drop the last ''.
  if (trailingNewline && lines.length > 0) {
    lines.pop();
  }

  // Step 5: record-count cap BEFORE skip-empty walk (Trap #6)
  if (lines.length > MAX_JSONL_RECORDS) {
    throw new JsonlTooManyRecordsError(lines.length, MAX_JSONL_RECORDS);
  }

  // Step 6: walk
  const records: JsonValue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based
    // `lines` is a string[] from String.prototype.split walked by a
    // bounded index, so lines[i] is always a string here.
    const line = lines[i] as string;

    // 6a: skip empty / whitespace-only lines (Trap #1)
    if (line.trim() === '') {
      continue;
    }

    // 6b: per-record length cap BEFORE depth scan (Trap #7)
    if (line.length > MAX_JSONL_RECORD_CHARS) {
      throw new JsonlRecordTooLongError(lineNumber, line.length, MAX_JSONL_RECORD_CHARS);
    }

    // 6c: depth pre-scan BEFORE JSON.parse (Trap #3)
    prescanJsonDepth(
      line,
      (depth, max) => new JsonlRecordDepthExceededError(lineNumber, depth, max),
    );

    // 6d: parse
    let value: JsonValue;
    try {
      value = JSON.parse(line) as JsonValue;
    } catch (err) {
      throw new JsonlRecordParseError(lineNumber, err);
    }

    // 6e: push
    records.push(value);
  }

  return { records, hadBom, trailingNewline };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a JsonlFile to a JSONL string.
 *
 * Algorithm:
 * 1. For each record, call JSON.stringify (no indent — JSONL = one line per record).
 * 2. Detect undefined result (Trap #8 — undefined / Function values) and throw
 *    JsonlRecordParseError with a synthetic 1-based lineNumber.
 * 3. Join records with '\n'.
 * 4. Append trailing '\n' if opts.trailingNewline !== false (default true).
 * 5. Do NOT emit BOM even if file.hadBom === true (Trap #4).
 * 6. Empty file returns '' (NOT '\n') regardless of trailingNewline (Trap #2).
 *
 * Note (Trap #5): serializer always emits LF (\n). JSON.stringify does not
 * produce raw newlines inside string values; it escapes them as \n. So there
 * is no CRLF → LF normalisation needed on the output side.
 *
 * Note (Trap #9): duplicate keys within an input record are inherited from
 * JSON.parse last-wins semantics. On re-serialize, the last-wins value survives
 * and duplicates are dropped — this is a semantic round-trip, not byte-identical.
 */
export function serializeJsonl(file: JsonlFile, opts?: JsonlSerializeOptions): string {
  const { records } = file;
  const emitTrailingNewline = opts?.trailingNewline !== false;

  // Empty file → '' regardless of trailingNewline (Trap #2)
  if (records.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const lineNumber = i + 1; // 1-based synthetic number for error reporting
    const record = records[i];
    const serialized = JSON.stringify(record);

    // Trap #8: JSON.stringify returns undefined for undefined, Function, Symbol values
    if (serialized === undefined) {
      throw new JsonlRecordParseError(
        lineNumber,
        new TypeError(
          `JSON.stringify returned undefined for record at index ${i}. Records of type undefined, Function, or Symbol cannot be serialized to JSONL.`,
        ),
      );
    }

    lines.push(serialized);
  }

  const body = lines.join('\n');
  return emitTrailingNewline ? `${body}\n` : body;
}
