/**
 * Top-level dispatch parser for @webcvt/data-text.
 *
 * parseDataText(input, format, opts?) switches on format and returns the
 * appropriate DataTextFile discriminated union variant.
 *
 * There is NO auto-detection of format from bytes — the caller must declare
 * which format they have. This is deliberate: JSON arrays and CSV with '['
 * in the first cell are hard to disambiguate, INI and ENV overlap heavily,
 * and a guess-wrong dispatch causes silent data corruption.
 */

import { type DelimitedParseOptions, parseDelimited } from './csv.ts';
import type { DelimitedFile } from './csv.ts';
import { type EnvFile, parseEnv } from './env.ts';
import { type IniFile, parseIni } from './ini.ts';
import { type JsonFile, parseJson } from './json.ts';
import { type JsonlFile, parseJsonl } from './jsonl.ts';
import { type TomlFile, parseToml } from './toml.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The seven text formats supported (five first-pass + JSONL + TOML extensions). */
export type DataTextFormat = 'json' | 'csv' | 'tsv' | 'ini' | 'env' | 'jsonl' | 'toml';

/** Discriminated union returned by the top-level dispatcher. */
export type DataTextFile =
  | { kind: 'json'; file: JsonFile }
  | { kind: 'csv'; file: DelimitedFile }
  | { kind: 'tsv'; file: DelimitedFile }
  | { kind: 'ini'; file: IniFile }
  | { kind: 'env'; file: EnvFile }
  | { kind: 'jsonl'; file: JsonlFile }
  | { kind: 'toml'; file: TomlFile };

// Re-export sub-types so callers can import from parser.ts if desired.
export type { JsonFile, DelimitedFile, IniFile, EnvFile, JsonlFile, TomlFile };
export type { DelimitedParseOptions };

// ---------------------------------------------------------------------------
// Top-level parser
// ---------------------------------------------------------------------------

/**
 * Parse a text document of the given format.
 *
 * @param input   Raw bytes (Uint8Array) or decoded string.
 * @param format  One of 'json' | 'csv' | 'tsv' | 'ini' | 'env'.
 * @param opts    Optional parse options (header row for CSV/TSV).
 */
export function parseDataText(
  input: Uint8Array | string,
  format: DataTextFormat,
  opts?: DelimitedParseOptions,
): DataTextFile {
  switch (format) {
    case 'json':
      return { kind: 'json', file: parseJson(input) };
    case 'csv':
      return { kind: 'csv', file: parseDelimited(input, ',', opts) };
    case 'tsv':
      return { kind: 'tsv', file: parseDelimited(input, '\t', opts) };
    case 'ini':
      return { kind: 'ini', file: parseIni(input) };
    case 'env':
      return { kind: 'env', file: parseEnv(input) };
    case 'jsonl':
      return { kind: 'jsonl', file: parseJsonl(input) };
    case 'toml':
      return { kind: 'toml', file: parseToml(input) };
  }
}
