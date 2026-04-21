/**
 * Tests for yaml.ts — YAML 1.2 Core Schema parse/serialize.
 *
 * TC1:  Parse empty doc → { value: null }
 * TC2:  Parse single plain scalar 'hello'
 * TC3:  Parse block mapping 3 keys
 * TC4:  Parse block sequence 3 items
 * TC5:  Parse nested mapping-of-sequences-of-mappings (k8s-style)
 * TC6:  Flow mapping {a: 1, b: 2}
 * TC7:  Flow sequence [1, 2, 3]
 * TC8:  Single-quoted scalar with '' escape
 * TC9:  Double-quoted scalar with \n \t \uXXXX escapes
 * TC10: Block literal | with chomp -, +, default
 * TC11: Block folded > line-folding
 * TC12: &a x / *a alias expansion
 * TC13: Norway problem: yes/no/on/off → string; true/false → boolean (Trap 5)
 * TC14: null / ~ / empty → null (Trap 6)
 * TC15: Core int → bigint (123, -0, +7)
 * TC16: Core float → number incl. .inf / -.inf / .nan
 * TC17: Leading-zero 0123 → string (Trap 6)
 * TC18: Hex/oct/bin plain → string (Trap 6)
 * TC19: !!python/object tag → YamlTagForbiddenError (Trap 3)
 * TC20: !!js/function tag → YamlTagForbiddenError
 * TC21: !mytag local tag → YamlTagForbiddenError
 * TC22: <<: merge key → YamlMergeKeyForbiddenError (Trap 4)
 * TC23: Second --- marker → YamlMultiDocForbiddenError (Trap 12)
 * TC24: ... doc-end marker → YamlMultiDocForbiddenError
 * TC25: %YAML 1.1 directive → YamlDirectiveForbiddenError (Trap 13)
 * TC26: %TAG directive → YamlDirectiveForbiddenError
 * TC27: Tab in leading indent → YamlIndentError (Trap 7)
 * TC28: Complex key ? [a,b]: v → YamlComplexKeyForbiddenError (Trap 16)
 * TC29: Duplicate key in same map → YamlDuplicateKeyError (Trap 17)
 * TC30: Unknown escape \q → YamlBadEscapeError (Trap 18)
 * TC31: Anchor cycle &a [*a] → YamlAnchorCycleError (Trap 1)
 * TC32: Billion-laughs → YamlAliasLimitError (Trap 2)
 * TC33: 101 distinct anchors → YamlAnchorLimitError
 * TC34: 65-deep nesting → YamlDepthExceededError
 * TC35: 1 MiB+1 scalar → YamlScalarTooLongError
 * TC36: 10 001-key map → YamlMapTooLargeError
 * TC37: 1 000 001-item seq → YamlSeqTooLargeError
 * TC38: UTF-8 BOM → hadBom: true, stripped
 * TC39: UTF-16 BOM → YamlInvalidUtf8Error
 * TC40: Leading --- accepted; hadDirectivesEndMarker: true
 * TC41: Trailing content after doc → YamlParseError (Trap 15)
 * TC42: Comment-only doc → { value: null } (Trap 14)
 * TC43: Canonical emit: sorted keys, 2-space indent, no BOM, no ---
 * TC44: String "no" round-trips as "no" double-quoted NOT plain (Trap 5)
 * TC45: String matching int-regex "123" round-trips as "123" double-quoted
 * TC46: bigint > 2^53 round-trips
 * TC47: Anchors/aliases expanded on emit
 * TC48: Map key "foo: bar" emitted double-quoted
 * TC49: parseDataText(input, 'yaml') → { kind: 'yaml' }
 * TC50: DataTextBackend.canHandle(application/yaml) + aliases
 * TC51: serializeDataText({ kind: 'yaml', file }) dispatches
 * TC52: %YAML 1.2 directive → hadYamlDirective: true
 * TC53: Single-quoted multi-line folding
 * TC54: !!str tag forces string type for "123"
 * TC55: !!null tag forces null
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { DataTextBackend, YAML_FORMAT } from './backend.ts';
import {
  MAX_YAML_ALIASES,
  MAX_YAML_ANCHORS,
  MAX_YAML_DEPTH,
  MAX_YAML_MAP_KEYS,
  MAX_YAML_SCALAR_LEN,
  MAX_YAML_SEQ_ITEMS,
  YAML_MIME,
  YAML_MIME_ALIAS_TEXT,
  YAML_MIME_ALIAS_TEXT_X,
  YAML_MIME_ALIAS_X,
} from './constants.ts';
import {
  YamlAliasLimitError,
  YamlAnchorCycleError,
  YamlAnchorLimitError,
  YamlAnchorUndefinedError,
  YamlBadEscapeError,
  YamlComplexKeyForbiddenError,
  YamlDepthExceededError,
  YamlDirectiveForbiddenError,
  YamlDuplicateKeyError,
  YamlIndentError,
  YamlInvalidUtf8Error,
  YamlMapTooLargeError,
  YamlMergeKeyForbiddenError,
  YamlMultiDocForbiddenError,
  YamlParseError,
  YamlScalarTooLongError,
  YamlSeqTooLargeError,
  YamlTagForbiddenError,
} from './errors.ts';
import { parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';
import { parseYaml, serializeYaml } from './yaml.ts';
import type { YamlFile } from './yaml.ts';

// ---------------------------------------------------------------------------
// Happy-path: basic parsing
// ---------------------------------------------------------------------------

describe('parseYaml — happy-path', () => {
  it('TC1: empty doc → value: null', () => {
    const result = parseYaml('');
    expect(result.value).toBe(null);
    expect(result.hadBom).toBe(false);
    expect(result.hadDirectivesEndMarker).toBe(false);
  });

  it('TC1b: whitespace-only doc → value: null (Trap 14)', () => {
    expect(parseYaml('   \n  \n').value).toBe(null);
  });

  it('TC2: single plain scalar "hello"', () => {
    expect(parseYaml('hello').value).toBe('hello');
  });

  it('TC3: block mapping 3 keys', () => {
    const yaml = 'name: Alice\nage: 30\ncity: London\n';
    const result = parseYaml(yaml);
    expect(result.value).toEqual({ name: 'Alice', age: 30n, city: 'London' });
  });

  it('TC4: block sequence 3 items', () => {
    const yaml = '- alpha\n- beta\n- gamma\n';
    const result = parseYaml(yaml);
    expect(result.value).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('TC5: nested mapping-of-sequences-of-mappings (k8s-style)', () => {
    const yaml = [
      'apiVersion: apps/v1',
      'containers:',
      '  - name: nginx',
      '    image: nginx:latest',
      '  - name: sidecar',
      '    image: envoy:v1',
    ].join('\n');
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.apiVersion).toBe('apps/v1');
    const containers = v.containers as unknown[];
    expect(containers).toHaveLength(2);
    const first = containers[0] as Record<string, unknown>;
    expect(first.name).toBe('nginx');
  });

  it('TC6: flow mapping {a: 1, b: 2}', () => {
    const result = parseYaml('{a: 1, b: 2}');
    expect(result.value).toEqual({ a: 1n, b: 2n });
  });

  it('TC7: flow sequence [1, 2, 3]', () => {
    const result = parseYaml('[1, 2, 3]');
    expect(result.value).toEqual([1n, 2n, 3n]);
  });

  it("TC8: single-quoted scalar with '' escape", () => {
    const result = parseYaml("'it''s a test'");
    expect(result.value).toBe("it's a test");
  });

  it('TC9: double-quoted scalar with \\n \\t \\uXXXX escapes', () => {
    const result = parseYaml('"line1\\nline2\\ttabbed\\u0041"');
    expect(result.value).toBe('line1\nline2\ttabbedA');
  });

  it('TC10: block literal | chomp variants', () => {
    // Clip (default): one trailing newline
    const clip = parseYaml('value: |\n  hello\n  world\n');
    expect((clip.value as Record<string, unknown>).value).toBe('hello\nworld\n');

    // Strip: no trailing newline
    const strip = parseYaml('value: |-\n  hello\n  world\n');
    expect((strip.value as Record<string, unknown>).value).toBe('hello\nworld');

    // Keep: all trailing blank lines
    const keep = parseYaml('value: |+\n  hello\n  world\n\n');
    const keepVal = (keep.value as Record<string, unknown>).value as string;
    expect(keepVal).toContain('hello\nworld\n');
  });

  it('TC11: block folded > line-folding', () => {
    const yaml = 'value: >\n  first line\n  second line\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    // Single newline between non-empty lines → folded to space
    expect(v).toContain('first line second line');
  });

  it('TC12: anchor &a and alias *a expansion', () => {
    const yaml = 'original: &anchor hello\ncopy: *anchor\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.original).toBe('hello');
    expect(v.copy).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Core Schema typing
// ---------------------------------------------------------------------------

describe('parseYaml — Core Schema typing', () => {
  it('TC13: Norway problem — yes/no/on/off stay as strings (Trap 5)', () => {
    expect(parseYaml('yes').value).toBe('yes');
    expect(parseYaml('no').value).toBe('no');
    expect(parseYaml('on').value).toBe('on');
    expect(parseYaml('off').value).toBe('off');
    expect(parseYaml('y').value).toBe('y');
    expect(parseYaml('n').value).toBe('n');
    // But true/True/TRUE ARE boolean
    expect(parseYaml('true').value).toBe(true);
    expect(parseYaml('True').value).toBe(true);
    expect(parseYaml('TRUE').value).toBe(true);
    expect(parseYaml('false').value).toBe(false);
    expect(parseYaml('False').value).toBe(false);
    expect(parseYaml('FALSE').value).toBe(false);
  });

  it('TC14: null / ~ / empty key → null', () => {
    expect(parseYaml('null').value).toBe(null);
    expect(parseYaml('Null').value).toBe(null);
    expect(parseYaml('NULL').value).toBe(null);
    expect(parseYaml('~').value).toBe(null);
    expect(parseYaml('').value).toBe(null);
  });

  it('TC15: Core int → bigint (123, -0, +7)', () => {
    expect(parseYaml('123').value).toBe(123n);
    expect(parseYaml('-0').value).toBe(0n);
    expect(parseYaml('+7').value).toBe(7n);
    expect(parseYaml('0').value).toBe(0n);
  });

  it('TC16: Core float → number incl. .inf / -.inf / .nan', () => {
    expect(parseYaml('1.5').value).toBe(1.5);
    expect(parseYaml('1.5e2').value).toBe(150);
    expect(parseYaml('.inf').value).toBe(Number.POSITIVE_INFINITY);
    expect(parseYaml('-.inf').value).toBe(Number.NEGATIVE_INFINITY);
    const nan = parseYaml('.nan').value as number;
    expect(Number.isNaN(nan)).toBe(true);
  });

  it('TC17: leading-zero "0123" → string (Trap 6)', () => {
    expect(parseYaml('0123').value).toBe('0123');
  });

  it('TC18: hex/oct/bin plain scalars → strings (Trap 6, YAML 1.1 only)', () => {
    expect(parseYaml('0x1F').value).toBe('0x1F');
    expect(parseYaml('0o17').value).toBe('0o17');
    expect(parseYaml('0b101').value).toBe('0b101');
  });
});

// ---------------------------------------------------------------------------
// Rejection tests
// ---------------------------------------------------------------------------

describe('parseYaml — rejections', () => {
  it('TC19: !!python/object/apply tag → YamlTagForbiddenError (Trap 3)', () => {
    expect(() => parseYaml('!!python/object/apply:os.system [rm]')).toThrow(YamlTagForbiddenError);
  });

  it('TC20: !!js/function tag → YamlTagForbiddenError', () => {
    expect(() => parseYaml('!!js/function "function(){}"')).toThrow(YamlTagForbiddenError);
  });

  it('TC21: !mytag custom local tag → YamlTagForbiddenError', () => {
    expect(() => parseYaml('!mytag value')).toThrow(YamlTagForbiddenError);
  });

  it('TC22: <<: merge key → YamlMergeKeyForbiddenError (Trap 4)', () => {
    // Simple inline map with merge key; the '<<' key triggers YamlMergeKeyForbiddenError
    const yaml = 'base: &base {x: 1}\nchild: {<<: *base, y: 2}\n';
    expect(() => parseYaml(yaml)).toThrow(YamlMergeKeyForbiddenError);
  });

  it('TC23: second --- marker → YamlMultiDocForbiddenError (Trap 12)', () => {
    expect(() => parseYaml('key: value\n---\nkey2: value2\n')).toThrow(YamlMultiDocForbiddenError);
  });

  it('TC24: ... doc-end marker → YamlMultiDocForbiddenError', () => {
    expect(() => parseYaml('key: value\n...\n')).toThrow(YamlMultiDocForbiddenError);
  });

  it('TC25: %YAML 1.1 directive → YamlDirectiveForbiddenError (Trap 13)', () => {
    expect(() => parseYaml('%YAML 1.1\n---\nkey: value\n')).toThrow(YamlDirectiveForbiddenError);
  });

  it('TC26: %TAG directive → YamlDirectiveForbiddenError', () => {
    expect(() => parseYaml('%TAG !e! tag:example.com,2020:\n---\nvalue\n')).toThrow(
      YamlDirectiveForbiddenError,
    );
  });

  it('TC27: tab in leading indent → YamlIndentError (Trap 7)', () => {
    // Use a tab as indentation for a block map value
    expect(() => parseYaml('key:\n\tvalue\n')).toThrow(YamlIndentError);
  });

  it('TC28: complex key ? [a,b]: v → YamlComplexKeyForbiddenError (Trap 16)', () => {
    expect(() => parseYaml('? [a, b]\n: value\n')).toThrow(YamlComplexKeyForbiddenError);
  });

  it('TC29: duplicate key in same map → YamlDuplicateKeyError (Trap 17)', () => {
    expect(() => parseYaml('key: value1\nkey: value2\n')).toThrow(YamlDuplicateKeyError);
  });

  it('TC30: unknown escape \\q → YamlBadEscapeError (Trap 18)', () => {
    expect(() => parseYaml('"\\q"')).toThrow(YamlBadEscapeError);
  });
});

// ---------------------------------------------------------------------------
// Security cap tests
// ---------------------------------------------------------------------------

describe('parseYaml — security caps', () => {
  it('TC31: anchor cycle &a [*a] → YamlAnchorCycleError (Trap 1)', () => {
    // We can't write a true self-referential YAML, but we can use forward refs
    // A cycle: a → b → a
    const yaml = 'a: &a\n  b: *a\n';
    expect(() => parseYaml(yaml)).toThrow(YamlAnchorCycleError);
  });

  it('TC32: billion-laughs → YamlAliasLimitError BEFORE OOM (Trap 2)', () => {
    // Build a payload with exponential expansion
    const lines: string[] = [];
    lines.push('a: &a x');
    lines.push('b: &b [*a, *a, *a, *a, *a]');
    lines.push('c: &c [*b, *b, *b, *b, *b]');
    lines.push('d: &d [*c, *c, *c, *c, *c]');
    lines.push('e: &e [*d, *d, *d, *d, *d]');
    lines.push('result: [*e, *e, *e, *e]');
    expect(() => parseYaml(lines.join('\n'))).toThrow(YamlAliasLimitError);
  });

  it('TC33: 101 distinct anchors → YamlAnchorLimitError', () => {
    const lines: string[] = [];
    for (let i = 0; i <= MAX_YAML_ANCHORS; i++) {
      lines.push(`key${i}: &anchor${i} value${i}`);
    }
    expect(() => parseYaml(lines.join('\n'))).toThrow(YamlAnchorLimitError);
  });

  it('TC34: 65-deep nesting → YamlDepthExceededError', () => {
    // Build a deeply nested flow sequence
    let s = '';
    const depth = MAX_YAML_DEPTH + 1;
    for (let i = 0; i < depth; i++) s += '[';
    s += '1';
    for (let i = 0; i < depth; i++) s += ']';
    expect(() => parseYaml(s)).toThrow(YamlDepthExceededError);
  });

  it('TC35: 1 MiB + 1 scalar → YamlScalarTooLongError', () => {
    const hugeStr = `"${'a'.repeat(MAX_YAML_SCALAR_LEN + 1)}"`;
    expect(() => parseYaml(hugeStr)).toThrow(YamlScalarTooLongError);
  });

  it('TC36: 10 001-key map → YamlMapTooLargeError', () => {
    const lines: string[] = [];
    for (let i = 0; i <= MAX_YAML_MAP_KEYS; i++) {
      lines.push(`key${i}: value${i}`);
    }
    expect(() => parseYaml(lines.join('\n'))).toThrow(YamlMapTooLargeError);
  });

  it('TC37: 1 000 001-item seq → YamlSeqTooLargeError', () => {
    // Use short item names (- i\n = 4 chars each) to stay under MAX_INPUT_CHARS
    // 1,000,001 items × 4 chars = ~4 MB, within the 10 MiB limit
    const lines: string[] = [];
    for (let i = 0; i <= MAX_YAML_SEQ_ITEMS; i++) {
      lines.push('- i');
    }
    expect(() => parseYaml(lines.join('\n'))).toThrow(YamlSeqTooLargeError);
  }, 30000); // generous timeout for large input
});

// ---------------------------------------------------------------------------
// Framing tests
// ---------------------------------------------------------------------------

describe('parseYaml — framing', () => {
  it('TC38: UTF-8 BOM → hadBom: true, value stripped', () => {
    const input = concat(bom(), utf8('hello'));
    const result = parseYaml(input);
    expect(result.hadBom).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('TC39: UTF-16 BE BOM → YamlInvalidUtf8Error', () => {
    const input = new Uint8Array([0xfe, 0xff, 0x00, 0x68]);
    expect(() => parseYaml(input)).toThrow(YamlInvalidUtf8Error);
  });

  it('TC39b: UTF-16 LE BOM → YamlInvalidUtf8Error', () => {
    const input = new Uint8Array([0xff, 0xfe, 0x68, 0x00]);
    expect(() => parseYaml(input)).toThrow(YamlInvalidUtf8Error);
  });

  it('TC40: leading --- accepted; hadDirectivesEndMarker: true', () => {
    const result = parseYaml('---\nhello\n');
    expect(result.hadDirectivesEndMarker).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('TC41: trailing non-whitespace content after doc → YamlParseError (Trap 15)', () => {
    // A flow sequence followed by trailing content on the same line
    expect(() => parseYaml('[1, 2] trailing_garbage')).toThrow(YamlParseError);
    // A flow sequence followed by trailing content on a new line
    expect(() => parseYaml('[1, 2]\ntrailing garbage')).toThrow(YamlParseError);
  });

  it('TC42: comment-only doc → { value: null } (Trap 14)', () => {
    const result = parseYaml('# this is a comment\n# another comment\n');
    expect(result.value).toBe(null);
  });

  it('TC52: %YAML 1.2 directive → hadYamlDirective: true', () => {
    const result = parseYaml('%YAML 1.2\n---\nhello\n');
    expect(result.hadYamlDirective).toBe(true);
    expect(result.hadDirectivesEndMarker).toBe(true);
    expect(result.value).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Serialize + round-trip tests
// ---------------------------------------------------------------------------

describe('serializeYaml — canonical emit', () => {
  it('TC43: canonical emit: sorted keys, 2-space indent, no BOM, no ---', () => {
    const file: YamlFile = {
      value: { z: 'last', a: 'first', m: 'middle' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    // Keys should be alphabetically sorted
    const aIdx = out.indexOf('a:');
    const mIdx = out.indexOf('m:');
    const zIdx = out.indexOf('z:');
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
    // No BOM
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    // No leading ---
    expect(out.startsWith('---')).toBe(false);
    // LF line endings
    expect(out.includes('\r')).toBe(false);
  });

  it('TC44: string "no" round-trips double-quoted, NOT plain (Trap 5)', () => {
    const file: YamlFile = {
      value: { flag: 'no' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    // 'no' as a plain scalar would be parsed as string by Core Schema,
    // but we still double-quote ambiguous values for safety
    expect(out).toContain('"no"');
  });

  it('TC45: string "123" round-trips double-quoted (matches int-regex)', () => {
    const file: YamlFile = {
      value: { count: '123' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('"123"');
    // Verify it round-trips back to string
    const parsed = parseYaml(out);
    expect((parsed.value as Record<string, unknown>).count).toBe('123');
  });

  it('TC46: bigint > 2^53 round-trips', () => {
    const big = 2n ** 53n + 1n;
    const file: YamlFile = {
      value: big,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    const parsed = parseYaml(out);
    expect(parsed.value).toBe(big);
  });

  it('TC47: anchors/aliases expanded on emit', () => {
    const yaml = 'a: &ref hello\nb: *ref\n';
    const parsed = parseYaml(yaml);
    const out = serializeYaml(parsed);
    // No anchors or aliases in output
    expect(out.includes('&')).toBe(false);
    expect(out.includes('*')).toBe(false);
    // Both values should be 'hello'
    const reparsed = parseYaml(out);
    const v = reparsed.value as Record<string, unknown>;
    expect(v.a).toBe('hello');
    expect(v.b).toBe('hello');
  });

  it('TC48: map key "foo: bar" emitted double-quoted', () => {
    const file: YamlFile = {
      value: { 'foo: bar': 'value' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('"foo: bar"');
  });
});

// ---------------------------------------------------------------------------
// Backend wiring tests
// ---------------------------------------------------------------------------

describe('parseDataText / serializeDataText YAML wiring', () => {
  it('TC49: parseDataText(input, "yaml") → { kind: "yaml" }', () => {
    const result = parseDataText('hello: world\n', 'yaml');
    expect(result.kind).toBe('yaml');
    if (result.kind === 'yaml') {
      const v = result.file.value as Record<string, unknown>;
      expect(v.hello).toBe('world');
    }
  });

  it('TC50: DataTextBackend.canHandle application/yaml + aliases', async () => {
    const backend = new DataTextBackend();
    const yaml = YAML_FORMAT;
    const mimes = [YAML_MIME, YAML_MIME_ALIAS_X, YAML_MIME_ALIAS_TEXT, YAML_MIME_ALIAS_TEXT_X];
    for (const mime of mimes) {
      const desc = { ext: 'yaml', mime, category: 'data' as const, description: 'YAML' };
      expect(await backend.canHandle(desc, desc)).toBe(true);
    }
    // Non-YAML should not match
    const json = {
      ext: 'json',
      mime: 'application/json',
      category: 'data' as const,
      description: 'JSON',
    };
    expect(await backend.canHandle(json, yaml)).toBe(false);
  });

  it('TC51: serializeDataText dispatches YAML', () => {
    const parsed = parseDataText('key: value\n', 'yaml');
    const out = serializeDataText(parsed);
    expect(typeof out).toBe('string');
    expect(out).toContain('key');
    expect(out).toContain('value');
  });
});

// ---------------------------------------------------------------------------
// Tag handling
// ---------------------------------------------------------------------------

describe('parseYaml — tag handling', () => {
  it('TC53: single-quoted multi-line folding', () => {
    const yaml = "value: 'line one\n  line two'\n";
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    // Single newline between lines → folded to space
    expect(v).toContain('line one');
    expect(v).toContain('line two');
  });

  it('TC54: !!str tag forces string type for "123"', () => {
    const result = parseYaml('value: !!str 123');
    const v = result.value as Record<string, unknown>;
    expect(v.value).toBe('123');
    expect(typeof v.value).toBe('string');
  });

  it('TC55: !!null tag forces null', () => {
    const result = parseYaml('value: !!null ""');
    const v = result.value as Record<string, unknown>;
    expect(v.value).toBe(null);
  });

  it('allowlisted !!int and !!float tags work', () => {
    const result = parseYaml('value: !!int "42"');
    expect((result.value as Record<string, unknown>).value).toBe(42n);

    const result2 = parseYaml('value: !!float "1.5"');
    expect((result2.value as Record<string, unknown>).value).toBe(1.5);
  });

  it('!!bool tag works', () => {
    const result = parseYaml('value: !!bool true');
    expect((result.value as Record<string, unknown>).value).toBe(true);
  });

  it('allowlisted !!seq and !!map tags do not throw', () => {
    // !!seq on a flow sequence
    expect(() => parseYaml('value: !!seq [1, 2, 3]')).not.toThrow(YamlTagForbiddenError);
    // !!map on a flow map
    expect(() => parseYaml('value: !!map {a: 1}')).not.toThrow(YamlTagForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Serializer edge cases
// ---------------------------------------------------------------------------

describe('serializeYaml — edge cases', () => {
  it('null value serializes as "null"', () => {
    const file: YamlFile = {
      value: null,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file).trim()).toBe('null');
  });

  it('boolean true/false serializes correctly', () => {
    const t: YamlFile = {
      value: true,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const f: YamlFile = {
      value: false,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(t).trim()).toBe('true');
    expect(serializeYaml(f).trim()).toBe('false');
  });

  it('.nan / .inf / -.inf serialized correctly', () => {
    const nan: YamlFile = {
      value: Number.NaN,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const inf: YamlFile = {
      value: Number.POSITIVE_INFINITY,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const ninf: YamlFile = {
      value: Number.NEGATIVE_INFINITY,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(nan).trim()).toBe('.nan');
    expect(serializeYaml(inf).trim()).toBe('.inf');
    expect(serializeYaml(ninf).trim()).toBe('-.inf');
  });

  it('empty map serializes as {}', () => {
    const file: YamlFile = {
      value: {},
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file).trim()).toBe('{}');
  });

  it('empty array serializes as []', () => {
    const file: YamlFile = {
      value: [],
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file).trim()).toBe('[]');
  });

  it('string needing quoting: starts with #', () => {
    const file: YamlFile = {
      value: { comment: '# not a comment' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('"# not a comment"');
  });

  it('string with control char gets quoted', () => {
    const file: YamlFile = {
      value: { raw: 'tab\there' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    // Should be double-quoted with \t escape
    expect(out).toContain('"tab\\there"');
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('parseYaml + serializeYaml — round-trip', () => {
  it('map round-trip preserves types', () => {
    const yaml = 'age: 42\nname: Alice\nscore: 9.5\nactive: true\n';
    const parsed = parseYaml(yaml);
    const out = serializeYaml(parsed);
    const reparsed = parseYaml(out);
    const v = reparsed.value as Record<string, unknown>;
    expect(v.age).toBe(42n);
    expect(v.name).toBe('Alice');
    expect(v.score).toBe(9.5);
    expect(v.active).toBe(true);
  });

  it('sequence of scalars round-trip', () => {
    const yaml = '- 1\n- two\n- true\n- null\n';
    const parsed = parseYaml(yaml);
    const out = serializeYaml(parsed);
    const reparsed = parseYaml(out);
    const v = reparsed.value as unknown[];
    expect(v[0]).toBe(1n);
    expect(v[1]).toBe('two');
    expect(v[2]).toBe(true);
    expect(v[3]).toBe(null);
  });

  it('malformed UTF-8 → YamlInvalidUtf8Error', () => {
    expect(() => parseYaml(invalidUtf8())).toThrow(YamlInvalidUtf8Error);
  });
});

// ---------------------------------------------------------------------------
// Review-fix regression tests
// ---------------------------------------------------------------------------

describe('HIGH-1 regression: nested array-of-maps round-trip', () => {
  it('parse → serialize → parse preserves nested array-of-maps structure', () => {
    const input = `${[
      'containers:',
      '  - name: nginx',
      '    image: foo',
      '  - name: redis',
      '    image: bar',
    ].join('\n')}\n`;

    const parsed1 = parseYaml(input);
    const serialized = serializeYaml(parsed1);
    const parsed2 = parseYaml(serialized);

    // parse(serialize(parse(input))) must match parse(input) structurally
    const v1 = parsed1.value as Record<string, unknown>;
    const v2 = parsed2.value as Record<string, unknown>;
    const containers1 = v1.containers as Array<Record<string, unknown>>;
    const containers2 = v2.containers as Array<Record<string, unknown>>;

    expect(containers2).toHaveLength(2);
    expect(containers2[0]?.name).toBe(containers1[0]?.name);
    expect(containers2[0]?.image).toBe(containers1[0]?.image);
    expect(containers2[1]?.name).toBe(containers1[1]?.name);
    expect(containers2[1]?.image).toBe(containers1[1]?.image);
  });
});

describe('HIGH-2 regression: !!int / !!float invalid coercion', () => {
  it('!!int applied to non-integer scalar throws YamlParseError', () => {
    expect(() => parseYaml('x: !!int hello')).toThrow(YamlParseError);
  });

  it('!!float applied to non-float scalar throws YamlParseError', () => {
    expect(() => parseYaml('x: !!float hello')).toThrow(YamlParseError);
  });
});

describe('MEDIUM-1 regression: tab in block scalar continuation lines', () => {
  it('tab as leading character in block scalar content throws YamlIndentError', () => {
    expect(() => parseYaml('text: |\n\tindented with tab\n')).toThrow(YamlIndentError);
  });
});

describe('MEDIUM security regression: forward alias reference', () => {
  it('alias before anchor declaration throws YamlAnchorUndefinedError', () => {
    expect(() => parseYaml('x: *notdefined\n')).toThrow(YamlAnchorUndefinedError);
  });
});

describe('MEDIUM-4 security regression: strengthen TC41 trailing content', () => {
  it('trailing content on a new line after flow sequence throws YamlParseError', () => {
    expect(() => parseYaml('[1, 2]\ntrailing garbage')).toThrow(YamlParseError);
  });
});

describe('LOW regression: URI-form tag forbidden', () => {
  it('!<tag:yaml.org,2002:python/object> throws YamlTagForbiddenError', () => {
    expect(() => parseYaml('!<tag:yaml.org,2002:python/object> value')).toThrow(
      YamlTagForbiddenError,
    );
  });
});

// ---------------------------------------------------------------------------
// Branch coverage group — targets uncovered branches in YAML files
// ---------------------------------------------------------------------------

describe('branch coverage: CRLF line endings', () => {
  it('parses document with \\r\\n line endings', () => {
    const result = parseYaml('key: value\r\nother: 42\r\n');
    const v = result.value as Record<string, unknown>;
    expect(v.key).toBe('value');
    expect(v.other).toBe(42n);
  });

  it('\\r\\n in single-quoted scalar line folding', () => {
    const result = parseYaml("value: 'line one\r\n  line two'");
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).toContain('line one');
    expect(v).toContain('line two');
  });

  it('\\r\\n in double-quoted scalar line folding', () => {
    const result = parseYaml('"line one\r\n  line two"');
    const v = result.value as string;
    expect(v).toContain('line one');
    expect(v).toContain('line two');
  });

  it('\\r\\n in block mapping parses correctly', () => {
    // Exercises \r handling in skipNewline (the \r before \n path)
    const result = parseYaml('key: value\r\n');
    expect((result.value as Record<string, unknown>).key).toBe('value');
  });
});

describe('branch coverage: escape sequences in double-quoted scalars', () => {
  it('\\0 null byte escape', () => {
    const result = parseYaml('"\\0"');
    expect(result.value).toBe('\x00');
  });

  it('\\a bell escape', () => {
    const result = parseYaml('"\\a"');
    expect(result.value).toBe('\x07');
  });

  it('\\b backspace escape', () => {
    const result = parseYaml('"\\b"');
    expect(result.value).toBe('\b');
  });

  it('\\v vertical tab escape', () => {
    const result = parseYaml('"\\v"');
    expect(result.value).toBe('\x0B');
  });

  it('\\f form feed escape', () => {
    const result = parseYaml('"\\f"');
    expect(result.value).toBe('\f');
  });

  it('\\r carriage return escape', () => {
    const result = parseYaml('"\\r"');
    expect(result.value).toBe('\r');
  });

  it('\\e ESC escape', () => {
    const result = parseYaml('"\\e"');
    expect(result.value).toBe('\x1B');
  });

  it('\\ space escape', () => {
    const result = parseYaml('"a\\ b"');
    expect(result.value).toBe('a b');
  });

  it('\\/ solidus escape', () => {
    const result = parseYaml('"a\\/b"');
    expect(result.value).toBe('a/b');
  });

  it('\\\\ backslash escape', () => {
    const result = parseYaml('"a\\\\b"');
    expect(result.value).toBe('a\\b');
  });

  it('\\N next-line escape (U+0085)', () => {
    const result = parseYaml('"\\N"');
    expect(result.value).toBe('\u0085');
  });

  it('\\_ no-break space escape (U+00A0)', () => {
    const result = parseYaml('"\\_ "');
    expect((result.value as string)[0]).toBe('\u00A0');
  });

  it('\\L line separator escape (U+2028)', () => {
    const result = parseYaml('"\\L"');
    expect(result.value).toBe('\u2028');
  });

  it('\\P paragraph separator escape (U+2029)', () => {
    const result = parseYaml('"\\P"');
    expect(result.value).toBe('\u2029');
  });

  it('\\xHH two-digit hex escape', () => {
    const result = parseYaml('"\\x41"');
    expect(result.value).toBe('A');
  });

  it('\\UXXXXXXXX 8-digit hex escape (U+1F600)', () => {
    const result = parseYaml('"\\U0001F600"');
    expect(result.value).toBe('\u{1F600}');
  });

  it('\\r\\n line continuation trims leading whitespace', () => {
    // Backslash followed by \r\n: line continuation
    const result = parseYaml('"first\\\r\n  second"');
    expect(result.value).toBe('firstsecond');
  });

  it('\\<newline> line continuation (\\n)', () => {
    const result = parseYaml('"first\\\n  second"');
    expect(result.value).toBe('firstsecond');
  });

  it('surrogate code point in \\u escape throws', () => {
    expect(() => parseYaml('"\\uD800"')).toThrow(YamlParseError);
  });

  it('code point > U+10FFFF in \\U escape throws', () => {
    expect(() => parseYaml('"\\U00110000"')).toThrow(YamlParseError);
  });

  it('invalid hex digit in \\x escape throws', () => {
    expect(() => parseYaml('"\\xZZ"')).toThrow(YamlParseError);
  });

  it('EOF after backslash throws', () => {
    expect(() => parseYaml('"hello\\')).toThrow(YamlParseError);
  });
});

describe('branch coverage: single-quoted scalar edge cases', () => {
  it('empty single-quoted scalar', () => {
    const result = parseYaml("''");
    expect(result.value).toBe('');
  });

  it('single-quoted scalar with multiple blank lines (keep newlines)', () => {
    const result = parseYaml("'line one\n\n\nline two'");
    const v = result.value as string;
    expect(v).toContain('\n\n');
  });

  it('unterminated single-quoted scalar throws', () => {
    expect(() => parseYaml("'unterminated")).toThrow(YamlParseError);
  });

  it('unterminated double-quoted scalar throws', () => {
    expect(() => parseYaml('"unterminated')).toThrow(YamlParseError);
  });
});

describe('branch coverage: block scalar variants', () => {
  it('block literal | with explicit indent indicator', () => {
    // |2 sets explicitIndent=2; parentIndent=mapIndent+2=3; contentIndent=3+2-1=4
    // Content at 4 spaces; after consuming 4 spaces the text starts with 'hello'
    const result = parseYaml('value: |2\n    hello\n    world\n');
    expect((result.value as Record<string, unknown>).value).toBe('hello\nworld\n');
  });

  it('block folded > with strip chomping', () => {
    const yaml = 'value: >-\n  first line\n  second line\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).not.toMatch(/\n$/);
    expect(v).toContain('first line');
  });

  it('block folded > with keep chomping and trailing empty lines', () => {
    const yaml = 'value: >+\n  first line\n\n\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).toContain('first line');
    expect(v).toMatch(/\n\n$/);
  });

  it('block literal with indented continuation line (starts with space)', () => {
    const yaml = 'value: |\n  normal\n    indented more\n';
    const v = (parseYaml(yaml).value as Record<string, unknown>).value as string;
    expect(v).toContain('normal');
    expect(v).toContain('  indented more');
  });

  it('block scalar header with unexpected character throws', () => {
    expect(() => parseYaml('value: |!\n  content\n')).toThrow(YamlParseError);
  });

  it('block scalar with \\r\\n line ending inside content', () => {
    const result = parseYaml('value: |\r\n  hello\r\n  world\r\n');
    expect((result.value as Record<string, unknown>).value).toBe('hello\nworld\n');
  });

  it('block scalar empty after header (no content lines)', () => {
    const result = parseYaml('value: |\n');
    expect((result.value as Record<string, unknown>).value).toBe('');
  });

  it('block folded with lines that start with space (no folding applied)', () => {
    const yaml = 'value: >\n  normal line\n   spaced line\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).toContain('normal line');
    expect(v).toContain(' spaced line');
  });
});

describe('branch coverage: plain scalar multi-line continuation', () => {
  it('multi-line plain scalar with blank line separator', () => {
    // Two lines separated by a blank line → newline preserved in plain scalar
    const yaml = 'value: first line\n\n  second line\n';
    // This is actually a single-key map where the value is a plain scalar
    // that can continue on the next indented line
    const result = parseYaml(yaml);
    expect(result.value).toBeTruthy();
  });

  it('plain scalar followed by comment stops at comment', () => {
    const result = parseYaml('value: hello # this is a comment\n');
    expect((result.value as Record<string, unknown>).value).toBe('hello');
  });

  it('plain scalar in flow context stops at comma', () => {
    const result = parseYaml('[hello, world]');
    expect(result.value).toEqual(['hello', 'world']);
  });

  it('plain scalar where colon followed by flow terminator stops parsing', () => {
    // In flow context, colon followed by '}' stops the plain scalar
    // {k: v:} -> value 'v' stops at ':}', then ':' becomes a key with null value
    const result = parseYaml('{k: v:}');
    const v = result.value as Record<string, unknown>;
    expect(v.k).toBe('v');
  });

  it('plain scalar continuation stops at block sequence indicator', () => {
    // A block sequence at the same indent ends the prior plain scalar context
    const yaml = 'key: value\n- item\n';
    const result = parseYaml(yaml);
    expect(result.value).toBeTruthy();
  });
});

describe('branch coverage: document markers in parser context', () => {
  it('--- after block content stops block seq parsing', () => {
    const yaml = '- alpha\n- beta\n---\nnext: value\n';
    // Second --- is caught by checkNoMultiDoc
    expect(() => parseYaml(yaml)).toThrow(YamlMultiDocForbiddenError);
  });

  it('... after block map stops parsing and is caught', () => {
    const yaml = 'key: value\n...\n';
    expect(() => parseYaml(yaml)).toThrow(YamlMultiDocForbiddenError);
  });

  it('--- at col 1 mid-parse stops block map (second --- caught after)', () => {
    const yaml = '---\nkey: value\n---\n';
    expect(() => parseYaml(yaml)).toThrow(YamlMultiDocForbiddenError);
  });

  it('--- as document-end marker in block sequence context', () => {
    const yaml = '---\n- a\n- b\n---\n- c\n';
    expect(() => parseYaml(yaml)).toThrow(YamlMultiDocForbiddenError);
  });
});

describe('branch coverage: anchor on various node types', () => {
  it('anchor on block scalar value', () => {
    const yaml = 'original: &ref |\n  hello\ncopy: *ref\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.original).toBe('hello\n');
    expect(v.copy).toBe('hello\n');
  });

  it('anchor on single-quoted scalar', () => {
    const yaml = "original: &ref 'quoted'\ncopy: *ref\n";
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.original).toBe('quoted');
    expect(v.copy).toBe('quoted');
  });

  it('anchor on double-quoted scalar', () => {
    const yaml = 'original: &ref "dquoted"\ncopy: *ref\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.original).toBe('dquoted');
    expect(v.copy).toBe('dquoted');
  });

  it('anchor on flow sequence', () => {
    const yaml = 'original: &ref [1, 2, 3]\ncopy: *ref\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect(v.original).toEqual([1n, 2n, 3n]);
    expect(v.copy).toEqual([1n, 2n, 3n]);
  });

  it('anchor on flow map', () => {
    const yaml = 'original: &ref {x: 1}\ncopy: *ref\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect((v.original as Record<string, unknown>).x).toBe(1n);
    expect((v.copy as Record<string, unknown>).x).toBe(1n);
  });

  it('anchor on value followed by newline (tag+anchor then newline → next-line content)', () => {
    const yaml = '&myanchor\nhello\n';
    const result = parseYaml(yaml);
    expect(result.value).toBe('hello');
  });

  it('tag followed by newline with no next-line content → null scalar', () => {
    const yaml = 'key: !!str\n';
    const result = parseYaml(yaml);
    // tag on empty subsequent content → empty string coerced by !!str to ''
    const v = (result.value as Record<string, unknown>).key;
    expect(v).toBe('');
  });
});

describe('branch coverage: complex key and flow edge cases', () => {
  it('complex key with \\t after ? → YamlComplexKeyForbiddenError', () => {
    expect(() => parseYaml('?\there: value\n')).toThrow(YamlComplexKeyForbiddenError);
  });

  it('complex key with \\n after ? in block map → YamlComplexKeyForbiddenError', () => {
    expect(() => parseYaml('?\nvalue: x\n')).toThrow(YamlComplexKeyForbiddenError);
  });

  it('complex key ? in parseBlockMap → YamlComplexKeyForbiddenError', () => {
    // This exercises the ? check inside parseBlockMap
    expect(() => parseYaml('key: value\n? complex\n: other\n')).toThrow(
      YamlComplexKeyForbiddenError,
    );
  });

  it('unterminated flow sequence throws', () => {
    expect(() => parseYaml('[1, 2, 3')).toThrow(YamlParseError);
  });

  it('unterminated flow mapping throws', () => {
    expect(() => parseYaml('{a: 1, b: 2')).toThrow(YamlParseError);
  });

  it('flow mapping missing colon after key throws', () => {
    expect(() => parseYaml('{key value}')).toThrow(YamlParseError);
  });

  it('flow sequence with multiline content', () => {
    const result = parseYaml('[\n  1,\n  2,\n  3\n]');
    expect(result.value).toEqual([1n, 2n, 3n]);
  });

  it('flow mapping with multiline content', () => {
    const result = parseYaml('{\n  a: 1,\n  b: 2\n}');
    expect(result.value).toEqual({ a: 1n, b: 2n });
  });

  it('duplicate key in flow mapping → YamlDuplicateKeyError', () => {
    expect(() => parseYaml('{a: 1, a: 2}')).toThrow(YamlDuplicateKeyError);
  });
});

describe('branch coverage: UTF-32 BOM detection', () => {
  it('UTF-32 BE BOM → YamlInvalidUtf8Error', () => {
    const input = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x68]);
    expect(() => parseYaml(input)).toThrow(YamlInvalidUtf8Error);
  });

  it('UTF-32 LE BOM → YamlInvalidUtf8Error', () => {
    const input = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00]);
    expect(() => parseYaml(input)).toThrow(YamlInvalidUtf8Error);
  });
});

describe('branch coverage: skipBlankAndCommentLines edge cases', () => {
  it('comment-only line then content', () => {
    const result = parseYaml('# comment\nvalue: 42\n');
    expect((result.value as Record<string, unknown>).value).toBe(42n);
  });

  it('blank line at EOF inside skipBlankAndCommentLines', () => {
    // Document that ends with blank lines and nothing else
    const result = parseYaml('value: hello\n\n\n');
    expect((result.value as Record<string, unknown>).value).toBe('hello');
  });

  it('tab in leading indent of nested content after blank line → YamlIndentError', () => {
    // After parsing 'parent:', blank line, then tab-indented content inside block map
    expect(() => parseYaml('parent:\n\n\t child: value\n')).toThrow(YamlIndentError);
  });

  it('line with only a comment followed by EOF (no newline)', () => {
    const result = parseYaml('value: hi # end comment');
    expect((result.value as Record<string, unknown>).value).toBe('hi');
  });
});

describe('branch coverage: serializeYaml needsQuoting paths', () => {
  it('empty string serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('""');
  });

  it('string "null" (matches NULL_RE) serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: 'null' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"null"');
  });

  it('string "true" (matches BOOL_RE) serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: 'true' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"true"');
  });

  it('string "1.5" (matches FLOAT_RE) serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '1.5' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"1.5"');
  });

  it('string "yes" (YAML 1.1 ambiguous) serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: 'yes' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"yes"');
  });

  it('string "---" serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '---' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"---"');
  });

  it('string "..." serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '...' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"..."');
  });

  it('string starting with & serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '&anchor' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"&anchor"');
  });

  it('string starting with * serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '*alias' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"*alias"');
  });

  it('string starting with ? serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: '? question' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"? question"');
  });

  it('string ending with space serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: 'trailing ' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"trailing "');
  });

  it('string ending with tab serializes double-quoted', () => {
    const file: YamlFile = {
      value: { key: 'trailing\t' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('"');
  });

  it('string with DEL character (0x7f) serializes double-quoted with \\x escape', () => {
    const file: YamlFile = {
      value: { key: 'del\x7fchar' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('\\x7f');
  });

  it('string with C1 control char (0x80..0x9f) in quoted context emits \\x escape', () => {
    // C1 chars (0x80..0x9f) don't trigger needsQuoting by themselves, but they ARE
    // escaped in emitDoubleQuoted. Use a string that also has another quoting trigger
    // (starts with '!' indicator) so that emitDoubleQuoted processes the C1 char.
    const file: YamlFile = {
      value: { key: '!\u0085' }, // '!' triggers quoting (YAML indicator), U+0085 = NEL in C1 range
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('\\x85');
  });

  it('string with colon-tab triggers quoting', () => {
    const file: YamlFile = {
      value: { key: 'a:\tb' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"');
  });

  it('string with colon-newline triggers quoting', () => {
    const file: YamlFile = {
      value: { key: 'a:\nb' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"');
  });

  it('string with space-hash triggers quoting', () => {
    const file: YamlFile = {
      value: { key: 'value #comment' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"value #comment"');
  });

  it('string with \\r triggers quoting', () => {
    const file: YamlFile = {
      value: { key: 'line\rend' },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"');
  });

  it('top-level string that needs quoting', () => {
    const file: YamlFile = {
      value: 'null',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('"null"');
  });
});

describe('branch coverage: serializeYaml emitDoubleQuoted control chars', () => {
  it('NUL byte (\\x00) → \\0 in output', () => {
    const file: YamlFile = {
      value: '\x00',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\0');
  });

  it('bell (\\x07) → \\a in output', () => {
    const file: YamlFile = {
      value: '\x07',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\a');
  });

  it('backspace (\\x08) → \\b in output', () => {
    const file: YamlFile = {
      value: '\x08',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\b');
  });

  it('tab (\\x09) → \\t in output', () => {
    const file: YamlFile = {
      value: '\t',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\t');
  });

  it('newline (\\x0a) → \\n in output', () => {
    const file: YamlFile = {
      value: '\n',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\n');
  });

  it('vertical tab (\\x0b) → \\v in output', () => {
    const file: YamlFile = {
      value: '\x0b',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\v');
  });

  it('form feed (\\x0c) → \\f in output', () => {
    const file: YamlFile = {
      value: '\x0c',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\f');
  });

  it('carriage return (\\x0d) → \\r in output', () => {
    const file: YamlFile = {
      value: '\r',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\r');
  });

  it('ESC (\\x1b) → \\e in output', () => {
    const file: YamlFile = {
      value: '\x1b',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\e');
  });

  it('double-quote → \\" in output', () => {
    const file: YamlFile = {
      value: '"hello"',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file)).toContain('\\"hello\\"');
  });

  it('backslash in quoted context → \\\\ in output', () => {
    // A backslash alone does NOT trigger needsQuoting, but combined with a quoting
    // trigger (e.g. starts with '!') forces emitDoubleQuoted which then escapes '\'
    const file: YamlFile = {
      value: '!back\\slash',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    // The '!' triggers quoting; the '\' is escaped as '\\' inside double quotes
    expect(out).toContain('\\\\');
  });

  it('supplementary code point (> U+FFFF) emitted as literal character', () => {
    // U+1F600 GRINNING FACE — should pass through as-is (no escape needed)
    const file: YamlFile = {
      value: '\u{1F600}',
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    // The emoji should appear literally or round-trip correctly
    expect(out).toContain('\u{1F600}');
  });
});

describe('branch coverage: serializeYaml top-level array variants', () => {
  it('top-level array containing a nested array', () => {
    const file: YamlFile = {
      value: [
        [1n, 2n],
        [3n, 4n],
      ],
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('- ');
    // Round-trip check
    const reparsed = parseYaml(out);
    expect(reparsed.value).toEqual([
      [1n, 2n],
      [3n, 4n],
    ]);
  });

  it('top-level array containing an empty map', () => {
    const file: YamlFile = {
      value: [{}],
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(typeof out).toBe('string');
    // Empty map at top-level array item — should not crash
  });

  it('top-level array with scalar items of various types', () => {
    const file: YamlFile = {
      value: [null, true, 42n, 3.14, 'hello'],
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('null');
    expect(out).toContain('true');
    expect(out).toContain('42');
    expect(out).toContain('3.14');
    expect(out).toContain('hello');
  });
});

describe('branch coverage: emitValue nested map/array paths', () => {
  it('map value that is an empty map renders as {} inline', () => {
    const file: YamlFile = {
      value: { nested: {} },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('{}');
  });

  it('map value that is an empty array renders as [] inline', () => {
    const file: YamlFile = {
      value: { list: [] },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('[]');
  });

  it('map value that is a non-empty array renders with newline prefix', () => {
    const file: YamlFile = {
      value: { items: [1n, 2n] },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('items:');
    expect(out).toContain('- 1');
  });

  it('map value that is a non-empty nested map renders with newline prefix', () => {
    const file: YamlFile = {
      value: { outer: { inner: 'value' } },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('outer:');
    expect(out).toContain('inner: value');
  });

  it('array item that is a non-empty map emits as block map under dash', () => {
    const file: YamlFile = {
      value: { items: [{ name: 'Alice', age: 30n }] },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('name: Alice');
    expect(out).toContain('age: 30');
  });

  it('array item that is a nested array emits properly', () => {
    const file: YamlFile = {
      value: {
        matrix: [
          [1n, 2n],
          [3n, 4n],
        ],
      },
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    const out = serializeYaml(file);
    expect(out).toContain('matrix:');
    expect(out).toContain('- 1');
  });
});

describe('branch coverage: number zero and edge float values', () => {
  it('integer 0 round-trips', () => {
    const result = parseYaml('0');
    expect(result.value).toBe(0n);
    const file: YamlFile = {
      value: 0n,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file).trim()).toBe('0');
  });

  it('float 0.0 round-trips', () => {
    const result = parseYaml('0.0');
    expect(result.value).toBe(0);
    const file: YamlFile = {
      value: 0,
      hadBom: false,
      hadDirectivesEndMarker: false,
      hadYamlDirective: false,
    };
    expect(serializeYaml(file).trim()).toBe('0');
  });

  it('negative integer round-trips', () => {
    const result = parseYaml('-42');
    expect(result.value).toBe(-42n);
  });

  it('positive sign integer +7 round-trips as bigint', () => {
    expect(parseYaml('+7').value).toBe(7n);
  });

  it('!!float .inf round-trip', () => {
    const result = parseYaml('value: !!float .inf');
    expect((result.value as Record<string, unknown>).value).toBe(Number.POSITIVE_INFINITY);
  });

  it('!!float -.inf round-trip', () => {
    const result = parseYaml('value: !!float -.inf');
    expect((result.value as Record<string, unknown>).value).toBe(Number.NEGATIVE_INFINITY);
  });

  it('!!float .nan round-trip', () => {
    const result = parseYaml('value: !!float .nan');
    expect(Number.isNaN((result.value as Record<string, unknown>).value as number)).toBe(true);
  });

  it('!!bool with empty string → null', () => {
    const result = parseYaml('value: !!bool ""');
    expect((result.value as Record<string, unknown>).value).toBeNull();
  });

  it('!!bool with non-bool non-empty string → raw string', () => {
    const result = parseYaml('value: !!bool maybe');
    expect((result.value as Record<string, unknown>).value).toBe('maybe');
  });
});

describe('branch coverage: parseNodeWithMeta paths', () => {
  it('anchor then newline then block sequence', () => {
    const yaml = '&myseq\n- a\n- b\n';
    const result = parseYaml(yaml);
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toEqual(['a', 'b']);
  });

  it('anchor then newline then flow sequence', () => {
    const yaml = '&myseq\n[1, 2]\n';
    const result = parseYaml(yaml);
    expect(result.value).toEqual([1n, 2n]);
  });

  it('anchor then newline then flow map', () => {
    const yaml = '&mymap\n{a: 1}\n';
    const result = parseYaml(yaml);
    expect((result.value as Record<string, unknown>).a).toBe(1n);
  });

  it('anchor then newline then block scalar', () => {
    const yaml = '&mybscalar\n|\n  content\n';
    const result = parseYaml(yaml);
    expect(result.value).toBe('content\n');
  });

  it('anchor followed by newline then nothing → null scalar', () => {
    const yaml = 'key: &myanchor\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).key;
    expect(v).toBeNull();
  });
});

describe('branch coverage: checkNoMultiDoc trailing content', () => {
  it('trailing comment after doc is allowed', () => {
    const result = parseYaml('value: 42\n# trailing comment\n');
    expect((result.value as Record<string, unknown>).value).toBe(42n);
  });

  it('multiple comments after doc body are allowed', () => {
    const result = parseYaml('hello\n# first\n# second\n');
    expect(result.value).toBe('hello');
  });
});

describe('branch coverage: anchor name validation', () => {
  it('invalid anchor name (empty after &) throws', () => {
    expect(() => parseYaml('& value\n')).toThrow(YamlParseError);
  });

  it('invalid anchor name (special chars) throws', () => {
    expect(() => parseYaml('&my@anchor value\n')).toThrow(YamlParseError);
  });
});

describe('branch coverage: block seq empty item variants', () => {
  it('block seq item with newline after dash (value on next line)', () => {
    const yaml = '-\n  nested: value\n';
    const result = parseYaml(yaml);
    const arr = result.value as unknown[];
    expect((arr[0] as Record<string, unknown>).nested).toBe('value');
  });

  it('block seq item at EOF after dash', () => {
    const yaml = '- ';
    const result = parseYaml(yaml);
    const arr = result.value as unknown[];
    expect(arr[0]).toBeNull();
  });

  it('block map: value on next line indented', () => {
    const yaml = 'key:\n  subkey: subvalue\n';
    const result = parseYaml(yaml);
    const v = result.value as Record<string, unknown>;
    expect((v.key as Record<string, unknown>).subkey).toBe('subvalue');
  });

  it('block map value with comment before newline', () => {
    const yaml = 'key: # comment\n  value\n';
    // Comment before value → value on next line
    const result = parseYaml(yaml);
    expect(result.value).toBeTruthy();
  });
});

describe('branch coverage: applyChomping folded edge cases', () => {
  it('folded > with keep and trailing blank lines', () => {
    const yaml = 'value: >+\n  line one\n  line two\n\n\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).toContain('line one line two');
    expect(v.endsWith('\n\n')).toBe(true);
  });

  it('folded > with strip removes trailing newline', () => {
    const yaml = 'value: >-\n  single line\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v.trimEnd()).toBe('single line');
    expect(v.endsWith('\n')).toBe(false);
  });

  it('literal | with empty body and keep chomp', () => {
    const yaml = 'value: |+\n\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    // Empty body with keep: trailing empty lines preserved
    expect(typeof v).toBe('string');
  });

  it('literal | with zero lines and strip chomp produces empty string', () => {
    const yaml = 'value: |-\n';
    const result = parseYaml(yaml);
    const v = (result.value as Record<string, unknown>).value as string;
    expect(v).toBe('');
  });
});
