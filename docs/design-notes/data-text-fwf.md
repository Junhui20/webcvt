# data-text FWF extension design

> Second-pass extension for `@webcvt/data-text`. Adds FWF (Fixed-Width
> Format / flat file / column-aligned text). Clean-room: NO porting
> from pandas `read_fwf`, polars, SAS INPUT, awk FIELDWIDTHS, or any
> `*-fwf-*` npm package. No published spec; implementation derived
> from `String.slice()` + per-column trim.

## Scope

### In scope (~200-360 LOC source + ~180 tests)

- Parse: caller supplies `columns: FwfColumn[]`; parser slices each line
  by `[start, end)` and trims per-column `align` direction.
- Serialize: caller supplies records + schema; pads each field to its
  declared width.
- Line terminators: `\n` or `\r\n` on parse; `\n` on serialize.
- Empty/whitespace-only lines skipped on parse.
- BOM stripped + `hadBom` recorded; NEVER emitted on serialize (matches
  JSONL/TOML convention).
- Default pad char `' '` configurable.
- Default `align: 'left'` configurable per column.
- All field values typed as `string`; no coercion.

### Out of scope (deferred)

- Format auto-detection (no magic bytes; overlaps with text/plain)
- Auto-discovery of column widths
- Multi-line records
- Record-level variants (fixed + delimited hybrids)
- Type coercion
- Non-ASCII-aware width math (UTF-16 code units; ASCII-only guarantees
  correctness)
- Streaming

## Format primer

Each line = one record. Each field occupies a caller-declared character
range. No delimiters. Typically space-padded. No published spec.

Example (name 0-10, age 10-13, city 13-23):
```
Alice     023New York
Bob       045London
```

## File map

New:
- `src/fwf.ts` (~220 LOC) — schema validator + parser + serializer + helpers
- `src/fwf.test.ts` (~180 LOC) — 18+ tests

Modified:
- `src/errors.ts` — 6 new typed errors
- `src/constants.ts` — `MAX_FWF_COLUMNS=1024`, `MAX_FWF_LINES=1M`, `FWF_MIME`
- `src/parser.ts` — overloads for `'fwf'` requiring `FwfParseOptions`
- `src/serializer.ts` — dispatch
- `src/backend.ts` — FWF_FORMAT descriptor (text/plain shared with ENV; NOT
  in MIME_TO_FORMAT due to ambiguity; direct API only)
- `src/index.ts` — re-exports
- `packages/core/src/formats.ts` — `{ ext: 'fwf', mime: 'text/plain', category: 'data', description: 'Fixed-Width Format' }`

**Critical constraint**: FWF shares `text/plain` MIME with ENV. The existing
`DataTextBackend.canHandle` MIME-only routing CANNOT disambiguate them. FWF
is reachable ONLY via direct `parseFwf` / `serializeFwf` API or via
`parseDataText(input, 'fwf', { columns })` — NOT via the backend's
`canHandle`+`convert` path.

## Type definitions

```ts
export type FwfAlign = 'left' | 'right';

export interface FwfColumn {
  readonly name: string;
  readonly start: number; // 0-based inclusive
  readonly end: number;   // 0-based EXCLUSIVE (matches String.slice)
  readonly align?: FwfAlign; // default 'left'
}

export interface FwfFile {
  readonly columns: readonly FwfColumn[];
  readonly records: ReadonlyArray<Readonly<Record<string, string>>>;
  readonly hadBom: boolean;
}

export interface FwfParseOptions {
  columns: readonly FwfColumn[];
  padChar?: string; // default ' ', must be exactly 1 UTF-16 code unit
}

export interface FwfSerializeOptions {
  padChar?: string;
}

export function parseFwf(input: Uint8Array | string, opts: FwfParseOptions): FwfFile;
export function serializeFwf(file: FwfFile, opts?: FwfSerializeOptions): string;
```

## Typed errors

| Class | Code | Thrown when |
|---|---|---|
| `FwfInvalidUtf8Error` | `FWF_INVALID_UTF8` | Malformed UTF-8 |
| `FwfOverlappingColumnsError` | `FWF_OVERLAPPING_COLUMNS` | Two columns overlap |
| `FwfInvalidColumnError` | `FWF_INVALID_COLUMN` | Bad start/end/name/align |
| `FwfTooManyColumnsError` | `FWF_TOO_MANY_COLUMNS` | > MAX_FWF_COLUMNS |
| `FwfTooManyLinesError` | `FWF_TOO_MANY_LINES` | Raw line count > MAX_FWF_LINES |
| `FwfFieldOverflowError` | `FWF_FIELD_OVERFLOW` | Serialize: value longer than declared width |
| `FwfBadPadCharError` | `FWF_BAD_PAD_CHAR` | padChar length ≠ 1 |

## Traps

1. **Column range semantics: 0-based half-open `[start, end)`** — matches
   `String.slice()`. Document prominently. IRS-style 1-based specs are a
   caller translation: `{ start: irs_start - 1, end: irs_end }`.

2. **Overlapping columns: REJECT.** Sort by start; walk pairs; reject
   `prev.end > next.start`. Adjacent (touching `prev.end === next.start`)
   is allowed. Zero-or-negative width (`end <= start`) also rejected.

3. **Line shorter than maxEnd**: PAD with padChar on PARSE (real-world
   producers truncate trailing spaces). On SERIALIZE: if value length >
   declared width → throw `FwfFieldOverflowError` (NEVER truncate
   silently).

4. **Line LONGER than maxEnd**: accept on parse; trailing chars ignored
   (common "pad to 80/132 cols" convention). On serialize, emit exactly
   maxEnd chars — no total-width right-padding.

5. **UTF-16 code unit width math**: JS string indices are UTF-16 code
   units. ASCII-only → trivially correct. Astral/emoji (🎉) = 2 code
   units; schema that splits mid-surrogate produces unpaired surrogates.
   Document: restrict schemas to ASCII-safe boundaries. Pad char MUST be
   exactly 1 code unit.

6. **BOM asymmetry with CSV/JSON**: FWF follows JSONL/TOML convention —
   stripped on parse, hadBom recorded, NEVER emitted on serialize.
   Leading BOM would shift every column by 1 code unit.

7. **Pad char asymmetry**: trimming uses single `opts.padChar` uniformly.
   If producer used '0' for numeric columns and ' ' for text, caller
   either sets padChar='0' (and accepts text fields as padded string) or
   post-processes. Literal round-trip preserved.

8. **Empty vs whitespace-only field collapse**: a 10-space field and a
   fully padded field both parse to `''`; both re-serialize to 10 spaces.
   Semantic round-trip only.

## Security caps

Inherited: `MAX_INPUT_BYTES=10 MiB`, `MAX_INPUT_CHARS=10M`, UTF-8 fatal.

New:
- `MAX_FWF_COLUMNS = 1024` — matches MAX_CSV_COLS; prevents schema-bomb DoS
- `MAX_FWF_LINES = 1_000_000` — matches MAX_JSONL_RECORDS; enforced on RAW
  split count BEFORE skip-empty walk

Schema validation runs BEFORE any input processing — fail fast on bad
schemas without allocating record storage.

## Parser algorithm

1. Validate schema (count, bounds, align, names unique, overlap check)
2. Validate padChar (default ' '; length === 1)
3. Decode input via `decodeInput` with FwfInvalidUtf8Error factory
4. Split lines on `/\r\n|\n/`
5. Cap raw line count against MAX_FWF_LINES BEFORE walk
6. Walk lines:
   - Skip whitespace-only
   - If `line.length < maxEnd`, pad with padChar on right
   - For each column (in declaration order for key preservation):
     - `raw = line.slice(col.start, col.end)`
     - `value = align === 'left' ? rtrim(raw, padChar) : ltrim(raw, padChar)`
     - `record[col.name] = value`
   - Push record
7. Return `{ columns, records, hadBom }`

`rtrim`/`ltrim` are hand-rolled O(n) walkers (no regex).

## Serializer algorithm

1. Validate schema + padChar
2. For each record:
   - For each column (in start-ascending order):
     - `value = record[col.name] ?? ''`
     - If `value.length > width` → throw `FwfFieldOverflowError`
     - `padded = align === 'left' ? value + padChar.repeat(width - value.length) : padChar.repeat(...) + value`
   - Fill gaps between columns with padChar if schema has declared gaps
   - Emit `line + '\n'`
3. If `records.length === 0`, return `''` (not `'\n'`)
4. No BOM

## Dispatcher integration

```ts
// Overloads ensure fwf options are required
export function parseDataText(input, format: 'fwf', opts: FwfParseOptions): DataTextFile;
export function parseDataText(input, format: Exclude<DataTextFormat, 'fwf'>, opts?: DelimitedParseOptions): DataTextFile;
```

`DataTextFile` gains `{ kind: 'fwf'; file: FwfFile }`.

## Test plan (18 cases)

1. Decodes 3-column 3-row ASCII baseline
2. Right-aligned column ltrims leading spaces
3. Pads short lines to maxEnd then slices (Trap #3 parse)
4. Accepts lines longer than maxEnd (Trap #4)
5. Strips BOM + hadBom=true
6. Rejects overlapping columns
7. Rejects zero-width column
8. Rejects malformed UTF-8
9. Enforces MAX_FWF_LINES cap
10. Custom padChar '0' trims zeros on right-aligned (Trap #7)
11. Surrogate-pair input splits mid-pair; documents behaviour (Trap #5)
12. serializeFwf + parseFwf round-trip (semantic)
13. serializeFwf throws on field overflow (Trap #3 serialize)
14. serializeFwf with align:'right' padChar:'0' emits zero-padded numerics
15. Exactly maxEnd chars + '\n' per record; no BOM
16. parseDataText(input, 'fwf', { columns }) returns { kind: 'fwf' }
17. serializeDataText dispatches fwf
18. Rejects padChar length ≠ 1

## Dependencies

- Reuses `decodeInput` from utf8.ts
- Reuses WebcvtError, FormatDescriptor, Backend from core
- No third-party FWF libraries
- No new devDependencies

## Clean-room policy

No spec exists; no reference implementation consulted. Algorithm is
`String.slice(start, end)` + per-column trim + per-record line assembly,
derived from first principles.

## LOC budget

| File | LOC |
|---|---|
| fwf.ts (validator 50 + parser 70 + serializer 70 + helpers 30) | 220 |
| errors.ts additions (6 classes) | 60 |
| constants.ts additions | 15 |
| parser/serializer/backend/index/formats | 65 |
| **Source total** | **~360** |
| fwf.test.ts | 180 |
| **Grand total** | **~540** |
