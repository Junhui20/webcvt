/**
 * @webcvt/data-text — Public API
 *
 * Supported formats:
 *   JSON (RFC 8259), CSV (RFC 4180), TSV (IANA text/tab-separated-values),
 *   INI (de-facto subset), ENV (dotenv-style), JSONL (JSON Lines / NDJSON).
 *
 * Deferred (Phase 4.5+): YAML, TOML, XML, FWF, TOON.
 *
 * No auto-detection: callers must explicitly pass the format to parseDataText.
 * No cross-format conversion: use @webcvt/convert for that.
 * No schema coercion: all values returned as strings (except JSON).
 * No streaming: all operations are fully buffered.
 *
 * Security: 10 MiB input cap, UTF-8 fatal-mode decoding, JSON depth pre-scan,
 * CSV/INI/ENV row/key caps. See the design note for the full security story.
 *
 * References: RFC 8259 (JSON), RFC 4180 (CSV), IANA text/tab-separated-values
 * (TSV), Wikipedia INI article (INI), motdotla/dotenv README + 12factor.net
 * (ENV). No code copied from competing libraries.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { JsonFile, JsonValue } from './json.ts';
export type { DelimitedFile, DelimitedParseOptions } from './csv.ts';
export type { IniFile } from './ini.ts';
export type { EnvFile } from './env.ts';
export type { JsonlFile, JsonlSerializeOptions } from './jsonl.ts';
export type { DataTextFile, DataTextFormat } from './parser.ts';

// ---------------------------------------------------------------------------
// JSON API
// ---------------------------------------------------------------------------

export { parseJson, serializeJson } from './json.ts';

// ---------------------------------------------------------------------------
// CSV API
// ---------------------------------------------------------------------------

export { parseDelimited as parseCsv, serializeDelimited as serializeCsv } from './csv.ts';

// ---------------------------------------------------------------------------
// TSV API
// ---------------------------------------------------------------------------

export { parseTsv, serializeTsv } from './tsv.ts';

// ---------------------------------------------------------------------------
// INI API
// ---------------------------------------------------------------------------

export { parseIni, serializeIni } from './ini.ts';

// ---------------------------------------------------------------------------
// ENV API
// ---------------------------------------------------------------------------

export { parseEnv, serializeEnv } from './env.ts';

// ---------------------------------------------------------------------------
// JSONL API
// ---------------------------------------------------------------------------

export { parseJsonl, serializeJsonl } from './jsonl.ts';

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export { parseDataText } from './parser.ts';
export { serializeDataText } from './serializer.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export {
  DataTextBackend,
  JSON_FORMAT,
  CSV_FORMAT,
  TSV_FORMAT,
  INI_FORMAT,
  ENV_FORMAT,
  JSONL_FORMAT,
} from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  InputTooLargeError,
  InputTooManyCharsError,
  UnsupportedFormatError,
  JsonInvalidUtf8Error,
  JsonDepthExceededError,
  JsonParseError,
  CsvInvalidUtf8Error,
  CsvUnterminatedQuoteError,
  CsvUnexpectedQuoteError,
  CsvBadQuoteError,
  CsvRowCapError,
  CsvColCapError,
  CsvCellCapError,
  CsvDuplicateHeaderError,
  CsvRaggedRowError,
  IniInvalidUtf8Error,
  IniEmptyKeyError,
  IniSyntaxError,
  EnvInvalidUtf8Error,
  EnvSyntaxError,
  EnvBadEscapeError,
  JsonlInvalidUtf8Error,
  JsonlRecordParseError,
  JsonlRecordDepthExceededError,
  JsonlTooManyRecordsError,
  JsonlRecordTooLongError,
} from './errors.ts';
