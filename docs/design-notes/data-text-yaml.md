# data-text YAML extension design

> Sixth-pass extension for `@webcvt/data-text`. Adds a SAFE, CONFIG-ORIENTED
> subset of YAML 1.2 alongside JSON/CSV/TSV/INI/ENV/JSONL/TOML/FWF/XML.
>
> Spec-only: YAML 1.2.2 (2021) Core Schema + YAML 1.2 language spec.
> NO porting from js-yaml, yaml (eemeli/yaml), yamljs, yaml-ast-parser,
> pyyaml, libyaml, snakeyaml, or any other YAML library.
>
> Hand-rolled indentation-aware recursive-descent parser. Hand-rolled
> canonical emitter. NO DOM/external parser available — YAML has no
> browser-native parse primitive (unlike XML/JSON).

## Goal

Ship a YAML adapter that is SAFE BY CONSTRUCTION for config-file use
cases — load `docker-compose.yml`, `.github/workflows/*.yml`,
`kubernetes` manifests, app config — and round-trip through a canonical
block-style emitter. Aggressively reject every YAML feature that has
been weaponised in the wild (type tags → RCE, anchors → billion-laughs,
YAML 1.1 implicit typing → norway problem, multi-doc streams → scope
confusion). Not a YAML 1.2 conformance implementation. If a file needs
features we reject, the user gets a typed error, not silent data
corruption.

## Scope

### In scope (~900-1100 LOC source + ~380 tests)

- **YAML 1.2 Core Schema ONLY** — strict regex-defined booleans
  (`true|True|TRUE|false|False|FALSE`), integers, floats, null
  (`null|Null|NULL|~|<empty>`). No YAML 1.1 `yes`/`no`/`on`/`off`/`y`/`n`.
- **Single document only**. Leading `---` accepted (one directives-end
  marker), leading `%YAML 1.2` directive accepted. Any SECOND `---` or
  any `...` document-end marker → typed error.
- **Block style** mappings and sequences (indentation-sensitive).
- **Flow style** `{a: b, c: [1, 2]}` mappings and `[1, 2, 3]` sequences
  with bounded nesting.
- **Three scalar flavours**: plain, single-quoted `'...'`, double-quoted
  `"..."` (with standard escape set `\n \t \r \\ \" \/ \0 \xHH \uHHHH`).
- **Block scalars** `|` (literal) and `>` (folded) with chomping
  indicators (`+` keep, `-` strip, default clip) and explicit indent
  indicator (`|2`).
- **Anchors `&name` + aliases `*name`** with cycle detection AND
  total-expansion-count cap (billion-laughs defense).
- **Comments** `#` to end-of-line (dropped, not preserved).
- **UTF-8 only**; BOM stripped + `hadBom` recorded; never re-emitted.
- **Tag allowlist**: only `!!str !!int !!float !!bool !!null !!seq !!map`
  accepted. Any other `!tag`, `!!tag`, or `!<uri>` → typed error.
- **Canonical emitter**: block style default, 2-space indent, map keys
  sorted alphabetically, LF line endings, plain scalars when
  unambiguous, double-quoted when plain form would round-trip wrong.

### Out of scope (deferred / rejected)

- YAML 1.1 implicit typing (norway problem) — rejected by schema choice.
- Multi-document streams (`---` mid-file, any `...`).
- Type tags beyond the 7-entry allowlist. `!!binary`, `!!timestamp`,
  `!!omap`, `!!set`, `!!merge` (`<<:`), `!!js/*`, `!!python/*`, custom
  `!tag` — all REJECTED.
- `<<:` merge keys (non-spec YAML 1.1 extension; RCE-adjacent).
- Schema-aware coercion beyond Core Schema.
- Preserving comments, blank lines, flow-vs-block choice, or quote
  flavour on round-trip.
- Directives other than `%YAML 1.2` (`%TAG` rejected).
- Complex mapping keys (`? key` block notation; only scalar keys).
- Non-string map keys (JSON-object-ish keys, sequence keys) — REJECTED.
- Unicode escape surrogates U+D800..U+DFFF.
- Non-UTF-8 encodings (UTF-16/UTF-32 BOMs → typed error).
- Streaming parse/serialize.

## File map

New:
- `src/yaml.ts` (~950 LOC) — tokenizer + indent-aware parser +
  anchor resolver + canonical serializer
- `src/yaml.test.ts` (~420 LOC) — 40+ tests

Modified:
- `src/errors.ts` — 16 new typed errors
- `src/constants.ts` — YAML caps + `YAML_MIME`
- `src/parser.ts` / `src/serializer.ts` — dispatch
- `src/backend.ts` — `YAML_FORMAT` + MIME map (`application/yaml`,
  `application/x-yaml`, `text/yaml`, `text/x-yaml`)
- `src/index.ts` — re-exports
- `packages/core/src/formats.ts` — `{ ext: 'yaml', mime: 'application/yaml', category: 'data' }` plus `yml` alias ext

## Type definitions

```ts
export type YamlValue =
  | string
  | number            // Core Schema floats (incl. .inf / .nan)
  | bigint            // all ints — matches TOML convention, preserves 2^53..2^63
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

export interface YamlFile {
  readonly value: YamlValue;
  readonly hadBom: boolean;
  readonly hadDirectivesEndMarker: boolean; // '---' was present
  readonly hadYamlDirective: boolean;       // '%YAML 1.2' was present
}

export function parseYaml(input: Uint8Array | string): YamlFile;
export function serializeYaml(file: YamlFile): string;
```

All map keys are coerced to string on parse (YAML scalars); non-string
keys on serialize → `YamlSerializeError`.

## Typed errors (19)

| Class | Code |
|---|---|
| `YamlInvalidUtf8Error` | `YAML_INVALID_UTF8` |
| `YamlParseError` | `YAML_PARSE_ERROR` |
| `YamlIndentError` | `YAML_INDENT_ERROR` |
| `YamlMultiDocForbiddenError` | `YAML_MULTI_DOC_FORBIDDEN` |
| `YamlDirectiveForbiddenError` | `YAML_DIRECTIVE_FORBIDDEN` |
| `YamlTagForbiddenError` | `YAML_TAG_FORBIDDEN` |
| `YamlMergeKeyForbiddenError` | `YAML_MERGE_KEY_FORBIDDEN` |
| `YamlAnchorCycleError` | `YAML_ANCHOR_CYCLE` |
| `YamlAnchorUndefinedError` | `YAML_ANCHOR_UNDEFINED` |
| `YamlAnchorLimitError` | `YAML_ANCHOR_LIMIT` |
| `YamlAliasLimitError` | `YAML_ALIAS_LIMIT` |
| `YamlDepthExceededError` | `YAML_DEPTH_EXCEEDED` |
| `YamlScalarTooLongError` | `YAML_SCALAR_TOO_LONG` |
| `YamlMapTooLargeError` | `YAML_MAP_TOO_LARGE` |
| `YamlSeqTooLargeError` | `YAML_SEQ_TOO_LARGE` |
| `YamlComplexKeyForbiddenError` | `YAML_COMPLEX_KEY_FORBIDDEN` |
| `YamlBadEscapeError` | `YAML_BAD_ESCAPE` |
| `YamlDuplicateKeyError` | `YAML_DUPLICATE_KEY` |
| `YamlSerializeError` | `YAML_SERIALIZE_ERROR` |

## Traps honoured (18)

1. **Anchor cycle detection** — `&a [*a]` creates an infinite structure.
   Resolver walks alias graph with a visited-set PER resolution; cycle
   → `YamlAnchorCycleError`. Do NOT silently emit JS-level object
   cycles; downstream serializers would hang.

2. **Billion-laughs alias expansion cap** — `&a [x,x,x,x,x]`,
   `&b [*a,*a,*a,*a,*a]`, … grows exponentially even without cycles.
   Track TOTAL alias dereferences across the whole document; cap at
   `MAX_YAML_ALIASES = 1000`. Exceed → `YamlAliasLimitError`. The cap
   applies to the EXPANSION step, not to the syntactic count, so
   `*a` referenced inside `*b` counts each time it's expanded.

3. **Type-tag allowlist** — only `!!str !!int !!float !!bool !!null
   !!seq !!map` recognised. `!!python/object`, `!!js/function`,
   `!!binary`, `!!timestamp`, `!!omap`, `!!set`, `!<tag:yaml.org,2002:*>`,
   any custom `!mytag`, any `!<uri>` → `YamlTagForbiddenError`. This
   single guard neutralises the entire "unsafe YAML → RCE" class.

4. **Merge keys (`<<:`) rejected** — the `<<:` merge is YAML 1.1 and
   is a known footgun (silent override, anchor dependency). Throw
   `YamlMergeKeyForbiddenError`. Users must inline explicitly.

5. **Norway problem / YAML 1.1 booleans** — plain `no`, `yes`, `on`,
   `off`, `y`, `n`, `Y`, `N` stay as STRINGS under Core Schema. Only
   `true|True|TRUE|false|False|FALSE` coerce to boolean. Document
   prominently in JSDoc.

6. **Plain-scalar ambiguity** — the resolver matches against the Core
   Schema regex SEQUENCE in a fixed order: null → bool → int → float →
   string. `0x1F`, `0o17`, `0b101` NOT Core Schema (those are YAML 1.1)
   → parse as strings. `+123` and `.5` match Core float; `00123` does
   NOT (leading zero) → string. Spec reference only; no guessing.

7. **Indentation rules are column-based, tabs FORBIDDEN for indent** —
   YAML 1.2 §6.1 forbids tabs as indentation whitespace. Detect tab in
   leading whitespace of any line contributing to block structure →
   `YamlIndentError`. Tabs INSIDE scalars fine. Mixed-tab-space indent
   is a common silent-corruption source.

8. **Flow-vs-block boundary** — inside `[...]` / `{...}`, indentation
   stops being structural; commas and brackets are. A block-style
   construct CANNOT appear inside flow. Track `inFlow` depth; reject
   block-only constructs (block scalars, `- ` sequence entries at line
   start without brackets) when `inFlow > 0`.

9. **Block scalar chomping indicators** — `|` (literal, clip: one
   trailing `\n`), `|-` (strip: no trailing `\n`), `|+` (keep: all
   trailing blank lines preserved). Same three variants for `>`
   (folded). Default = clip. Get this wrong and round-trip destroys
   shell scripts stored as block scalars. Explicit indent indicator
   `|2` handled for cases where first content line is itself indented.

10. **Folded scalar line folding** — `>` folds single `\n` between
    non-empty lines to `' '`, but `\n\n` stays `\n`, and lines indented
    MORE than the block indent stay verbatim. Hand-rolled walker; no
    regex.

11. **BOM handling** — UTF-8 BOM stripped on parse + recorded in
    `hadBom`. UTF-16/UTF-32 BOMs (`FE FF`, `FF FE`, `00 00 FE FF`,
    `FF FE 00 00`) → `YamlInvalidUtf8Error` (we're UTF-8-only; see
    decodeInput).

12. **Multi-doc rejection** — a SECOND `---` marker OR ANY `...` marker
    AFTER first doc → `YamlMultiDocForbiddenError`. Note: `---` IS
    valid at file start (directives-end marker). Track `docCount`;
    second doc opens → throw. `...` inside a scalar is fine (scalar
    context overrides).

13. **Directive allowlist** — only `%YAML 1.2` accepted. `%YAML 1.1`
    (would change schema semantics) → `YamlDirectiveForbiddenError`.
    `%TAG` (custom tag prefixes, feeds type-tag attacks) → same. Any
    other `%...` directive → same.

14. **Empty document** — input that decodes to empty / only-whitespace /
    only-comments / only `---` yields `{ value: null, ... }`, not a
    parse error. Matches YAML spec "empty document is implicit null".

15. **Trailing content after document** — content after a successful
    document close that is not whitespace/comments/`...` → parse error.
    Don't silently ignore trailing garbage.

16. **Complex mapping keys** — `? [a, b]: value` / `? {a: 1}: value`
    (non-scalar keys) → `YamlComplexKeyForbiddenError`. Only scalar
    keys, coerced to string via Core Schema, allowed.

17. **Duplicate keys in same mapping** — YAML 1.2 says "undefined
    behaviour"; we say `YamlDuplicateKeyError`. Strict like TOML's
    duplicate-key rule.

18. **Double-quoted escape validation** — standard escape set
    `\0 \a \b \t \n \v \f \r \e \ \" \/ \N \_ \L \P \xHH \uHHHH
    \UHHHHHHHH`. Reject surrogates U+D800..U+DFFF; reject values >
    U+10FFFF. Unknown escape → `YamlBadEscapeError`. Single-quoted
    strings have ONLY `''` → `'` escape; everything else literal.

## Security caps

```ts
export const MAX_YAML_DEPTH = 64;         // combined map+seq+flow nesting
export const MAX_YAML_ANCHORS = 100;      // distinct &name declarations
export const MAX_YAML_ALIASES = 1000;     // total *name DEREFERENCES (billion-laughs)
export const MAX_YAML_SCALAR_LEN = 1_048_576; // 1 MiB per scalar token
export const MAX_YAML_MAP_KEYS = 10_000;  // keys per mapping
export const MAX_YAML_SEQ_ITEMS = 1_000_000; // items per sequence
export const YAML_MIME = 'application/yaml';
```

Rationale per cap:

| Cap | Value | Rationale |
|---|---|---|
| `MAX_YAML_DEPTH` | 64 | Matches XML/TOML; real configs rarely exceed 10 |
| `MAX_YAML_ANCHORS` | 100 | Legitimate reuse patterns (k8s manifests) stay well under; higher suggests attack |
| `MAX_YAML_ALIASES` | 1000 | Core billion-laughs guard. 100 anchors × 10 avg refs. With depth×fanout attack, 1000 total expansions caps output at O(1000 × scalar-size), well below input size for any non-pathological file |
| `MAX_YAML_SCALAR_LEN` | 1 MiB | Matches TOML/XML text node; embedded base64 blobs within reason |
| `MAX_YAML_MAP_KEYS` | 10 000 | Matches TOML keys-per-table |
| `MAX_YAML_SEQ_ITEMS` | 1 000 000 | Matches TOML array length, JSONL records |

Inherited: `MAX_INPUT_BYTES` (10 MiB), `MAX_INPUT_CHARS` (10M),
UTF-8 fatal mode via `decodeInput`.

**NO regex on untrusted scalar bodies** — ReDoS defense. Tokenizer is
hand-rolled character-at-a-time state machine, O(n) guaranteed. Regex
used ONLY for:
- Core Schema plain-scalar classification (fixed patterns on
  already-extracted bounded-length scalars)
- Directive parsing (first ≤64 chars after optional BOM)
- Anchor/alias name validation (`[A-Za-z0-9_-]+`, bounded by
  `MAX_YAML_SCALAR_LEN`)

## Architecture

### Parse pipeline

Four phases:

#### Phase 1: Decode + BOM + encoding gate

- `decodeInput(input)` → string (fatal UTF-8; throws
  `YamlInvalidUtf8Error` via factory)
- Detect + strip UTF-8 BOM; record `hadBom`
- Reject UTF-16/UTF-32 BOMs → `YamlInvalidUtf8Error`

#### Phase 2: Directive + marker scan (linear)

- Parse leading directives: `%YAML 1.2` accepted, anything else →
  `YamlDirectiveForbiddenError`
- Count `---` at column 0; MUST be ≤ 1 (one directives-end marker OR
  zero). Record `hadDirectivesEndMarker`.
- Count `...` at column 0; MUST be zero (we reject any doc-end)
- Any `---` or `...` encountered AFTER first document body →
  `YamlMultiDocForbiddenError`

#### Phase 3: Indent-aware tokenize + parse

Recursive descent with an explicit "current indent" argument:

```
parseNode(minIndent):
  skip blank/comment lines
  inspect first non-space char at col c:
    c < minIndent → return empty (caller handles)
    '- '          → parseBlockSeq(c)
    '|' | '>'     → parseBlockScalar(c)
    '['           → parseFlowSeq()
    '{'           → parseFlowMap()
    '&name'       → consume anchor, recurse, register
    '*name'       → consume alias, resolve, cap-check
    '!!tag'       → validate against allowlist, recurse
    else          → tryBlockMapping OR parsePlainScalar
```

Tokenizer states: `NORMAL_BLOCK`, `IN_FLOW_SEQ`, `IN_FLOW_MAP`,
`IN_SINGLE_QUOTE`, `IN_DOUBLE_QUOTE`, `IN_LITERAL_BLOCK`,
`IN_FOLDED_BLOCK`, `IN_COMMENT`.

Anchor map built as we parse. Alias resolution DEFERRED to Phase 4 so
forward references don't exist (YAML requires anchor before alias) —
we can resolve inline, but separate pass keeps expansion-counting
clean.

Depth counter incremented at every container entry (map, seq, flow).

#### Phase 4: Alias expansion + cycle check + cap enforcement

- DFS through tree; on every alias node:
  - `expandCount++`; if > `MAX_YAML_ALIASES` → `YamlAliasLimitError`
  - maintain `resolving: Set<name>` stack; if alias name present →
    `YamlAnchorCycleError`
  - structurally clone resolved subtree (immutable, so no aliasing
    concern on read; clone ensures serializer sees a tree not a DAG)
- Validate per-container caps during walk
- Return `YamlFile`

### Serialize pipeline

Hand-rolled canonical emitter over `YamlFile` POJO:

```
serialize(file):
  [omit %YAML directive — always 1.2 implicit]
  emit(value, indent=0, context=ROOT)

emit(v, i, ctx):
  switch typeof v:
    null        → 'null'
    boolean     → 'true' | 'false'
    bigint      → v.toString()
    number      → isNaN ? '.nan' : !isFinite ? (v<0?'-':'.')+'inf' : String(v)
    string      → chooseScalarStyle(v)  // plain if safe, else double-quoted
    array       → '- ' prefix lines at indent i, each value at i+2
    object      → sorted-by-key; 'key: ' + value; scalars inline, containers newline+indent
```

`chooseScalarStyle`:
- plain if `v` doesn't match any Core Schema implicit type AND contains
  no control chars AND doesn't start with `- ` / `? ` / `: ` / `# ` /
  `& ` / `* ` / `!` / `|` / `>` / `'` / `"` / `[` / `]` / `{` / `}` /
  `, ` / `@` / whitespace / `---` / `...` / empty
- double-quoted otherwise (never single-quoted; one fewer edge case)

Deterministic: alphabetical map key sort (stable JSON.stringify-ish),
2-space indent, LF line endings, no BOM, no leading `---` (omitted for
cleanliness; `hadDirectivesEndMarker` not round-tripped).

Anchors/aliases NOT emitted — serializer always produces expanded tree.
Round-trip semantic but not syntactic.

## Backend integration

```ts
YAML_MIME = 'application/yaml'
// MIME_TO_FORMAT also maps: 'application/x-yaml', 'text/yaml', 'text/x-yaml'
```

`YAML_FORMAT` descriptor: `{ ext: 'yaml', mime: 'application/yaml',
category: 'data', description: 'YAML Aint Markup Language 1.2 Core' }`.
File extension alias `yml` recognised in ext lookup.

`DataTextFile` gains `{ kind: 'yaml'; file: YamlFile }`.

## Test plan (40+ cases, minimum 32)

Happy-path (12):
1. Parse empty doc → `{ value: null }`
2. Parse single plain scalar `hello`
3. Parse block mapping 3 keys
4. Parse block sequence 3 items
5. Parse nested mapping-of-sequences-of-mappings (k8s-style)
6. Flow mapping `{a: 1, b: 2}`
7. Flow sequence `[1, 2, 3]`
8. Single-quoted scalar with `''` escape
9. Double-quoted scalar with `\n \t \uXXXX` escapes
10. Block literal `|` with chomp `-` / `+` / default
11. Block folded `>` line-folding
12. `&a x` / `*a` alias expansion

Core Schema typing (6):
13. `true` / `True` / `TRUE` → boolean; `yes`/`no`/`on`/`off` → string (norway, Trap 5)
14. `null` / `~` / empty → null
15. Core int → bigint (`123`, `-0`, `+7`)
16. Core float → number incl. `.inf` / `-.inf` / `.nan`
17. Leading-zero `0123` → string (Trap 6)
18. Hex/oct/bin plain → string (YAML 1.1 only; Trap 6)

Rejections (12):
19. `!!python/object/apply:os.system [rm]` → `YamlTagForbiddenError` (Trap 3)
20. `!!js/function` → `YamlTagForbiddenError`
21. `!mytag value` (custom local tag) → `YamlTagForbiddenError`
22. `<<: *anchor` merge key → `YamlMergeKeyForbiddenError` (Trap 4)
23. Second `---` marker → `YamlMultiDocForbiddenError` (Trap 12)
24. `...` doc-end marker → `YamlMultiDocForbiddenError`
25. `%YAML 1.1` directive → `YamlDirectiveForbiddenError` (Trap 13)
26. `%TAG !e! tag:example.com,2020:` → `YamlDirectiveForbiddenError`
27. Tab in leading indent → `YamlIndentError` (Trap 7)
28. Complex key `? [a,b]: v` → `YamlComplexKeyForbiddenError` (Trap 16)
29. Duplicate key in same map → `YamlDuplicateKeyError` (Trap 17)
30. Unknown escape `\q` in double-quoted → `YamlBadEscapeError` (Trap 18)

Security caps (7):
31. Anchor cycle `&a [*a]` → `YamlAnchorCycleError` (Trap 1)
32. Billion-laughs input → `YamlAliasLimitError` BEFORE OOM (Trap 2)
33. 101 distinct anchors → `YamlAnchorLimitError`
34. 65-deep nesting → `YamlDepthExceededError`
35. 1 MiB+1 scalar → `YamlScalarTooLongError`
36. 10 001-key map → `YamlMapTooLargeError`
37. 1 000 001-item seq → `YamlSeqTooLargeError`

Framing (5):
38. UTF-8 BOM → `hadBom: true`, stripped
39. UTF-16 BOM → `YamlInvalidUtf8Error`
40. Leading `---` accepted; `hadDirectivesEndMarker: true`
41. Trailing content after doc → `YamlParseError` (Trap 15)
42. Comment-only doc → `{ value: null }` (Trap 14)

Serialize + round-trip (6):
43. Canonical emit: sorted keys, 2-space indent, no BOM, no `---`
44. String `"no"` round-trips as `"no"` (double-quoted) NOT plain (Trap 5)
45. String matching int-regex (`"123"`) round-trips as `"123"` double-quoted
46. bigint > 2^53 round-trips
47. Anchors/aliases expanded on emit (structural clone, not DAG)
48. Map key that needs escaping (`"foo: bar"`) emitted double-quoted

Backend wiring (3):
49. `parseDataText(input, 'yaml')` → `{ kind: 'yaml' }`
50. `DataTextBackend.canHandle('application/yaml')` + aliases
51. `serializeDataText({ kind: 'yaml', file })` dispatches

## Dependencies

- Runtime: none new. Uses `decodeInput` from `utf8.ts`.
- Reuses `WebcvtError`, `FormatDescriptor`, `Backend` from core.
- No third-party YAML libraries. No new devDependencies.

## Clean-room citation

Primary sources:
- YAML 1.2.2 Specification (Oct 2021) — https://yaml.org/spec/1.2.2/
- YAML 1.2 Core Schema — https://yaml.org/spec/1.2.2/#103-core-schema
- YAML 1.2 Failsafe + JSON schemas — https://yaml.org/spec/1.2.2/#chapter-10-recommended-schemas
- YAML test suite (yaml-test-suite) — https://github.com/yaml/yaml-test-suite (read for test-case INPUTS only; expected-output JSON NOT consulted for parser logic)
- RFC 3629 (UTF-8) — encoding gate only

Explicitly NOT consulted (clean-room):
- js-yaml — most common JS YAML parser
- yaml (eemeli/yaml) — second most common
- yamljs, yaml-ast-parser
- pyyaml, ruamel.yaml
- libyaml (C reference)
- snakeyaml (Java)
- go-yaml
- any `@*/yaml*` or `*-yaml` npm package

Parser is recursive-descent derived from the YAML 1.2.2 spec's ABNF +
production rules, transcribed to hand-rolled state machines. Core
Schema regexes copied verbatim from §10.3.2 (spec text is the standard,
not an implementation).

## LOC budget

| File | LOC |
|---|---|
| yaml.ts (tokenizer 300 + parser 350 + anchor-resolver 80 + serializer 180 + core-schema 40) | 950 |
| errors.ts additions (19 classes) | 155 |
| constants.ts additions | 25 |
| parser/serializer/backend/index/core-formats additions | 65 |
| **Source total** | **~1195** |
| yaml.test.ts (40+ cases) | 420 |
| **Grand total** | **~1615** |

Budget is the largest of the data-text passes so far — reflects YAML's
genuine complexity (indent-aware + block-scalars + anchors + flow
style). Still well under the 2000-LOC single-file soft cap; if yaml.ts
drifts over 800 LOC we split into `yaml-tokenizer.ts`, `yaml-parser.ts`,
`yaml-serializer.ts` per coding-style.md file-organization guidance.
