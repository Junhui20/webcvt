/**
 * YAML 1.2 Core Schema parse/serialize for @catlabtech/webcvt-data-text.
 *
 * Sixth-pass extension. Safe, config-oriented subset of YAML 1.2.
 *
 * Architecture (split into three files per coding-style.md §file-organization):
 *   yaml-tokenizer.ts — character-at-a-time tokenizer, BOM/directive/tag/escape
 *   yaml-parser.ts    — indent-aware recursive-descent parser, alias resolver
 *   yaml-serializer.ts — canonical block-style emitter
 *
 * Spec: YAML 1.2.2 (Oct 2021) https://yaml.org/spec/1.2.2/
 * Core Schema: https://yaml.org/spec/1.2.2/#103-core-schema
 * Clean-room: NO code from js-yaml, yaml (eemeli), yamljs, pyyaml, libyaml, snakeyaml.
 *
 * ## Traps honoured (18)
 * #1  Anchor cycle detection → YamlAnchorCycleError
 * #2  Billion-laughs alias cap (MAX_YAML_ALIASES=1000) → YamlAliasLimitError
 * #3  Tag allowlist (only !!str !!int !!float !!bool !!null !!seq !!map)
 * #4  Merge keys (<<:) rejected → YamlMergeKeyForbiddenError
 * #5  Norway problem: yes/no/on/off stay as STRINGS under Core Schema
 * #6  Plain-scalar ambiguity: 0x/0o/0b and leading-zero → strings
 * #7  Tabs FORBIDDEN in leading indentation → YamlIndentError
 * #8  Flow-vs-block boundary enforced via flowDepth counter
 * #9  Block scalar chomping (clip/strip/keep)
 * #10 Folded scalar line-folding hand-rolled
 * #11 BOM handling: UTF-8 BOM stripped, non-UTF-8 BOMs → YamlInvalidUtf8Error
 * #12 Multi-doc rejected (second --- or any ...) → YamlMultiDocForbiddenError
 * #13 Directive allowlist (%YAML 1.2 only) → YamlDirectiveForbiddenError
 * #14 Empty doc → { value: null }
 * #15 Trailing content after document → YamlParseError
 * #16 Complex mapping keys → YamlComplexKeyForbiddenError
 * #17 Duplicate keys → YamlDuplicateKeyError
 * #18 Double-quoted escape validation → YamlBadEscapeError
 *
 * ## Security caps (from constants.ts)
 * MAX_YAML_DEPTH = 64, MAX_YAML_ANCHORS = 100, MAX_YAML_ALIASES = 1000,
 * MAX_YAML_SCALAR_LEN = 1 MiB, MAX_YAML_MAP_KEYS = 10 000,
 * MAX_YAML_SEQ_ITEMS = 1 000 000.
 */

// Re-export public API from the split implementation files
export type { YamlValue, YamlFile } from './yaml-parser.ts';
export { parseYaml } from './yaml-parser.ts';
export { serializeYaml } from './yaml-serializer.ts';
