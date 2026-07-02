/**
 * Cross-format value bridge for @catlabtech/webcvt-data-text.
 *
 * All ten text formats already flow through a single discriminated union,
 * `DataTextFile` (parser.ts). This module adds the missing edge: a *value
 * bridge* that lets one parsed format be re-projected as another
 * (json↔yaml, csv↔json, toml→jsonl, …) via a common plain-value model.
 *
 * ## Why a plain-value pivot (and not N² direct converters)
 * Every bridgeable format is fundamentally a tree of scalars, arrays, and
 * string-keyed maps. Rather than write O(N²) pairwise converters, we define
 * ONE canonical projection:
 *
 *     toPlain(file)  : DataTextFile  -> PlainValue   (export half)
 *     fromPlain(k,v) : PlainValue    -> DataTextFile (import half)
 *     bridge(f, to)  = fromPlain(to, toPlain(f))
 *
 * `PlainValue` is `JsonValue ∪ bigint`. The bigint arm is load-bearing:
 * YAML and TOML both carry integers as `bigint` (to preserve the
 * 2^53..2^63-1 range that `number` cannot), so a yaml↔toml bridge stays
 * lossless. Only the *import into JSON/JSONL* narrows bigint back to number,
 * and only within the IEEE-754 safe-integer range — otherwise we refuse
 * rather than silently corrupt a large id (CrossFormatValueError).
 *
 * ## Exclusions (v1)
 * - **xml** — an element tree has no canonical plain-value mapping
 *   (attributes vs. children is ambiguous, order is significant). `canBridge`
 *   returns false for xml on either side; identity xml→xml still works via the
 *   same-MIME path in DataTextBackend.
 * - **fwf** — not MIME-routable (shares text/plain with ENV) and schema-driven;
 *   left as identity-only, unchanged.
 *
 * Security posture is inherited from the per-format parsers/serializers: the
 * bridge is a pure in-memory tree transform, adds no I/O, no dependencies, and
 * never re-emits a BOM (every imported file is built with `hadBom: false` —
 * a BOM is a byte-encoding artifact of one concrete file, not a portable value).
 */

import type { DelimitedFile } from './csv.ts';
import type { EnvFile } from './env.ts';
import {
  CrossFormatNotSupportedError,
  CrossFormatShapeError,
  CrossFormatValueError,
} from './errors.ts';
import type { IniFile } from './ini.ts';
import type { JsonValue } from './json.ts';
import type { JsonlFile } from './jsonl.ts';
import type { DataTextFile, DataTextFormat } from './parser.ts';
import type { TomlDate, TomlDateTime, TomlTime, TomlValue } from './toml.ts';
import type { YamlValue } from './yaml.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Superset plain value: `JsonValue ∪ bigint`.
 *
 * The bigint arm lets integers survive a yaml↔toml bridge without dropping to
 * `number` (which cannot represent 2^53..2^63-1). JSON/JSONL import narrows it
 * back to `number` inside the safe-integer range, or refuses (see fromPlain).
 */
export type PlainValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | PlainValue[]
  | { [key: string]: PlainValue };

// ---------------------------------------------------------------------------
// Bridgeability
// ---------------------------------------------------------------------------

/**
 * The formats that participate in the value bridge. Both `xml` (no canonical
 * plain-value mapping) and `fwf` (not MIME-routable, schema-driven) are
 * excluded — see the module header.
 */
const BRIDGEABLE: ReadonlySet<DataTextFormat> = new Set<DataTextFormat>([
  'json',
  'yaml',
  'toml',
  'csv',
  'tsv',
  'jsonl',
  'ini',
  'env',
]);

/**
 * Whether a `from → to` value bridge is available. True iff BOTH sides are
 * bridgeable formats (this includes the trivial same-format pair; the backend
 * uses the cheaper identity path for those and only calls `bridge()` when the
 * kinds differ).
 */
export function canBridge(from: DataTextFormat, to: DataTextFormat): boolean {
  return BRIDGEABLE.has(from) && BRIDGEABLE.has(to);
}

// ---------------------------------------------------------------------------
// Shared value helpers
// ---------------------------------------------------------------------------

/** A string-keyed map in the plain-value model (NOT an array, NOT null). */
function isPlainObject(v: PlainValue): v is { [key: string]: PlainValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Stringify a scalar for the string-only tabular/keyed formats (CSV, TSV, INI,
 * ENV). This is the "no schema coercion" rule (index.ts): those formats store
 * only strings, so numbers/bigints/bools are rendered with their canonical
 * string form and `null` becomes the empty string (an absent/empty cell — the
 * closest representable value in a format with no null type).
 *
 * A nested object or array is a SHAPE error, not a value error: these formats
 * are flat and cannot express nesting. `context` names the offending location.
 */
function scalarToCell(v: PlainValue, context: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return String(v);
  if (v === null) return '';
  // object or array
  throw new CrossFormatShapeError(context);
}

// ---------------------------------------------------------------------------
// JSON — export is identity; import narrows bigint and rejects NaN/Inf
// ---------------------------------------------------------------------------

// The largest / smallest bigints that survive the trip into an IEEE-754
// `number` without precision loss. Number.MIN_SAFE_INTEGER === -MAX_SAFE_INTEGER.
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;

/**
 * Project a plain value into strict RFC 8259 JSON, applying the two narrowing
 * rules that JSON cannot escape:
 *   - bigint → number, but ONLY within ±2^53-1; outside that, converting would
 *     silently lose precision, so we refuse (CrossFormatValueError).
 *   - NaN / ±Infinity → refused (JSON has no literal for them; JSON.stringify
 *     would emit `null` and corrupt the value).
 * Everything else (string/boolean/null/array/object) passes through.
 */
function plainToJson(v: PlainValue): JsonValue {
  if (typeof v === 'bigint') {
    if (v > MAX_SAFE_BIGINT || v < MIN_SAFE_BIGINT) {
      throw new CrossFormatValueError(
        `bigint ${v.toString()} is outside JSON's safe-integer range (±${Number.MAX_SAFE_INTEGER}); refusing to convert to avoid silent precision loss`,
      );
    }
    return Number(v);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new CrossFormatValueError(
        `JSON cannot represent ${Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'}`,
      );
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(plainToJson);
  if (isPlainObject(v)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, val] of Object.entries(v)) out[k] = plainToJson(val);
    return out;
  }
  // string | boolean | null
  return v;
}

// ---------------------------------------------------------------------------
// TOML — dates/times become ISO 8601 strings on export; null refused on import
// ---------------------------------------------------------------------------

/** Detect the three typed TOML temporal values (they carry a `kind` tag). */
function isTomlDateLike(v: TomlValue): v is TomlDate | TomlTime | TomlDateTime {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    'kind' in v &&
    (v.kind === 'date' || v.kind === 'time' || v.kind === 'datetime')
  );
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

/**
 * Render a typed TOML temporal value as an ISO 8601 / RFC 3339 string. This is
 * lossy-but-explicit: the value stops being a typed date and becomes text (no
 * other bridgeable format has a first-class date type). Mirrors the emitter in
 * toml.ts so a toml→toml identity path (which does NOT go through the bridge)
 * and a bridged toml→…→toml agree textually.
 */
function tomlDateLikeToIso(v: TomlDate | TomlTime | TomlDateTime): string {
  if (v.kind === 'date') {
    return `${pad(v.year, 4)}-${pad(v.month, 2)}-${pad(v.day, 2)}`;
  }
  if (v.kind === 'time') {
    const base = `${pad(v.hour, 2)}:${pad(v.minute, 2)}:${pad(v.second, 2)}`;
    return v.fraction !== null ? `${base}.${v.fraction}` : base;
  }
  // datetime
  const date = `${pad(v.year, 4)}-${pad(v.month, 2)}-${pad(v.day, 2)}`;
  const timeBase = `${pad(v.hour, 2)}:${pad(v.minute, 2)}:${pad(v.second, 2)}`;
  const time = v.fraction !== null ? `${timeBase}.${v.fraction}` : timeBase;
  let offset = '';
  if (v.offsetMinutes !== null) {
    if (v.offsetMinutes === 0) {
      offset = 'Z';
    } else {
      const sign = v.offsetMinutes < 0 ? '-' : '+';
      const abs = Math.abs(v.offsetMinutes);
      offset = `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
    }
  }
  return `${date}T${time}${offset}`;
}

/** Recursively project a TOML value into the plain model (dates → ISO strings). */
function tomlValueToPlain(v: TomlValue): PlainValue {
  if (
    typeof v === 'string' ||
    typeof v === 'bigint' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v;
  }
  if (Array.isArray(v)) return v.map(tomlValueToPlain);
  if (isTomlDateLike(v)) return tomlDateLikeToIso(v);
  // Plain table.
  const out: { [key: string]: PlainValue } = {};
  for (const [k, val] of Object.entries(v)) out[k] = tomlValueToPlain(val);
  return out;
}

/** Recursively project a plain value into a TOML value (null is refused). */
function plainToTomlValue(v: PlainValue): TomlValue {
  if (v === null) {
    throw new CrossFormatValueError('TOML has no null type; a null value cannot be represented');
  }
  if (
    typeof v === 'string' ||
    typeof v === 'bigint' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v;
  }
  if (Array.isArray(v)) return v.map(plainToTomlValue);
  // object → table
  const out: { [key: string]: TomlValue } = {};
  for (const [k, val] of Object.entries(v)) out[k] = plainToTomlValue(val);
  return out;
}

/** Build a TOML root table from a plain value; the root MUST be an object. */
function plainToTomlTable(v: PlainValue): { [key: string]: TomlValue } {
  if (!isPlainObject(v)) {
    throw new CrossFormatShapeError(
      'TOML root must be a table (object); a top-level array or scalar cannot be a TOML document',
    );
  }
  const out: { [key: string]: TomlValue } = {};
  for (const [k, val] of Object.entries(v)) out[k] = plainToTomlValue(val);
  return out;
}

// ---------------------------------------------------------------------------
// CSV / TSV — two shapes: header records, or header-less scalar rows
// ---------------------------------------------------------------------------

/**
 * Export a delimited table. With a header row the parser already keyed each
 * row by header name, so we surface an array of `{header: value}` records;
 * without a header we surface an array of raw scalar-string rows. Both are
 * plain values by construction.
 */
function delimitedToPlain(file: DelimitedFile): PlainValue {
  if (file.headers !== null) {
    return (file.rows as Record<string, string>[]).map((r) => ({ ...r }));
  }
  return (file.rows as string[][]).map((r) => [...r]);
}

/**
 * Import a plain value as a delimited table. The root must be an array; the
 * shape of its FIRST element selects the mode (all elements must match):
 *   - array-of-objects  → header mode. Header = union of keys in first-seen
 *     order; missing cells become "" (empty); scalar cells are stringified.
 *   - array-of-arrays   → header-less mode. Every element is a scalar row.
 * A nested object/array inside a cell is a shape error (tables are 2-D).
 */
function plainToDelimited(v: PlainValue, delimiter: ',' | '\t'): DelimitedFile {
  if (!Array.isArray(v)) {
    throw new CrossFormatShapeError(
      'CSV/TSV root must be an array of records (objects) or an array of rows (arrays)',
    );
  }
  if (v.length === 0) {
    // No element to infer a shape from — emit an empty header-less table.
    return { delimiter, headers: null, rows: [], hadBom: false };
  }

  const first = v[0] as PlainValue;

  // Header-less mode: array of scalar rows.
  if (Array.isArray(first)) {
    const rows: string[][] = v.map((row, i) => {
      if (!Array.isArray(row)) {
        throw new CrossFormatShapeError(
          `CSV/TSV row ${i} is not an array, but row 0 is; rows must be uniformly shaped`,
        );
      }
      return row.map((cell) =>
        scalarToCell(cell, `CSV/TSV cell at row ${i} contains a nested object or array`),
      );
    });
    return { delimiter, headers: null, rows, hadBom: false };
  }

  // Header mode: array of flat records.
  if (isPlainObject(first)) {
    // Header = union of keys across all records, first-seen order preserved.
    const headers: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < v.length; i++) {
      const row = v[i] as PlainValue;
      if (!isPlainObject(row)) {
        throw new CrossFormatShapeError(
          `CSV/TSV row ${i} is not an object, but row 0 is; rows must be uniformly shaped`,
        );
      }
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k);
          headers.push(k);
        }
      }
    }
    const rows: Record<string, string>[] = v.map((row, i) => {
      const rec: Record<string, string> = {};
      const obj = row as { [key: string]: PlainValue };
      for (const h of headers) {
        const cell = obj[h];
        // Absent key → empty cell; present scalar → stringified; nested → shape error.
        rec[h] =
          cell === undefined
            ? ''
            : scalarToCell(
                cell,
                `CSV/TSV cell at row ${i} column "${h}" contains a nested object or array`,
              );
      }
      return rec;
    });
    return { delimiter, headers, rows, hadBom: false };
  }

  throw new CrossFormatShapeError(
    'CSV/TSV rows must be objects (header mode) or arrays (header-less mode), not scalars',
  );
}

// ---------------------------------------------------------------------------
// JSONL — a stream of JSON records
// ---------------------------------------------------------------------------

/**
 * Import a plain value as JSONL records. An array becomes one record per
 * element; any other value becomes a single-record document (documented — a
 * lone object/scalar is a valid one-line JSONL file). Each record obeys the
 * same bigint/NaN/Inf rules as JSON.
 */
function plainToJsonl(v: PlainValue): JsonlFile {
  const records = Array.isArray(v) ? v.map(plainToJson) : [plainToJson(v)];
  return { records, hadBom: false, trailingNewline: true };
}

// ---------------------------------------------------------------------------
// INI — a 2-level object; the __default__ section flattens to the root
// ---------------------------------------------------------------------------

/** Name the INI parser uses for keys that precede the first [section] header. */
const INI_DEFAULT_SECTION = '__default__';

/**
 * Export an INI document as a 2-level object. Keys of the synthetic
 * `__default__` section (bare keys before any header) are flattened to the
 * root; every real `[section]` becomes a nested `{key: value}` object.
 */
function iniToPlain(file: IniFile): PlainValue {
  const out: { [key: string]: PlainValue } = {};
  for (const section of file.sections) {
    const sectionData = file.data[section];
    if (sectionData === undefined) continue;
    if (section === INI_DEFAULT_SECTION) {
      for (const [k, val] of Object.entries(sectionData)) out[k] = val;
    } else {
      const inner: { [key: string]: PlainValue } = {};
      for (const [k, val] of Object.entries(sectionData)) inner[k] = val;
      out[section] = inner;
    }
  }
  return out;
}

/**
 * Import a plain object as INI. The root must be an object; each root entry is
 * either a flat object (→ a `[section]` of stringified scalars) or a scalar
 * (→ a bare key in `__default__`). Arrays and objects nested more than one
 * level deep are shape errors (INI is exactly 2 levels).
 */
function plainToIni(v: PlainValue): IniFile {
  if (!isPlainObject(v)) {
    throw new CrossFormatShapeError('INI root must be an object of sections and/or scalar keys');
  }
  const sections: string[] = [];
  // Object.create(null) mirrors the parser: adversarial keys like '__proto__'
  // must not reach Object.prototype when assigned by name.
  const data: Record<string, Record<string, string>> = Object.create(null) as Record<
    string,
    Record<string, string>
  >;
  const defaultData: Record<string, string> = Object.create(null) as Record<string, string>;
  let hasDefault = false;

  for (const [key, val] of Object.entries(v)) {
    if (Array.isArray(val)) {
      throw new CrossFormatShapeError(`INI key '${key}' is an array; INI has no array type`);
    }
    if (isPlainObject(val)) {
      const inner: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const [k, cell] of Object.entries(val)) {
        inner[k] = scalarToCell(
          cell,
          `INI section '${key}' key '${k}' is nested; INI supports only 2 levels of scalars`,
        );
      }
      data[key] = inner;
      sections.push(key);
    } else {
      // Root-level scalar → default section (a bare key with no header).
      defaultData[key] = scalarToCell(
        val,
        `INI key '${key}' is nested; INI supports only 2 levels of scalars`,
      );
      hasDefault = true;
    }
  }

  data[INI_DEFAULT_SECTION] = defaultData;
  const finalSections = hasDefault ? [INI_DEFAULT_SECTION, ...sections] : sections;
  return { sections: finalSections, data, warnings: [] };
}

// ---------------------------------------------------------------------------
// ENV — a flat map of string values
// ---------------------------------------------------------------------------

/** Export an ENV document as a flat `{key: value}` object. */
function envToPlain(file: EnvFile): PlainValue {
  const out: { [key: string]: PlainValue } = {};
  for (const key of file.keys) out[key] = file.data[key] ?? '';
  return out;
}

/**
 * Import a flat plain object as ENV. The root must be an object; every value
 * must be a scalar (stringified). Any nested object or array is a shape error
 * (ENV is a flat key/value store).
 */
function plainToEnv(v: PlainValue): EnvFile {
  if (!isPlainObject(v)) {
    throw new CrossFormatShapeError('ENV root must be a flat object of scalar values');
  }
  const keys: string[] = [];
  const data: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, val] of Object.entries(v)) {
    data[key] = scalarToCell(
      val,
      `ENV key '${key}' is nested; ENV supports only flat scalar values`,
    );
    keys.push(key);
  }
  return { keys, data, warnings: [] };
}

// ---------------------------------------------------------------------------
// Export half: DataTextFile -> PlainValue
// ---------------------------------------------------------------------------

/**
 * Project a parsed file into the canonical plain-value model.
 *
 * json/yaml are near-identity (their value trees already ARE plain values —
 * yaml keeps ints as bigint, which PlainValue permits). toml collapses typed
 * dates to ISO strings. csv/tsv/ini/env/jsonl reshape to arrays/objects.
 *
 * xml and fwf are not bridgeable and throw CrossFormatNotSupportedError.
 */
export function toPlain(file: DataTextFile): PlainValue {
  switch (file.kind) {
    case 'json':
      // JsonValue ⊂ PlainValue — already plain.
      return file.file.value;
    case 'yaml':
      // YamlValue ⊂ PlainValue (ints are bigint, floats may be .inf/.nan).
      return file.file.value;
    case 'toml':
      return tomlValueToPlain(file.file.value);
    case 'csv':
    case 'tsv':
      return delimitedToPlain(file.file);
    case 'jsonl':
      return [...file.file.records];
    case 'ini':
      return iniToPlain(file.file);
    case 'env':
      return envToPlain(file.file);
    case 'xml':
    case 'fwf':
      throw new CrossFormatNotSupportedError(file.kind, file.kind);
  }
}

// ---------------------------------------------------------------------------
// Import half: PlainValue -> DataTextFile
// ---------------------------------------------------------------------------

/**
 * Build a parsed file of `kind` from a plain value. Every imported file is
 * constructed with `hadBom: false` — a BOM belongs to one concrete byte stream
 * and must never ride along a value bridge.
 *
 * xml and fwf are not bridgeable and throw CrossFormatNotSupportedError.
 */
export function fromPlain(kind: DataTextFormat, v: PlainValue): DataTextFile {
  switch (kind) {
    case 'json':
      return { kind: 'json', file: { value: plainToJson(v), hadBom: false } };
    case 'yaml':
      // PlainValue ⊂ YamlValue — identity import (YAML represents null, bigint,
      // number incl. .inf/.nan, so nothing is refused here). Directive markers
      // are file-level artifacts and never ride along a bridge (all false).
      return {
        kind: 'yaml',
        file: {
          value: v as YamlValue,
          hadBom: false,
          hadDirectivesEndMarker: false,
          hadYamlDirective: false,
        },
      };
    case 'toml':
      return { kind: 'toml', file: { value: plainToTomlTable(v), hadBom: false } };
    case 'csv':
      return { kind: 'csv', file: plainToDelimited(v, ',') };
    case 'tsv':
      return { kind: 'tsv', file: plainToDelimited(v, '\t') };
    case 'jsonl':
      return { kind: 'jsonl', file: plainToJsonl(v) };
    case 'ini':
      return { kind: 'ini', file: plainToIni(v) };
    case 'env':
      return { kind: 'env', file: plainToEnv(v) };
    case 'xml':
    case 'fwf':
      throw new CrossFormatNotSupportedError(kind, kind);
  }
}

// ---------------------------------------------------------------------------
// Composed bridge
// ---------------------------------------------------------------------------

/**
 * Re-project a parsed file into another format: `fromPlain(to, toPlain(file))`.
 *
 * Throws CrossFormatNotSupportedError up front when either side is not
 * bridgeable (xml/fwf). Shape/value incompatibilities discovered while
 * importing surface as CrossFormatShapeError / CrossFormatValueError.
 */
export function bridge(file: DataTextFile, to: DataTextFormat): DataTextFile {
  if (!canBridge(file.kind, to)) {
    throw new CrossFormatNotSupportedError(file.kind, to);
  }
  return fromPlain(to, toPlain(file));
}
