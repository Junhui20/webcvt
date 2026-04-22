# data-text design

> Implementation reference for `@catlabtech/webcvt-data-text`. Write the code from
> this note plus the linked official specs. Do not consult competing
> implementations (yaml, @iarna/toml, fast-csv, papaparse, dotenv,
> ini, fast-xml-parser) except for debugging spec-ambiguous edge cases.

## Format overview

Plain-text data-interchange formats live under one umbrella package
because they share the same browser-side runtime concerns: UTF-8
decoding via `TextDecoder` (fatal mode), input-size capping before
allocation, and a parse-only / serialize-only contract with no
schema-coercion or cross-format conversion. Every format here is
text-in / typed-AST-out and typed-AST-in / text-out — there is no
streaming binary record walking, no compression, no on-disk seeking.
The package complements `@catlabtech/webcvt-archive-zip` (binary archives) and
`@catlabtech/webcvt-image-svg` (text but XML-shaped) by handling the simple
line-oriented and key-value text formats that ride alongside binary
media in real-world pipelines (manifest sidecars, metadata exports,
config / env files).

## Scope statement

**This note covers a FIRST-PASS implementation, not full data-format
parity with libraries like js-yaml, @iarna/toml, papaparse, or
dotenv-expand.** The goal is the smallest parser/serializer pair per
format that can read and write modern, well-formed inputs in **five
formats only**: JSON, CSV, TSV, INI, and ENV. Every other format
listed in `plan.md`'s original 12-format scope is deferred to Phase
4.5+. See "Out of scope (DEFERRED)" below for the explicit deferred
list.

**In scope (first pass for `data-text`, ~1,500 LOC):**

- **JSON** (RFC 8259): wrap native `JSON.parse` and `JSON.stringify`
  with size + depth guards. Reject inputs over `MAX_INPUT_BYTES`,
  reject parse output exceeding `MAX_JSON_DEPTH = 256` via a depth-
  tracking reviver. Round-trip preserves structure (key order
  preservation is best-effort on V8 — insertion order for string
  keys, ascending for integer-like keys).
- **CSV** (RFC 4180): hand-written state-machine parser with quoting
  (`"`), quote-doubling (`""` → `"`), comma delimiter, CRLF/LF/CR
  row terminators, optional header row, embedded newlines inside
  quoted fields, optional UTF-8 BOM strip on first byte. Serializer
  emits CRLF terminators (RFC 4180 §2.1) and quotes fields that
  contain `,`, `"`, `\r`, or `\n`.
- **TSV**: thin wrapper that calls the CSV parser/serializer with
  delimiter set to `\t`. No further deviation — TSV is "CSV but
  tab-delimited" per IANA `text/tab-separated-values`.
- **INI**: parser for `[section]` headers, `key=value` (or `key:
  value`) pairs, `;` and `#` line comments, with last-key-wins on
  duplicates and a `__default__`-named section for keys appearing
  before the first header. Serializer emits sections in declaration
  order, keys in declaration order, no comments preserved.
- **ENV** (dotenv-style): `KEY=value` per line, optional `export `
  prefix tolerated and stripped, `#` line and trailing comments
  (only outside quotes), single-quoted values (literal, no escapes),
  double-quoted values with `\n`/`\t`/`\\`/`\"` escapes, raw
  unquoted values stripped of trailing whitespace.
- Public API surfaces: `parseJson`, `serializeJson`, `parseCsv`,
  `serializeCsv`, `parseTsv`, `serializeTsv`, `parseIni`,
  `serializeIni`, `parseEnv`, `serializeEnv`, plus top-level
  dispatch `parseDataText(input, format)` and
  `serializeDataText(file)` over the discriminated union.
- Round-trip parse → serialize **semantic** equivalence (NOT
  byte-identical — JSON whitespace varies, CSV quoting may quote
  more fields than strictly necessary, INI loses comments, ENV
  loses comments and original quoting style).

**Out of scope (Phase 4.5+, DEFERRED):**

- **YAML** (1.2 spec) — block scalars, anchors/aliases, tag
  resolution, and the schema system together exceed this package's
  LOC budget. Deferred to its own design note.
- **TOML** (v1.0.0) — datetime parsing, table arrays, dotted keys,
  inline tables. Deferred.
- **XML** (general-purpose, beyond the SVG-specific subset already
  in `@catlabtech/webcvt-image-svg`). Deferred.
- **JSONL** (newline-delimited JSON / NDJSON) — trivial extension
  over `JSON.parse` per line, but cut from first pass for scope.
- **FWF** (fixed-width fields) — schema-driven; needs a column-spec
  type. Deferred.
- **TOON** (token-oriented object notation, indentation-based) —
  not a widely-deployed standard; deferred pending demand.
- **Cross-format conversion** (CSV → JSON, INI → ENV, etc.) — each
  format is parse/serialize-only within its own type. Conversion
  helpers belong in a higher-level `@catlabtech/webcvt-convert` package, not
  here.
- **Schema-aware coercion** (numbers, booleans, dates inferred from
  string fields). CSV / INI / ENV values are returned as raw
  strings; callers do their own typing.
- **Streaming parse/serialize**. All operations are buffered: the
  whole input is decoded to a string, the whole output is built as
  a string. Streaming variants deferred.
- **Comment preservation** in INI / ENV. Lost on parse; absent on
  serialize.
- **Multi-document JSON / multi-line JSON** (e.g.
  `}{` concatenation). One root value per `parseJson` call.

## Official references

- IETF **RFC 8259** — The JavaScript Object Notation (JSON) Data
  Interchange Format (supersedes RFC 7159 / 4627). Defines the JSON
  grammar, UTF-8 mandate, number range guidance, and duplicate-key
  handling: https://www.rfc-editor.org/rfc/rfc8259
- ECMA-404 — The JSON Data Interchange Syntax (the same grammar as
  RFC 8259, in ECMA's house style):
  https://www.ecma-international.org/publications-and-standards/standards/ecma-404/
- IETF **RFC 4180** — Common Format and MIME Type for Comma-Separated
  Values (CSV) Files. Defines the quoted-field grammar, CRLF
  terminators, and the `text/csv` MIME type:
  https://www.rfc-editor.org/rfc/rfc4180
- IANA Media Types Registry — `text/tab-separated-values` (TSV):
  https://www.iana.org/assignments/media-types/text/tab-separated-values
- W3C **Encoding** — `TextDecoder` / `TextEncoder` interfaces,
  including the `fatal: true` option used here:
  https://encoding.spec.whatwg.org/#interface-textdecoder
- INI has no formal RFC; the de-facto reference is the Wikipedia
  description of the Windows `WritePrivateProfileString` family
  conventions: https://en.wikipedia.org/wiki/INI_file . We follow
  the most permissive subset.
- `.env` (dotenv) has no formal spec; the de-facto reference is the
  Bash POSIX shell variable assignment syntax (`name=value`,
  https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_09_01)
  plus the Heroku 12-Factor App config convention
  (https://12factor.net/config). The `dotenv` JavaScript ecosystem's
  README describes the most common syntactic extensions
  (https://github.com/motdotla/dotenv/blob/master/README.md) — we
  consult the README as a behavioural specification only, not the
  source.
- Unicode 15.1 — UTF-8 byte-sequence requirements (referenced for
  `TextDecoder` fatal-mode rejection of malformed sequences):
  https://www.unicode.org/versions/Unicode15.1.0/

## JSON format primer

A JSON document is a single root value: object `{...}`, array
`[...]`, string `"..."`, number, `true`, `false`, or `null`. Strings
are UTF-8 with `\u`-escapes for code points outside ASCII. Objects
are unordered key/value collections (per spec) but in practice every
modern parser preserves insertion order of string keys. Numbers
follow IEEE 754 double precision in JavaScript implementations,
which silently truncates integers above 2^53. Whitespace between
tokens is insignificant. The grammar is small enough that the native
`JSON.parse` is the right implementation; our wrapper adds an
input-size cap and a depth-checking reviver.

## CSV format primer

A CSV file is a sequence of records separated by CRLF (per RFC 4180)
or LF (in practice). Each record is a sequence of fields separated
by commas. Fields may be unquoted (no commas, quotes, or newlines
allowed) or quoted in `"`. Inside a quoted field, a literal `"` is
escaped as `""`, and CRLF / LF / CR is allowed as part of the field
content. The first record MAY be a header row whose fields name the
columns; the parser cannot tell from the bytes alone, so the caller
passes `{ header: true | false }`. UTF-8 BOM at the start of file is
common from spreadsheet exports and is stripped silently.

## TSV format primer

TSV is identical to CSV with the comma delimiter replaced by a TAB
(`\t`). Per IANA, fields MUST NOT contain tab or newline; quoting
is not specified. In practice, many TSV producers borrow CSV's
double-quote-doubling rule for fields containing tabs or newlines.
We accept that lenient form on parse and emit RFC-4180-style quoting
on serialize when the field contains `\t`, `"`, `\r`, or `\n`.

## INI format primer

An INI file is a sequence of lines. Each line is one of: blank,
`; comment` or `# comment`, `[section]` header, or `key=value` (or
`key: value`) pair. Sections are flat — there is no nesting; keys
appearing before any header live in a default `__default__` section.
Whitespace around keys, `=`, and values is trimmed. Quoting and
escapes are NOT part of the de-facto subset we implement: a value is
the raw remainder of the line. Duplicate keys within a section
follow last-wins semantics and emit a parse warning.

## ENV format primer

A `.env` file is a sequence of lines, each one of: blank,
`# comment`, or `KEY=value` (optionally prefixed by `export ` which
is consumed and discarded for shell-tool compatibility). Keys match
`/^[A-Za-z_][A-Za-z0-9_]*$/`. Values come in three forms: single-
quoted (literal — no escapes, no interpolation), double-quoted
(`\n`, `\t`, `\\`, `\"` escapes recognized), or unquoted (raw
remainder of line, with trailing whitespace trimmed and `#` comments
stripped from the first unquoted `#` to end-of-line). Empty values
(`KEY=`) are valid and yield `''`.

## Required structures for first pass

```ts
/** RFC 8259 JSON value tree. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonFile {
  /** Parsed root value. */
  value: JsonValue;
  /** Whether the input had a UTF-8 BOM (preserved on serialize if true). */
  hadBom: boolean;
}

/** A CSV / TSV table. Header row is optional; if present, `headers`
 *  is non-null and `rows` are objects keyed by header name; if
 *  absent, `headers` is null and `rows` are string-array tuples. */
interface DelimitedFile {
  delimiter: ',' | '\t';
  headers: string[] | null;
  rows: string[][] | Record<string, string>[];
  /** Whether the input had a UTF-8 BOM. Preserved on serialize. */
  hadBom: boolean;
}

/** INI as a flat section -> key -> value map. */
interface IniFile {
  /** Insertion-ordered section names (`'__default__'` first if any
   *  bare keys appeared before the first header). */
  sections: string[];
  /** Map of section name -> insertion-ordered key/value entries.
   *  Last-wins on duplicate key; the warning is reported via
   *  `warnings`. */
  data: Record<string, Record<string, string>>;
  /** Non-fatal parse warnings (duplicate-key, etc.). */
  warnings: string[];
}

/** ENV as an insertion-ordered key/value map. */
interface EnvFile {
  /** Insertion-ordered key names; preserved on serialize. */
  keys: string[];
  /** Key -> string value. Last-wins on duplicate; warning emitted. */
  data: Record<string, string>;
  /** Non-fatal parse warnings. */
  warnings: string[];
}

/** Discriminated union returned by the top-level dispatcher. */
type DataTextFile =
  | { kind: 'json'; file: JsonFile }
  | { kind: 'csv'; file: DelimitedFile }
  | { kind: 'tsv'; file: DelimitedFile }
  | { kind: 'ini'; file: IniFile }
  | { kind: 'env'; file: EnvFile };

export type DataTextFormat = 'json' | 'csv' | 'tsv' | 'ini' | 'env';

export function parseJson(input: Uint8Array | string): JsonFile;
export function serializeJson(file: JsonFile, opts?: { indent?: number }): string;

export interface DelimitedParseOptions { header?: boolean }
export function parseCsv(input: Uint8Array | string, opts?: DelimitedParseOptions): DelimitedFile;
export function serializeCsv(file: DelimitedFile): string;
export function parseTsv(input: Uint8Array | string, opts?: DelimitedParseOptions): DelimitedFile;
export function serializeTsv(file: DelimitedFile): string;

export function parseIni(input: Uint8Array | string): IniFile;
export function serializeIni(file: IniFile): string;

export function parseEnv(input: Uint8Array | string): EnvFile;
export function serializeEnv(file: EnvFile): string;

export function parseDataText(
  input: Uint8Array | string,
  format: DataTextFormat,
  opts?: DelimitedParseOptions,
): DataTextFile;
export function serializeDataText(file: DataTextFile): string;
```

## Parser algorithm — JSON

1. **Decode input**: if `Uint8Array`, validate `length <=
   MAX_INPUT_BYTES`, decode via `new TextDecoder('utf-8', { fatal:
   true, ignoreBOM: false })`. On `TypeError` (malformed UTF-8),
   throw `JsonInvalidUtf8Error`. Detect and strip a leading `\uFEFF`
   (U+FEFF BOM) and record `hadBom = true`. (Trap #5.)
2. **Validate string length**: a 10 MiB UTF-8 buffer can decode to
   up to 10 MiB of code points. The caller's depth + content cap
   below catches DoS via shallow huge inputs; we still bound the
   raw character length at `MAX_INPUT_CHARS = 10_485_760`.
3. **Parse with depth-tracking reviver**: call `JSON.parse(text,
   reviver)` where `reviver(key, value)` maintains a depth counter
   via a `WeakMap<object, number>` keyed on each parsed object /
   array. For each container value passed to the reviver, look up
   the parent's depth (root has depth 0); record `depth = parent +
   1`; if `depth > MAX_JSON_DEPTH` throw `JsonDepthExceededError`.
   (Trap #1.) Note: the reviver runs bottom-up, so the simpler form
   is to reject on count of `[` / `{` characters during a pre-scan,
   which is what we actually implement (cheaper, no allocations).
4. **Pre-scan depth check**: walk the source string once counting
   structural depth: `+1` on `[`/`{` outside strings, `-1` on `]`/`}`
   outside strings; track the running max. String tracking respects
   `"..."` with `\"` escapes. If max depth `> MAX_JSON_DEPTH` throw
   `JsonDepthExceededError` BEFORE calling `JSON.parse` (avoids
   stack-overflow risk inside V8).
5. **Call `JSON.parse(text)`** with no reviver. On `SyntaxError`,
   wrap in `JsonParseError` with `cause` set.
6. Return `{ value, hadBom }`.

## Serializer algorithm — JSON

1. Call `JSON.stringify(file.value, null, opts?.indent)` where
   `indent` defaults to `0` (compact, no whitespace).
2. If `file.hadBom`, prepend `\uFEFF`.
3. Return the string. Caller is responsible for UTF-8 encoding via
   `TextEncoder` if a `Uint8Array` is needed.

## Parser algorithm — CSV / TSV

A single state-machine parser with a configurable delimiter. States:
`FIELD_START`, `UNQUOTED_FIELD`, `QUOTED_FIELD`, `QUOTE_IN_QUOTED`
(after seeing `"` inside a quoted field — could be the closer or the
first half of a `""` escape).

1. **Decode input** as for JSON above. Strip leading BOM, record
   `hadBom`. Cap `text.length <= MAX_INPUT_CHARS`.
2. **Initialize**: `rows: string[][] = []`, `currentRow: string[] =
   []`, `currentField = ''`, `state = FIELD_START`, `delimiter =
   ','` or `'\t'`.
3. **Walk codeunits** (UTF-16 codeunit iteration is fine for this —
   delimiters and quotes are all ASCII). For each codeunit `c`:
   - **`FIELD_START`**:
     - `"` → `state = QUOTED_FIELD`
     - `delimiter` → push empty field, stay in `FIELD_START`
     - `\r` → if next is `\n`, consume both; finalize row; stay in
       `FIELD_START` (Trap #6).
     - `\n` → finalize row; stay in `FIELD_START`.
     - else → `currentField += c`; `state = UNQUOTED_FIELD`.
   - **`UNQUOTED_FIELD`**:
     - `delimiter` → push field, reset, `state = FIELD_START`.
     - `\r`/`\n` → finalize field + row, `state = FIELD_START`.
     - `"` → throw `CsvUnexpectedQuoteError` (RFC 4180 §2.5: `"`
       inside an unquoted field is invalid). We are strict here.
     - else → `currentField += c`.
   - **`QUOTED_FIELD`**:
     - `"` → `state = QUOTE_IN_QUOTED`.
     - else (including `\r`, `\n`, delimiter) → `currentField += c`.
       (Trap #2 — embedded newlines are valid inside quotes.)
   - **`QUOTE_IN_QUOTED`**:
     - `"` → `currentField += '"'`; `state = QUOTED_FIELD` (escaped
       quote per Trap #3).
     - `delimiter` → push field, reset, `state = FIELD_START`.
     - `\r`/`\n` → finalize, `state = FIELD_START`.
     - else → throw `CsvBadQuoteError` (a quote followed by a
       non-quote, non-delimiter, non-EOL character is malformed).
4. **End of input**: finalize any in-progress field + row. If state
   is `QUOTED_FIELD` (unterminated quoted field), throw
   `CsvUnterminatedQuoteError`. Tolerate a trailing newline (Trap
   #7) — finalize-row only adds a row if either `currentField` is
   non-empty or `currentRow` is non-empty.
5. **Apply caps incrementally**: `rows.length <= MAX_CSV_ROWS`,
   `currentRow.length <= MAX_CSV_COLS` per row, checked on each
   push. Throw `CsvRowCapError` / `CsvColCapError` on breach.
6. **Header handling**: if `opts.header === true`, take `rows[0]` as
   `headers`; map each subsequent row into a record keyed by
   header. Reject duplicate header names with
   `CsvDuplicateHeaderError`. If a row has fewer fields than
   headers, pad with `''`; if more, throw `CsvRaggedRowError`.
7. Return `{ delimiter, headers, rows, hadBom }`.

## Serializer algorithm — CSV / TSV

1. Build output string. If `hadBom`, start with `\uFEFF`.
2. If `headers !== null`, write the header row first.
3. For each row:
   - Convert `Record<string, string>` to array via `headers.map(h
     => row[h] ?? '')` if applicable.
   - For each field, decide whether to quote: any of `delimiter`,
     `"`, `\r`, `\n` present → quote and double-up internal `"`s.
     Otherwise emit raw.
   - Join fields with `delimiter`.
4. Terminate each row with `\r\n` (RFC 4180 §2.1) including the
   last row.

## Parser algorithm — INI

1. Decode input as for JSON. Cap chars.
2. Initialize: `sections = []`, `data = { __default__: {} }`,
   `currentSection = '__default__'`, `warnings = []`.
3. Split on `\r\n` | `\r` | `\n` (a single regex
   `/\r\n?|\n/`) — INI files have no quoted multi-line values in
   our subset.
4. For each line (with `lineNumber` starting at 1):
   - `trimmed = line.trim()`. If empty, skip.
   - If `trimmed[0]` is `;` or `#`, skip (comment).
   - If `trimmed` matches `/^\[(.+)\]$/`: extract section name
     (trimmed inside the brackets — Trap #8). Add to `sections` if
     new. `data[name] ??= {}`. Set `currentSection = name`. Cap
     `sections.length <= MAX_INI_SECTIONS`.
   - Else if `trimmed` contains `=` or `:`: split on the FIRST
     occurrence. `key = left.trim()`, `value = right.trim()`. If
     `key === ''` throw `IniEmptyKeyError`. If
     `data[currentSection][key]` already defined, push warning
     `"duplicate key '<section>.<key>' at line <n>; last-wins"` and
     overwrite (Trap #9). Cap total keys across all sections at
     `MAX_INI_KEYS`.
   - Else: throw `IniSyntaxError` with `lineNumber`.
5. If `data.__default__` is empty, omit it from `sections`.
6. Return `{ sections, data, warnings }`.

## Serializer algorithm — INI

1. Build string per section in `sections` order.
2. For each section, emit `[name]\n` (omit the bracket line for
   `__default__`).
3. Emit `key=value\n` for each entry in declaration order. No
   quoting, no escaping — INI does not specify either, and our
   parser does not consume them.
4. Insert one blank line between sections.

## Parser algorithm — ENV

1. Decode input as for JSON. Cap chars.
2. Initialize: `keys = []`, `data = {}`, `warnings = []`.
3. Split on `/\r\n?|\n/`. (Multi-line values are rejected — Trap
   #10.)
4. For each line (`lineNumber`):
   - `stripped = line.replace(/^\s+/, '')`. If empty after strip,
     skip.
   - If `stripped[0] === '#'`, skip (comment).
   - If `stripped.startsWith('export ')`, advance past it.
   - Match `/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/` against the
     remainder. If no match, throw `EnvSyntaxError(lineNumber)`.
   - `key = match[1]`, `rest = match[2]`.
   - **Decode value** depending on `rest[0]`:
     - `'"'`: scan forward for terminating unescaped `"`, expanding
       `\n`/`\t`/`\\`/`\"` (Trap #11). Reject any other `\x`
       escape with `EnvBadEscapeError`. After the closing `"`,
       allow optional whitespace then optional `# comment`; reject
       any other trailing non-whitespace.
     - `"'"`: scan for terminating `'`, no escapes. Same trailing-
       comment rule.
     - else: take chars up to first unquoted `#` (Trap #12); rtrim
       whitespace.
   - If `data[key]` already set, push duplicate-key warning and
     overwrite. Cap `keys.length <= MAX_ENV_KEYS`. Else push key.
5. Return `{ keys, data, warnings }`.

## Serializer algorithm — ENV

1. For each key in `keys` order:
   - If `value === ''`: emit `KEY=`.
   - Else if value matches `/^[A-Za-z0-9_./:@,+-]*$/` (safe-shell
     subset): emit `KEY=value`.
   - Else: emit `KEY="value"` with `\\`, `"`, `\n`, `\t` escaped.
2. Emit `\n` line terminator (LF only — `.env` is overwhelmingly
   Unix-line-ending in the wild; Windows tools tolerate LF).

## Top-level dispatch

`parseDataText(input, format, opts?)` switches on `format` and
returns the appropriate `{ kind, file }` discriminated union.
`serializeDataText(file)` switches on `file.kind` and dispatches to
the format's serializer. There is **no auto-detection** of format
from the bytes — the caller must declare which format they have.
This is deliberate: JSON arrays and CSV with `[` in the first cell
are hard to disambiguate, INI and ENV overlap heavily, and a
guess-wrong dispatch causes silent data corruption.

## Backend integration

`DataTextBackend` (in `backend.ts`) implements the
`@catlabtech/webcvt-core` backend interface. `canHandle(input, hint)` returns
`true` only when `hint.format` is one of the five formats above —
no magic-byte sniffing. The backend is identity-within-format:
`decode` returns the parsed `DataTextFile`; `encode` returns the
serialized string. There is no fallback chain inside this package
(unlike `archive-zip`'s bz2 / xz delegation to `backend-wasm`).

## Fixture strategy

All-synthetic in-test, like `archive-zip` — no committed binary
fixtures. Test inputs are inline string literals (these formats are
text, no binary). For `Uint8Array` inputs that exercise BOM and
UTF-8 fatal-mode paths, build the bytes inline with
`new TextEncoder().encode(...)` plus byte concatenation (BOM is
`[0xEF, 0xBB, 0xBF]`; malformed UTF-8 is `[0xC3, 0x28]`).

The pattern matches `archive-zip`'s synthetic helpers (no committed
binary fixtures). Helpers to add:

- `tests/helpers/bytes.ts` — `bom() => Uint8Array`,
  `utf8(s: string) => Uint8Array`,
  `concat(...parts: Uint8Array[]) => Uint8Array`,
  `invalidUtf8() => Uint8Array`. ~30 LOC.
- `tests/helpers/build-csv.ts` — `csv(rows: string[][], opts?:
  { delimiter?: string }): string` — emits RFC 4180 quoted output,
  used as parser input. ~40 LOC.

Round-trip tests use `serializeXxx` output as input to
`parseXxx` and assert structural equality.

## Test plan

1. `parseJson decodes a 3-key object and recovers value tree`
2. `parseJson rejects 257-deep nested array with JsonDepthExceededError`
3. `parseJson strips UTF-8 BOM and records hadBom = true`
4. `parseJson rejects malformed UTF-8 with JsonInvalidUtf8Error`
5. `parseJson rejects input over MAX_INPUT_BYTES (10 MiB)`
6. `serializeJson round-trip preserves insertion-ordered string keys`
7. `parseCsv parses a 3-row, 4-column input with header: true`
8. `parseCsv handles quote-doubling: "a""b" -> a"b`
9. `parseCsv handles embedded CRLF inside quoted field`
10. `parseCsv strips leading UTF-8 BOM`
11. `parseCsv tolerates trailing newline (no extra empty row)`
12. `parseCsv rejects unterminated quoted field with CsvUnterminatedQuoteError`
13. `parseCsv rejects bare quote in unquoted field with CsvUnexpectedQuoteError`
14. `parseCsv enforces MAX_CSV_ROWS cap`
15. `parseTsv uses tab delimiter and round-trips identically`
16. `parseIni groups keys under [section] and uses __default__ for bare keys`
17. `parseIni emits duplicate-key warning, last-wins`
18. `parseIni treats [a.b] as literal section name (no nesting)`
19. `parseEnv tolerates 'export FOO=bar' prefix`
20. `parseEnv expands \n inside double-quoted value`
21. `parseEnv strips '# comment' outside quotes, preserves it inside`
22. `parseEnv rejects raw multi-line value with EnvSyntaxError`
23. `serializeDataText round-trip preserves all five format payloads`

## Known traps

1. **JSON depth bomb**: `[[[[[[[[...]]]]]]]]` deeply nested arrays
   or objects can cause stack overflow inside V8's recursive parser
   before any user-side reviver gets a chance to react. We cannot
   intercept the stack overflow safely (it does not throw a
   catchable JS error in all engines). The defence is a **pre-scan**
   that counts maximum nesting depth in the source string BEFORE
   calling `JSON.parse`: walk codeunits once, increment on `[`/`{`
   outside strings, decrement on `]`/`}`, track the running max. If
   max `> MAX_JSON_DEPTH = 256`, throw `JsonDepthExceededError`
   without ever invoking `JSON.parse`. The pre-scan is O(n) and runs
   alongside the size cap.
2. **JSON `__proto__` pollution**: a parsed object literal
   `{"__proto__": {"polluted": true}}` does not, in modern V8,
   actually mutate `Object.prototype` (V8 `JSON.parse` defines
   `__proto__` as an own data property on the result rather than
   running the setter). However, downstream code that iterates
   parsed values and naively `Object.assign`s them into a config
   object CAN trigger pollution. We do not perform any such merge
   here, but the public API document MUST warn callers; and any
   helper we add later that normalizes a parsed JSON tree into
   another object MUST use `Object.create(null)` for the target or
   explicitly delete the `__proto__`, `constructor`, and
   `prototype` keys.
3. **CSV quote escaping**: per RFC 4180 §2.5, a literal `"` inside
   a quoted field is escaped by doubling it: `"a""b"` decodes to
   the three-character field `a"b`. The wrong instinct is
   backslash-escape (`"a\"b"` is NOT valid RFC 4180 — the `\` is
   literal and the field becomes `a\` followed by an unterminated
   start of a new field). Strip-quotes-and-keep-the-rest is also
   wrong (yields `a""b`). Our parser implements the four-state
   machine described above; the `QUOTE_IN_QUOTED` state is the
   place this trap is resolved.
4. **CSV embedded newlines**: a quoted field can contain `\r`,
   `\n`, or `\r\n` as literal data — they do not terminate the row.
   `"line1\r\nline2"` is a single field with two visible lines.
   Naive `text.split('\n')` then `line.split(',')` parsers break
   spectacularly here, splitting one field across two rows. Our
   state-machine parser handles this trivially because newlines are
   only special when state is `FIELD_START` or `UNQUOTED_FIELD`.
5. **CSV / JSON UTF-8 BOM**: many spreadsheet exports (Excel
   especially) prepend the UTF-8 BOM `0xEF 0xBB 0xBF` (which
   decodes as `\uFEFF`). Some JSON tools also emit a BOM despite
   RFC 8259 §8.1 forbidding it. Strip on first character of the
   decoded string and record `hadBom` for round-trip preservation.
   Use `TextDecoder('utf-8', { ignoreBOM: false })` so the BOM
   passes through to the string layer (default `ignoreBOM: false`
   actually KEEPS the BOM in the output — the option name is
   inverted; verify with a unit test).
6. **CSV bare-CR row terminator**: classic Mac line endings used
   `\r` alone (no `\n`). RFC 4180 specifies CRLF, but real-world
   CSVs from legacy tools may use LF-only or CR-only. Our parser
   accepts all three (`\r\n`, `\n`, `\r`) as row terminators — the
   `\r\n` case is handled by detecting `\r` and consuming the
   following `\n` if present, otherwise treating `\r` standalone as
   end-of-row.
7. **CSV trailing newline**: convention varies — some CSVs end with
   a row terminator, some don't. A naive parser that triggers
   "finalize row" on every newline will produce an extra empty row
   at the end of files that DO end with a terminator. Our parser
   sidesteps this: the end-of-input cleanup adds a row only if
   `currentField` is non-empty or `currentRow` is non-empty. Test
   both shapes.
8. **INI section names with dots**: `[section.subsection]` is
   sometimes interpreted by other tools as a nested section
   (`section -> subsection -> ...`), sometimes as a literal section
   name `"section.subsection"`. The de-facto INI subset has no
   spec. First pass: treat the entire bracket contents as a literal
   section name. Document this; callers who want hierarchy can
   split on `.` themselves.
9. **INI duplicate keys**: spec doesn't forbid them. Some tools
   first-wins, some last-wins, some collect into an array. First
   pass: last-wins with a parse warning pushed to `IniFile.warnings`.
   The warning includes the section, key, and line number so
   callers can surface it as a UI-level lint.
10. **ENV multiline values**: dotenv extensions vary widely:
    `dotenv-expand` allows `KEY="multi\nline"` with literal
    newlines inside double-quoted strings; some tools allow a
    trailing backslash for line continuation. First pass: REJECT
    raw multi-line values (a value cannot contain an unescaped
    `\n`). The ONLY way to express a newline inside an ENV value is
    the `\n` escape inside double quotes. This matches the most
    conservative dotenv subset and avoids ambiguity with the
    line-by-line parser shape.
11. **ENV escape handling inside double quotes**: the recognised
    escapes are `\n` (LF), `\t` (TAB), `\\` (backslash), and `\"`
    (quote). Any other `\x` is REJECTED with `EnvBadEscapeError` —
    we do not silently pass `\r` or `\u00XX` through, because
    different dotenv implementations disagree on those. Document
    the exact set in the README.
12. **ENV trailing comments inside unquoted values**:
    `FOO=bar # comment` — naive implementations include the entire
    `bar # comment` literal as the value. The dotenv convention
    strips from the first unquoted `#` to end-of-line (with
    surrounding whitespace also stripped). Our parser does the
    strip for unquoted values. Inside double or single quotes, the
    `#` is literal. Document that `KEY=foo#bar` (no space) yields
    `foo` (NOT `foo#bar`) — a `#` in an unquoted value is ALWAYS a
    comment delimiter even with no leading space; this matches
    `motdotla/dotenv` behaviour.
13. **`TextDecoder` fatal-mode requirement**: the default
    `TextDecoder('utf-8')` silently replaces malformed bytes with
    U+FFFD REPLACEMENT CHARACTER, which corrupts data without
    throwing. For data-interchange files (where the caller almost
    certainly meant to give us valid UTF-8), we use
    `{ fatal: true, ignoreBOM: false }` so malformed UTF-8 throws a
    `TypeError` we can wrap in our typed `*InvalidUtf8Error`.
    Document that the package only supports UTF-8 input.
14. **`JSON.stringify` and `undefined` / functions**: object values
    of type `undefined` or `function` are silently dropped from the
    output, and `undefined` inside an array becomes `null`.
    `Symbol`-keyed properties are dropped. Our `JsonValue` type
    forbids these by construction, but the runtime check happens
    inside `JSON.stringify`, not before — document that callers
    passing untyped `unknown` must filter first.
15. **`JSON.parse` integer precision loss**: numbers above
    `Number.MAX_SAFE_INTEGER` (`2^53 - 1`) silently lose precision
    when parsed as JS `number`. The IDs `9007199254740993` and
    `9007199254740992` both parse to `9007199254740992`. We do not
    fix this in first pass — the JSON spec allows it implicitly via
    "interoperable subset" guidance. Callers that need BigInt
    handling for large IDs must pre-process the string. Document
    this in the README.

## Security caps

- **Per-format input cap**: 10 MiB (`MAX_INPUT_BYTES = 10 * 1024 *
  1024`). Larger is suspicious or accidentally a binary file.
  Checked at the `Uint8Array.length` boundary before TextDecoder.
- **Decoded character cap**: 10,485,760 (`MAX_INPUT_CHARS`).
  Enforced after TextDecoder in case decoding amplifies size
  (rare but possible for some inputs).
- **JSON depth cap**: 256 (`MAX_JSON_DEPTH`). Pre-scan rejects
  deeper inputs before `JSON.parse` is invoked.
- **CSV row cap**: 1,000,000 (`MAX_CSV_ROWS`).
- **CSV column cap**: 1,024 per row (`MAX_CSV_COLS`).
- **INI section cap**: 1,024 (`MAX_INI_SECTIONS`).
- **INI key cap**: 100,000 across all sections (`MAX_INI_KEYS`).
- **ENV key cap**: 100,000 (`MAX_ENV_KEYS`).
- **All multi-byte length validation BEFORE allocation**: cap
  checks happen inline during the scan / state machine, not after
  buffering the whole result.
- **`TextDecoder` fatal mode for malformed UTF-8**: rejects rather
  than silently producing U+FFFD. Wrap the `TypeError` in a typed
  `*InvalidUtf8Error`.
- **Reject `__proto__` / `constructor` / `prototype` keys** in any
  helper that NORMALIZES parsed JSON into a plain object. The base
  `parseJson` does not normalize and so leaves these keys in
  place — their presence is captured in the parsed tree but not
  applied to any prototype chain (V8 `JSON.parse` correctness
  noted in Trap #2).
- **No format auto-detection**: caller must pass `format`
  explicitly to `parseDataText`. This avoids silent corruption
  from misclassified inputs.

## LOC budget breakdown

| File | LOC est. |
|---|---|
| `json.ts` (parse + serialize wrappers, depth pre-scan, BOM handling) | 80 |
| `csv.ts` (RFC 4180 state-machine parser + serializer; TSV reuses with tab delim) | 250 |
| `tsv.ts` (thin wrapper over csv with tab delimiter) | 30 |
| `ini.ts` (parser + serializer; section + key=value + `;`/`#` comments + duplicate-warning) | 150 |
| `env.ts` (dotenv-style parser + serializer; quoting, escape decode, trailing comments) | 120 |
| `utf8.ts` (TextDecoder fatal wrapper, BOM strip / preserve, char-cap enforcement) | 60 |
| `parser.ts` (top-level dispatch by format; returns `DataTextFile` discriminated union) | 80 |
| `serializer.ts` (top-level dispatch by `file.kind`) | 60 |
| `backend.ts` (`DataTextBackend` implementing `@catlabtech/webcvt-core` backend; identity-within-format) | 100 |
| `errors.ts` (typed errors per format: `JsonParseError`, `CsvUnterminatedQuoteError`, etc.) | 60 |
| `constants.ts` (size/depth/row/col caps) | 30 |
| `index.ts` (public re-exports) | 40 |
| **total** | **~1060** |
| tests | ~600 |

Headline plan.md budget for first-pass `data-text`: ~1,500 LOC.
Realistic: ~1,060 source + ~600 tests = ~1,660 LOC total.
Acceptable; the under-spend on source vs. budget reflects that JSON
delegates to a native API and TSV reuses CSV. Phase 4.5 will add
YAML / TOML / XML / JSONL / FWF / TOON, each in its own file.

## Implementation references (for the published README)

This package is implemented from IETF RFC 8259 (JSON Data
Interchange Format), ECMA-404 (JSON Data Interchange Syntax), IETF
RFC 4180 (CSV), the IANA `text/tab-separated-values` registration
(TSV), the de-facto Windows INI conventions documented in the
Wikipedia INI article, and the de-facto dotenv conventions
documented in the Heroku 12-Factor App config guide and the
`motdotla/dotenv` README (consulted as a behavioural specification
only, not the source). UTF-8 decoding follows the WHATWG Encoding
spec via the browser-native `TextDecoder('utf-8', { fatal: true })`
interface. No code was copied from yaml, @iarna/toml, fast-csv,
papaparse, csv-parse, dotenv, dotenv-expand, ini, or
fast-xml-parser. JSON parsing delegates to the host's native
`JSON.parse` / `JSON.stringify`; the depth check is a pre-scan over
the source string, not a reviver, to avoid V8 stack-overflow
exposure. No binary fixtures are committed; every test constructs
inputs as inline string literals or via small helpers in
`tests/helpers/bytes.ts` and `tests/helpers/build-csv.ts`.
YAML / TOML / XML / JSONL / FWF / TOON are deferred to Phase 4.5+
under separate design notes.
