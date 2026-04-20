# data-text JSONL extension design

> Second-pass extension note for `@webcvt/data-text`. Adds JSONL
> (newline-delimited JSON) to the five-format first-pass baseline
> described in `data-text.md`.
>
> Spec-only: https://jsonlines.org/ and http://ndjson.org/. Do not
> consult ndjson, ld-jsonstream, stream-json, or jsonlines libraries.

## Scope & out-of-scope

**In scope (~200 LOC source + ~100 tests):**

- JSONL / ndjson: newline-delimited JSON records. Each line holds ONE
  valid JSON value (typically an object, but any JsonValue is legal).
- Line terminators: `\n` (LF) and `\r\n` (CRLF) accepted on parse.
  Serializer emits `\n` only. Bare `\r` NOT recognised as terminator.
- Empty lines: tolerated on parse (skipped silently); see Trap #1.
- Trailing newline: optional on parse; emitted by default on serialize;
  `opts.trailingNewline: false` available.
- Single-line records: each record's JSON encoding MUST NOT contain raw
  newlines. Serializer enforces via `JSON.stringify` (escapes control
  chars inside strings). Parser rejects records with raw `\n`.
- UTF-8 encoding via existing `decodeInput` helper.
- BOM: accepted on parse (stripped, recorded as `hadBom`). NEVER emitted
  on serialize (deviation from JsonFile — see Trap #4).
- Per-record typing: each record is `JsonValue`. No schema enforcement.
- Public API: `parseJsonl`, `serializeJsonl`, `JsonlFile` interface; new
  `'jsonl'` variant in `DataTextFormat` union.

**Out of scope (deferred):**

- Streaming parse — whole-file buffering only
- Multi-line JSON records — NOT valid JSONL; rejected
- Schema validation
- Type coercion beyond `JSON.parse`'s `any`
- NDJSON vs JSON Lines distinction at API level (byte-identical)
- Record-level errors with continue-on-error — all-or-nothing parse
- Preserving empty lines on round-trip — dropped silently on parse

## JSONL format primer

```
{"id":1,"msg":"hello"}\n
{"id":2,"msg":"world"}\n
```

Each record is parsed independently. Mixed record shapes are legal; no
header, no schema. Empty file = 0 records. Whitespace-only file = 0 records.

References:
- JSON Lines: https://jsonlines.org/ — canonical, `.jsonl` extension,
  `application/jsonl` or `application/x-ndjson` MIME
- NDJSON: http://ndjson.org/ — older, defers to JSON Lines on-disk

We register `application/jsonl` as canonical MIME; accept
`application/x-ndjson` as alias.

## File map

New:
- **`src/jsonl.ts`** (~200 LOC) — `parseJsonl`, `serializeJsonl`,
  `JsonlFile`, `splitLines`.

Modified:
- `src/errors.ts` — 5 new typed errors
- `src/constants.ts` — `MAX_JSONL_RECORDS = 1_000_000`,
  `MAX_JSONL_RECORD_CHARS = 1_048_576`, MIME constants
- `src/parser.ts` — extend `DataTextFormat` + `DataTextFile`; dispatch
- `src/serializer.ts` — dispatch
- `src/backend.ts` — `JSONL_FORMAT` descriptor + MIME map entries
- `src/index.ts` — re-exports
- `../core/src/formats.ts` — add `{ext:'jsonl', mime:'application/jsonl'}`

Not modified: `detect.ts` (no magic bytes; backend gates on explicit
MIME hint only — matches first-pass policy).

Internal refactor: promote `prescanJsonDepth` from private to
module-internal shared helper in `json.ts` so `jsonl.ts` can reuse it
per-record with its own error factory.

## Type definitions

```ts
export interface JsonlFile {
  records: JsonValue[];
  hadBom: boolean;
  trailingNewline: boolean;
}

export interface JsonlSerializeOptions {
  trailingNewline?: boolean;
}

export function parseJsonl(input: Uint8Array | string): JsonlFile;
export function serializeJsonl(
  file: JsonlFile,
  opts?: JsonlSerializeOptions,
): string;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| `JsonlInvalidUtf8Error` | `JSONL_INVALID_UTF8` | Malformed UTF-8 bytes |
| `JsonlRecordParseError` | `JSONL_RECORD_PARSE` | Record fails `JSON.parse` (carries 1-based lineNumber) |
| `JsonlRecordDepthExceededError` | `JSONL_RECORD_DEPTH_EXCEEDED` | Record's nesting > MAX_JSON_DEPTH |
| `JsonlTooManyRecordsError` | `JSONL_TOO_MANY_RECORDS` | Raw line count > MAX_JSONL_RECORDS |
| `JsonlRecordTooLongError` | `JSONL_RECORD_TOO_LONG` | Single line > MAX_JSONL_RECORD_CHARS |

## Parser algorithm

1. `decodeInput(input, 'JSONL', cause => new JsonlInvalidUtf8Error(cause))` →
   `{ text, hadBom }` with size caps enforced.
2. `trailingNewline = text.endsWith('\n') || text.endsWith('\r\n')`.
3. Split lines via `/\r\n|\n/` (NOT `/\r\n?|\n/` — bare `\r` not a terminator).
4. Drop tail-empty element if `trailingNewline` is true.
5. Check `lines.length > MAX_JSONL_RECORDS` — throw `JsonlTooManyRecordsError`
   BEFORE walking (Trap #6 — defends against 10M empty lines bloating split array).
6. Walk with 1-based `lineNumber`:
   - Skip empty/whitespace-only lines (Trap #1).
   - If `line.length > MAX_JSONL_RECORD_CHARS`, throw
     `JsonlRecordTooLongError` (Trap #7).
   - Per-record depth pre-scan via shared `prescanJsonDepth` helper.
     If depth > MAX_JSON_DEPTH, throw `JsonlRecordDepthExceededError`
     (Trap #3) BEFORE `JSON.parse`.
   - `JSON.parse(line)`. On SyntaxError, wrap in `JsonlRecordParseError`
     with lineNumber. Do NOT continue — all-or-nothing.
   - Push parsed value to records.
7. Return `{ records, hadBom, trailingNewline }`.

## Serializer algorithm

1. For each record:
   - `JSON.stringify(record)` — no indent (JSONL = single line per record).
   - If result is `undefined` (invalid record like `undefined`/function),
     throw `JsonlRecordParseError` with synthetic lineNumber (Trap #8).
   - Append `\n` between records; before final record iff `trailingNewline`.
2. Do NOT emit BOM even if `file.hadBom` (Trap #4).
3. If `records.length === 0`, return `''` (NOT `'\n'`).

## Backend integration

`DataTextBackend.canHandle` accepts identity pairs:
- `application/jsonl → application/jsonl`
- `application/x-ndjson → application/x-ndjson`

Cross-alias conversion NOT supported (identity-within-format preserved).

MIME map adds two entries mapping to `'jsonl'`.

## Trap list

1. **Empty lines — skip (lenient)**. jsonlines.org §1 silent; real-world
   tooling (jq -c, pino, BigQuery) universally tolerates. We skip
   silently + document. Strict callers can pre-validate.

2. **Trailing newline — canonical = with**. Parse accepts both shapes.
   Serialize emits with `\n` by default (POSIX-friendly). Record input
   shape in `trailingNewline` for round-trip.

3. **Per-record depth bomb**. Single line `[[[[...300 deep...]]]]`
   stack-overflows `JSON.parse`. Per-line pre-scan via shared helper
   from `json.ts`. Fail fast with `JsonlRecordDepthExceededError`
   (lineNumber) BEFORE `JSON.parse`.

4. **BOM at start — strip on parse, DROP on serialize** (deviation from
   JsonFile). jsonlines.org recommends against BOM; line-oriented
   consumers (jq, grep, text editors) misinterpret BOM as part of
   first record. `hadBom` preserved for diagnostics only.

5. **CRLF normalisation on serialize → LF**. Emit `\n` only even if
   input was CRLF throughout. Windows tools handle LF fine.

6. **Line-count cap DoS** — 10 MiB of `\n\n\n...` = 10M empty lines →
   ~80 MiB array before skip filter. Check `MAX_JSONL_RECORDS =
   1_000_000` against raw split count IMMEDIATELY after split, BEFORE
   skip-empty walk. Pre-allocation defence.

7. **Per-record size cap** — one 10 MiB line with padding in string
   literals passes depth scan but exercises `JSON.parse` on 10 MiB
   string (~100 MiB peak memory). Add `MAX_JSONL_RECORD_CHARS =
   1_048_576` (1 MiB) check per line before depth scan.

8. **`JSON.stringify(undefined)` returns `undefined`** — not `"null"`.
   Caller passing `[{a:1}, undefined, {b:2}]` produces literal
   `undefined` via join → invalid JSONL. Detect `result === undefined`
   per record; throw `JsonlRecordParseError`.

9. **Duplicate keys within record** — JSON itself doesn't forbid;
   `JSON.parse` last-wins. Inherit. Documented.

10. **Bare `\r` terminator** — classic Mac NOT recognised. File using
    bare `\r` treated as single very long line → fails length cap or
    JSON parse. Error message directs callers to pre-normalise.

## Security caps

- Input byte cap (inherited): `MAX_INPUT_BYTES = 10 MiB`
- Input character cap (inherited): `MAX_INPUT_CHARS = 10_485_760`
- Per-record JSON depth (inherited): `MAX_JSON_DEPTH = 256`
- **JSONL record count** (new): `MAX_JSONL_RECORDS = 1_000_000`
- **JSONL per-record chars** (new): `MAX_JSONL_RECORD_CHARS = 1_048_576`
- UTF-8 fatal mode (inherited)
- No format auto-detection (inherited) — caller passes `'jsonl'` explicitly
- No BOM re-emission (new deviation)

All caps in `constants.ts` with JSDoc cross-referencing trap numbers.

## Test plan (16 cases)

1. TC1: happy-path object records
2. TC2: mixed record kinds (object, number, string, null, array, bool)
3. TC3: empty lines skipped
4. TC4: CRLF accepted, serializer emits LF
5. TC5: no trailing newline tolerated
6. TC6: BOM stripped on parse, NOT re-emitted on serialize
7. TC7: malformed UTF-8 → `JsonlInvalidUtf8Error`
8. TC8: per-record parse failure reports lineNumber
9. TC9: per-record depth cap rejects 257-deep on line 2
10. TC10: per-record length cap (1 MiB + 1 char)
11. TC11: record-count cap at raw-line level
12. TC12: serialize empty file = `''` (NOT `'\n'`)
13. TC13: serialize forbids undefined record
14. TC14: round-trip preserves order and values
15. TC15: `DataTextBackend.canHandle` identity + alias + cross-alias=false
16. TC16: `parseDataText(..., 'jsonl')` returns `{ kind: 'jsonl' }` branch

## Dependencies

- Reuses `decodeInput` from `utf8.ts`
- Reuses depth-scan algorithm from `json.ts` (shared helper)
- Reuses typed-error convention (`WebcvtError`)
- Native `JSON.parse` / `JSON.stringify`
- No new runtime or dev dependencies

## Clean-room policy

Implementation from JSON Lines (jsonlines.org), NDJSON (ndjson.org),
RFC 8259, ECMA-404 only. No porting from ndjson, ld-jsonstream,
stream-json, or jsonlines libraries. Depth-scan algorithm is the one
already present in `json.ts` (written clean-room per RFC 8259).

## LOC budget

| File | LOC |
|---|---|
| `jsonl.ts` | 180 |
| `errors.ts` additions (5 typed errors) | 40 |
| `constants.ts` additions | 15 |
| `parser.ts` additions | 10 |
| `serializer.ts` additions | 5 |
| `backend.ts` additions | 15 |
| `index.ts` additions | 10 |
| `../core/src/formats.ts` additions | 6 |
| Refactor: promote `prescanJsonDepth` to shared helper | 10 |
| **Source total** | **~290** |
| Tests | ~150 |
| **Grand total** | **~440** |
