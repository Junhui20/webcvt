# data-text TOML extension design

> Second-pass extension for `@catlabtech/webcvt-data-text`. Adds TOML v1.0.0
> (Tom's Obvious Minimal Language) alongside JSON/CSV/TSV/INI/ENV/JSONL.
>
> Spec-only: https://toml.io/en/v1.0.0. NO porting from @iarna/toml,
> smol-toml, toml (npm), fast-toml, j-toml.

## Scope

### In scope (~500-700 LOC source + ~250-350 tests)

TOML v1.0.0 full spec:
- Comments `#` to EOL
- Key/value pairs: bare / basic-quoted / literal-quoted / dotted keys
- Four string flavours: basic (`"..."`), literal (`'...'`),
  multi-line basic (`"""..."""`), multi-line literal (`'''...'''`)
- Integers: decimal / hex (`0x`) / octal (`0o`) / binary (`0b`),
  underscore separators, range [-2^63, 2^63-1]
- Floats: decimal, scientific, `inf`/`nan` (signed variants)
- Booleans: lowercase `true`/`false`
- Dates/times RFC 3339: offset date-time, local date-time, local date,
  local time (typed objects, NOT strings)
- Arrays (mixed types permitted per v1.0), inline tables, standard
  tables (`[section]`), array of tables (`[[arr]]`)

### Out of scope (deferred)

- TOML 1.1 draft
- Round-trip formatting preservation (comments dropped, blank lines
  not preserved, keys emitted in canonical order)
- v0.5 strict-mixed-type-array rejection (we follow v1.0 permissive)
- Schema-aware coercion
- Streaming parse/serialize

## File map

New:
- `src/toml.ts` (~550 LOC) — tokenizer + parser + serializer
- `src/toml.test.ts` (~300 LOC) — 28+ tests

Modified:
- `src/errors.ts` — 11 new typed errors
- `src/constants.ts` — MAX_TOML_DEPTH=64, MAX_TOML_STRING_LEN=1MiB,
  MAX_TOML_KEYS_PER_TABLE=10K, MAX_TOML_ARRAY_LEN=1M, TOML_MIME
- `src/parser.ts` / `src/serializer.ts` — dispatch
- `src/backend.ts` — TOML_FORMAT + MIME map
- `src/index.ts` — re-exports
- `packages/core/src/formats.ts` — `{ext:'toml', mime:'application/toml', category:'data'}`

## Type definitions

```ts
export interface TomlDate {
  readonly kind: 'date';
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface TomlTime {
  readonly kind: 'time';
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string | null;
}

export interface TomlDateTime {
  readonly kind: 'datetime';
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string | null;
  /** Minutes from UTC. null = local date-time. 0 = Z. */
  readonly offsetMinutes: number | null;
}

export type TomlValue =
  | string
  | bigint          // all integers — preserves 2^53..2^63 range
  | number          // floats incl. inf/nan
  | boolean
  | TomlDate
  | TomlTime
  | TomlDateTime
  | TomlValue[]
  | { [key: string]: TomlValue };

export interface TomlFile {
  value: { [key: string]: TomlValue };
  hadBom: boolean;
}

export function parseToml(input: Uint8Array | string): TomlFile;
export function serializeToml(file: TomlFile): string;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| TomlInvalidUtf8Error | TOML_INVALID_UTF8 | Malformed UTF-8 |
| TomlParseError | TOML_PARSE_ERROR | Generic parse failure (+line/col/snippet) |
| TomlDuplicateKeyError | TOML_DUPLICATE_KEY | Same key twice in same table |
| TomlRedefineTableError | TOML_REDEFINE_TABLE | [x] after x already closed |
| TomlConflictingTypeError | TOML_CONFLICTING_TYPE | Dotted key type conflict |
| TomlBadEscapeError | TOML_BAD_ESCAPE | Unknown escape in basic string |
| TomlBadNumberError | TOML_BAD_NUMBER | Overflow, leading zero, bare `_` |
| TomlBadDateError | TOML_BAD_DATE | Month 13, day 32, bad offset |
| TomlDepthExceededError | TOML_DEPTH_EXCEEDED | Nesting > MAX_TOML_DEPTH |
| TomlStringTooLongError | TOML_STRING_TOO_LONG | String token > 1 MiB |
| TomlSerializeError | TOML_SERIALIZE_ERROR | Non-serializable value |

## Trap list

1. **Dates/times are NOT strings** — typed objects with `kind`
   discriminant. Round-trip `"1979-05-27"` (literal string) and
   `1979-05-27` (date) must stay distinguishable.

2. **Integers can exceed JS safe integer** — use `bigint` always.
   TOML §Integer defines 64-bit signed; values in [2^53, 2^63-1]
   are valid but unsafe in JS number. Use `BigInt()` for decimal;
   hand-rolled digit walker for hex/oct/bin.

3. **Dotted keys define intermediate tables with conflict detection**.
   Maintain two maps per table: `definedDirectly` (explicit header/key)
   and `definedByDotted` (implicit via `a.b.c = 1`). Throw
   `TomlConflictingTypeError` / `TomlRedefineTableError` on conflict.

4. **[table] headers define AND enter; redefining throws**. Mark
   tables as "closed via header" after `[name]`. Subsequent `[name]`
   is error. Dotted-key assignments into a header-closed table from
   OUTSIDE are also errors.

5. **[[array]] appends to array-of-tables**; distinct from `[array]`.
   If x exists as non-array-of-tables, `[[x]]` throws.

6. **Multi-line basic string `\` line-ending trim** — `\` at EOL
   trims newline AND all subsequent whitespace until non-whitespace.
   Multi-line literal strings do NOT recognize this.

7. **Literal strings process NO escape sequences** — `\n` is two
   chars `\` and `n`. Multi-line literal same.

8. **Inline tables are self-contained** — one logical line, trailing
   comma before `}` FORBIDDEN (unlike arrays), closed for further
   modification after `}`.

9. **Key ordering NOT preserved on round-trip, but duplicates DO
   throw strictly**. Canonical serialize emits tables in
   dotted-path-sorted order; within-table key order preserved by
   insertion-order.

10. **`inf` / `nan` valid float tokens** — match exact bytes BEFORE
    numeric-digit branch. Signed variants `+inf`/`-inf`/`+nan`/`-nan`.
    Serializer emits `inf`/`-inf`/`nan` (never `+inf`/`+nan`).

11. **Date-time `T` can be space** — RFC 3339 §5.6 allows space in
    place of T. Tokenizer recognizes both between date/time halves only.

12. **Leading-zero decimal integers REJECTED** — `01` invalid.
    But `0` alone fine. Hex/oct/bin with leading zeros after
    prefix fine (`0x00FF`).

13. **Unicode escape validation** — `\uXXXX` exactly 4 hex digits,
    `\UXXXXXXXX` exactly 8. Reject surrogates U+D800..U+DFFF and
    values > U+10FFFF.

## Security caps

- Inherited: MAX_INPUT_BYTES (10 MiB), MAX_INPUT_CHARS (10M),
  UTF-8 fatal mode
- MAX_TOML_DEPTH = 64 (nested table/array)
- MAX_TOML_STRING_LEN = 1 MiB (per string token)
- MAX_TOML_KEYS_PER_TABLE = 10,000
- MAX_TOML_ARRAY_LEN = 1,000,000

**NO regex for string literals** — ReDoS defense against
escape-heavy inputs. Tokenizer is hand-rolled character-at-a-time
state machine, O(n) guaranteed.

BOM stripped on parse + `hadBom` recorded; NEVER emitted on serialize
(TOML spec explicitly forbids).

## Parser architecture

Recursive-descent over hand-rolled tokenizer.

Token kinds: KEY_BARE, KEY_BASIC, KEY_LITERAL, EQ, DOT, COMMA,
LBRACKET, RBRACKET, DOUBLE_LBRACKET, DOUBLE_RBRACKET, LBRACE, RBRACE,
STRING, INTEGER, FLOAT, BOOL, DATE, TIME, DATETIME, NEWLINE, EOF.

Parse phases:
1. Tokenize (linear scan; comments skipped inline; whitespace skipped
   except between date/time halves)
2. Parse statements (`key = value` / `[section]` / `[[array]]`)
3. Assemble tree with metadata map tracking `closedViaHeader`,
   `definedDirectly`, `definedByDotted`

## Serializer — canonical form

Not source-preserving:
1. Walk root collecting sections (depth-first)
2. Emit in prefix-sorted order (top-level scalars first, then child
   sections by dotted path)
3. Section header `[path]` or `[[path]]`
4. Keys in insertion order within section
5. Values: string (minimum-escape basic; multi-line basic if `\n`
   + >40 chars); bigint via `.toString()`; number via `JSON.stringify`
   or `inf`/`-inf`/`nan`; booleans as `true`/`false`; dates/times
   canonical RFC 3339 with `T` separator; short scalar arrays inline;
   long arrays multi-line with trailing comma
6. Bare keys when `[A-Za-z0-9_-]+`; else basic-quoted

## Test plan (28 cases)

1. Parse empty document → empty root
2. Parse single bare-key scalar
3. All four string flavours
4. Multiline-basic `\` line-ending trim (Trap #6)
5. Literal string no escape processing (Trap #7)
6. Integers in 4 bases with underscores
7. BigInt preserved beyond safe integer (Trap #2)
8. Leading-zero decimal rejected (Trap #12)
9. `inf`/`-inf`/`nan` (Trap #10)
10. All 4 date/time variants as typed objects (Trap #1)
11. Space-separator date-time accepted (Trap #11)
12. Dotted keys create nested tables (Trap #3)
13. Dotted-key type conflict → TomlConflictingTypeError
14. `[x]` redefinition → TomlRedefineTableError (Trap #4)
15. `[[array]]` appends (Trap #5)
16. Inline tables with nested dotted keys (Trap #8)
17. Trailing comma inside inline table → error (Trap #8)
18. Trailing comma inside multi-line array → ok
19. Surrogate escape `\uD800` rejected (Trap #13)
20. MAX_TOML_DEPTH breach → TomlDepthExceededError
21. MAX_TOML_STRING_LEN breach
22. BOM stripped + hadBom recorded
23. Malformed UTF-8 → TomlInvalidUtf8Error
24. Canonical serialize emits bigint integers, typed dates,
    inline vs section tables correctly
25. Round-trip semantic equivalence for full corpus
26. parseDataText(input, 'toml') returns { kind: 'toml' }
27. DataTextBackend canHandle identity for application/toml
28. serializeDataText dispatches correctly

## Dependencies

- Reuses `decodeInput` from utf8.ts
- Reuses `WebcvtError`, `FormatDescriptor`, `Backend` from core
- No third-party TOML libraries
- No new devDependencies

## Clean-room policy

Primary sources:
- toml.io/en/v1.0.0 prose spec
- toml.abnf v1.0.0 (CC-BY 3.0 grammar; transcribing to recursive-
  descent is spec-derived, not implementation-derived)
- RFC 3339 for date/time

Explicitly NOT consulted: @iarna/toml, smol-toml, toml npm,
fast-toml, j-toml, or any other TOML library.

## LOC budget

| File | LOC |
|---|---|
| toml.ts (tokenizer 180 + parser 220 + serializer 150) | 550 |
| errors.ts additions | 80 |
| constants.ts additions | 20 |
| parser/serializer/backend/index/formats additions | ~45 |
| **Source total** | **~695** |
| toml.test.ts | 300 |
| **Grand total** | **~995** |
