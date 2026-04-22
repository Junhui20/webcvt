/**
 * Top-level dispatch parser for @catlabtech/webcvt-data-text.
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
import { type FwfFile, type FwfParseOptions, parseFwf } from './fwf.ts';
import { type IniFile, parseIni } from './ini.ts';
import { type JsonFile, parseJson } from './json.ts';
import { type JsonlFile, parseJsonl } from './jsonl.ts';
import { type TomlFile, parseToml } from './toml.ts';
import { type XmlFile, parseXml } from './xml.ts';
import { type YamlFile, parseYaml } from './yaml.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The ten text formats supported (five first-pass + JSONL + TOML + FWF + XML + YAML extensions). */
export type DataTextFormat =
  | 'json'
  | 'csv'
  | 'tsv'
  | 'ini'
  | 'env'
  | 'jsonl'
  | 'toml'
  | 'fwf'
  | 'xml'
  | 'yaml';

/** Discriminated union returned by the top-level dispatcher. */
export type DataTextFile =
  | { kind: 'json'; file: JsonFile }
  | { kind: 'csv'; file: DelimitedFile }
  | { kind: 'tsv'; file: DelimitedFile }
  | { kind: 'ini'; file: IniFile }
  | { kind: 'env'; file: EnvFile }
  | { kind: 'jsonl'; file: JsonlFile }
  | { kind: 'toml'; file: TomlFile }
  | { kind: 'fwf'; file: FwfFile }
  | { kind: 'xml'; file: XmlFile }
  | { kind: 'yaml'; file: YamlFile };

// Re-export sub-types so callers can import from parser.ts if desired.
export type {
  JsonFile,
  DelimitedFile,
  IniFile,
  EnvFile,
  JsonlFile,
  TomlFile,
  FwfFile,
  XmlFile,
  YamlFile,
};
export type { DelimitedParseOptions, FwfParseOptions };

// ---------------------------------------------------------------------------
// Top-level parser — overloads
// ---------------------------------------------------------------------------

/**
 * Parse a FWF document. FwfParseOptions (including `columns`) is REQUIRED
 * because FWF has no auto-detectable schema — the caller must always declare
 * the column layout.
 *
 * Note: FWF shares `text/plain` MIME with ENV. The DataTextBackend.canHandle
 * MIME routing CANNOT disambiguate them. FWF is reachable ONLY via this
 * explicit 'fwf' format argument or the direct parseFwf / serializeFwf API.
 */
export function parseDataText(
  input: Uint8Array | string,
  format: 'fwf',
  opts: FwfParseOptions,
): DataTextFile;

/**
 * Parse a non-FWF text document. opts is optional (used for CSV/TSV header row).
 */
export function parseDataText(
  input: Uint8Array | string,
  format: Exclude<DataTextFormat, 'fwf'>,
  opts?: DelimitedParseOptions,
): DataTextFile;

/**
 * Parse a text document of the given format.
 *
 * @param input   Raw bytes (Uint8Array) or decoded string.
 * @param format  One of 'json' | 'csv' | 'tsv' | 'ini' | 'env' | 'jsonl' | 'toml' | 'fwf' | 'xml'.
 * @param opts    For 'fwf': FwfParseOptions (required). For 'csv'/'tsv': DelimitedParseOptions (optional).
 */
export function parseDataText(
  input: Uint8Array | string,
  format: DataTextFormat,
  opts?: DelimitedParseOptions | FwfParseOptions,
): DataTextFile {
  switch (format) {
    case 'json':
      return { kind: 'json', file: parseJson(input) };
    case 'csv':
      return { kind: 'csv', file: parseDelimited(input, ',', opts as DelimitedParseOptions) };
    case 'tsv':
      return { kind: 'tsv', file: parseDelimited(input, '\t', opts as DelimitedParseOptions) };
    case 'ini':
      return { kind: 'ini', file: parseIni(input) };
    case 'env':
      return { kind: 'env', file: parseEnv(input) };
    case 'jsonl':
      return { kind: 'jsonl', file: parseJsonl(input) };
    case 'toml':
      return { kind: 'toml', file: parseToml(input) };
    case 'fwf':
      return { kind: 'fwf', file: parseFwf(input, opts as FwfParseOptions) };
    case 'xml':
      return { kind: 'xml', file: parseXml(input) };
    case 'yaml':
      return { kind: 'yaml', file: parseYaml(input) };
  }
}
