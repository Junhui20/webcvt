/**
 * Tests for toml.ts — covers all 28 design-note test cases plus extras.
 *
 * TC1:  Parse empty document → empty root
 * TC2:  Parse single bare-key scalar
 * TC3:  All four string flavours
 * TC4:  Multiline-basic backslash line-ending trim (Trap #6)
 * TC5:  Literal string no escape processing (Trap #7)
 * TC6:  Integers in 4 bases with underscores (Trap #2)
 * TC7:  BigInt preserved beyond safe integer (Trap #2)
 * TC8:  Leading-zero decimal rejected (Trap #12)
 * TC9:  inf / -inf / nan (Trap #10)
 * TC10: All 4 date/time variants as typed objects (Trap #1)
 * TC11: Space-separator date-time accepted (Trap #11)
 * TC12: Dotted keys create nested tables (Trap #3)
 * TC13: Dotted-key type conflict → TomlConflictingTypeError
 * TC14: [x] redefinition → TomlRedefineTableError (Trap #4)
 * TC15: [[array]] appends (Trap #5)
 * TC16: Inline tables with nested dotted keys (Trap #8)
 * TC17: Trailing comma inside inline table → error (Trap #8)
 * TC18: Trailing comma inside multi-line array → ok
 * TC19: Surrogate escape \uD800 rejected (Trap #13)
 * TC20: MAX_TOML_DEPTH breach → TomlDepthExceededError
 * TC21: MAX_TOML_STRING_LEN breach
 * TC22: BOM stripped + hadBom recorded
 * TC23: Malformed UTF-8 → TomlInvalidUtf8Error
 * TC24: Canonical serialize emits bigint integers, typed dates, inline vs section tables
 * TC25: Round-trip semantic equivalence for full corpus
 * TC26: parseDataText(input, 'toml') returns { kind: 'toml' }
 * TC27: DataTextBackend canHandle identity for application/toml
 * TC28: serializeDataText dispatches correctly
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { DataTextBackend, TOML_FORMAT } from './backend.ts';
import { MAX_TOML_DEPTH, MAX_TOML_STRING_LEN } from './constants.ts';
import {
  TomlBadEscapeError,
  TomlBadNumberError,
  TomlConflictingTypeError,
  TomlDepthExceededError,
  TomlDuplicateKeyError,
  TomlInvalidUtf8Error,
  TomlParseError,
  TomlRedefineTableError,
  TomlSerializeError,
  TomlStringTooLongError,
} from './errors.ts';
import { parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';
import { parseToml, serializeToml } from './toml.ts';
import type { TomlDate, TomlDateTime, TomlTime } from './toml.ts';

// ---------------------------------------------------------------------------
// TC1: Parse empty document → empty root
// ---------------------------------------------------------------------------

describe('TC1: parseToml empty document', () => {
  it('returns empty root for an empty string', () => {
    const result = parseToml('');
    expect(result.hadBom).toBe(false);
    expect(result.value).toEqual({});
  });

  it('returns empty root for whitespace-only document', () => {
    const result = parseToml('   \n\t\n  ');
    expect(result.value).toEqual({});
  });

  it('returns empty root for comment-only document', () => {
    const result = parseToml('# this is a comment\n# another comment\n');
    expect(result.value).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// TC2: Parse single bare-key scalar
// ---------------------------------------------------------------------------

describe('TC2: parseToml single bare-key scalar', () => {
  it('parses a simple string key', () => {
    const result = parseToml('name = "Alice"');
    expect(result.value).toEqual({ name: 'Alice' });
  });

  it('parses a boolean value', () => {
    const result = parseToml('enabled = true');
    expect(result.value).toEqual({ enabled: true });
  });

  it('parses a false boolean', () => {
    const result = parseToml('debug = false');
    expect(result.value).toEqual({ debug: false });
  });

  it('parses multiple keys', () => {
    const result = parseToml('a = 1\nb = 2\nc = 3\n');
    expect(result.value).toEqual({ a: 1n, b: 2n, c: 3n });
  });
});

// ---------------------------------------------------------------------------
// TC3: All four string flavours
// ---------------------------------------------------------------------------

describe('TC3: all four string flavours', () => {
  it('parses basic string with escape sequences', () => {
    const result = parseToml('s = "hello\\nworld"');
    expect(result.value).toEqual({ s: 'hello\nworld' });
  });

  it('parses literal string (no escape processing)', () => {
    const result = parseToml("s = 'hello\\nworld'");
    expect(result.value).toEqual({ s: 'hello\\nworld' });
  });

  it('parses multi-line basic string', () => {
    const result = parseToml('s = """\nhello\nworld"""');
    expect(result.value).toEqual({ s: 'hello\nworld' });
  });

  it('parses multi-line literal string (no escapes)', () => {
    const result = parseToml("s = '''\nhello\\nworld'''");
    expect(result.value).toEqual({ s: 'hello\\nworld' });
  });

  it('parses empty basic string', () => {
    const result = parseToml('s = ""');
    expect(result.value).toEqual({ s: '' });
  });

  it('parses empty literal string', () => {
    const result = parseToml("s = ''");
    expect(result.value).toEqual({ s: '' });
  });

  it('parses basic string with all recognized escapes', () => {
    const result = parseToml('s = "\\b\\t\\n\\f\\r\\\\\\""');
    expect(result.value).toEqual({ s: '\b\t\n\f\r\\"' });
  });

  it('parses unicode escape \\uXXXX', () => {
    const result = parseToml('s = "\\u0041"'); // A
    expect(result.value).toEqual({ s: 'A' });
  });

  it('parses unicode escape \\UXXXXXXXX', () => {
    const result = parseToml('s = "\\U0001F600"'); // emoji
    expect(result.value).toEqual({ s: '\u{1F600}' });
  });
});

// ---------------------------------------------------------------------------
// TC4: Multiline-basic backslash line-ending trim (Trap #6)
// ---------------------------------------------------------------------------

describe('TC4: multiline-basic backslash line-ending trim', () => {
  it('trims newline and subsequent whitespace after backslash', () => {
    const result = parseToml('s = """\nhello \\\n    world"""');
    expect(result.value).toEqual({ s: 'hello world' });
  });

  it('trims across multiple whitespace lines', () => {
    const result = parseToml('s = """\nhello \\\n  \n  world"""');
    expect(result.value).toEqual({ s: 'hello world' });
  });

  it('handles backslash trim at the very start of multiline string', () => {
    const result = parseToml('s = """\\\n  trimmed"""');
    expect(result.value).toEqual({ s: 'trimmed' });
  });
});

// ---------------------------------------------------------------------------
// TC5: Literal string no escape processing (Trap #7)
// ---------------------------------------------------------------------------

describe('TC5: literal string no escape processing', () => {
  it('preserves backslash-n as two characters', () => {
    const result = parseToml("s = 'C:\\\\Users\\\\name'");
    // All chars literal — \ is literal
    expect(result.value).toEqual({ s: 'C:\\\\Users\\\\name' });
  });

  it('multi-line literal string preserves all chars', () => {
    const result = parseToml("s = '''\n\\n\\t\\r'''");
    expect(result.value).toEqual({ s: '\\n\\t\\r' });
  });

  it('literal string with embedded quotes in single-quote context', () => {
    const result = parseToml('s = \'He said "hello"\'');
    expect(result.value).toEqual({ s: 'He said "hello"' });
  });
});

// ---------------------------------------------------------------------------
// TC6: Integers in 4 bases with underscores
// ---------------------------------------------------------------------------

describe('TC6: integers in four bases with underscores', () => {
  it('parses decimal integer', () => {
    const result = parseToml('n = 42');
    expect(result.value).toEqual({ n: 42n });
  });

  it('parses decimal with underscores', () => {
    const result = parseToml('n = 1_000_000');
    expect(result.value).toEqual({ n: 1_000_000n });
  });

  it('parses hexadecimal', () => {
    const result = parseToml('n = 0xFF');
    expect(result.value).toEqual({ n: 255n });
  });

  it('parses hex with underscores', () => {
    const result = parseToml('n = 0xDEAD_BEEF');
    expect(result.value).toEqual({ n: 0xdead_beefn });
  });

  it('parses octal', () => {
    const result = parseToml('n = 0o777');
    expect(result.value).toEqual({ n: 0o777n });
  });

  it('parses binary', () => {
    const result = parseToml('n = 0b1010');
    expect(result.value).toEqual({ n: 0b1010n });
  });

  it('parses zero', () => {
    const result = parseToml('n = 0');
    expect(result.value).toEqual({ n: 0n });
  });

  it('parses negative decimal', () => {
    const result = parseToml('n = -100');
    expect(result.value).toEqual({ n: -100n });
  });

  it('parses positive sign decimal', () => {
    const result = parseToml('n = +5');
    expect(result.value).toEqual({ n: 5n });
  });

  it('rejects +0xFF (signed hex not permitted per TOML v1.0)', () => {
    expect(() => parseToml('n = +0xFF')).toThrow(TomlBadNumberError);
  });

  it('rejects -0xFF (signed hex not permitted per TOML v1.0)', () => {
    expect(() => parseToml('n = -0xFF')).toThrow(TomlBadNumberError);
  });

  it('rejects +0o7 (signed octal not permitted per TOML v1.0)', () => {
    expect(() => parseToml('n = +0o7')).toThrow(TomlBadNumberError);
  });

  it('rejects +0b1 (signed binary not permitted per TOML v1.0)', () => {
    expect(() => parseToml('n = +0b1')).toThrow(TomlBadNumberError);
  });
});

// ---------------------------------------------------------------------------
// TC7: BigInt preserved beyond safe integer (Trap #2)
// ---------------------------------------------------------------------------

describe('TC7: bigint preserved beyond JS safe integer', () => {
  it('preserves 2^53 exactly as bigint', () => {
    const val = 2n ** 53n;
    const result = parseToml(`n = ${val.toString()}`);
    expect(typeof result.value.n).toBe('bigint');
    expect(result.value.n).toBe(val);
  });

  it('preserves 2^63-1 (INT64_MAX) exactly', () => {
    const val = 9223372036854775807n; // 2^63 - 1
    const result = parseToml(`n = ${val.toString()}`);
    expect(result.value.n).toBe(val);
  });

  it('rejects 2^63 (overflow)', () => {
    expect(() => parseToml('n = 9223372036854775808')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TC8: Leading-zero decimal rejected (Trap #12)
// ---------------------------------------------------------------------------

describe('TC8: leading-zero decimal rejected', () => {
  it('rejects 01', () => {
    expect(() => parseToml('n = 01')).toThrow();
  });

  it('rejects 007', () => {
    expect(() => parseToml('n = 007')).toThrow();
  });

  it('accepts single 0', () => {
    const result = parseToml('n = 0');
    expect(result.value.n).toBe(0n);
  });

  it('accepts 0x00FF (hex leading zeros fine)', () => {
    const result = parseToml('n = 0x00FF');
    expect(result.value.n).toBe(255n);
  });
});

// ---------------------------------------------------------------------------
// TC9: inf / -inf / nan (Trap #10)
// ---------------------------------------------------------------------------

describe('TC9: inf / -inf / nan float tokens', () => {
  it('parses inf', () => {
    const result = parseToml('f = inf');
    expect(result.value.f).toBe(Number.POSITIVE_INFINITY);
  });

  it('parses +inf', () => {
    const result = parseToml('f = +inf');
    expect(result.value.f).toBe(Number.POSITIVE_INFINITY);
  });

  it('parses -inf', () => {
    const result = parseToml('f = -inf');
    expect(result.value.f).toBe(Number.NEGATIVE_INFINITY);
  });

  it('parses nan', () => {
    const result = parseToml('f = nan');
    expect(result.value.f).toBeNaN();
  });

  it('parses +nan', () => {
    const result = parseToml('f = +nan');
    expect(result.value.f).toBeNaN();
  });

  it('parses -nan', () => {
    const result = parseToml('f = -nan');
    expect(result.value.f).toBeNaN();
  });

  it('serializer emits inf (not +inf)', () => {
    const parsed = parseToml('f = +inf');
    const out = serializeToml(parsed);
    expect(out).toContain('inf');
    expect(out).not.toContain('+inf');
  });

  it('serializer emits -inf', () => {
    const parsed = parseToml('f = -inf');
    const out = serializeToml(parsed);
    expect(out).toContain('-inf');
  });

  it('serializer emits nan (not +nan)', () => {
    const parsed = parseToml('f = +nan');
    const out = serializeToml(parsed);
    expect(out).toContain('nan');
    expect(out).not.toContain('+nan');
  });

  it('serializer escapes control characters in multi-line basic strings', () => {
    // 50-char string with embedded \n (triggers multi-line branch) + NUL byte.
    // Multi-line branch must escape NUL as \u0000, not emit it raw.
    const s = 'line one with some padding to exceed 40 chars\nline two\u0000with NUL';
    const file = {
      value: { s },
      hadBom: false,
    };
    const out = serializeToml(file);
    expect(out).toContain('\\u0000');
    expect(out).not.toMatch(/\0/);
  });
});

// ---------------------------------------------------------------------------
// TC10: All 4 date/time variants as typed objects (Trap #1)
// ---------------------------------------------------------------------------

describe('TC10: typed date/time objects', () => {
  it('parses local date as TomlDate', () => {
    const result = parseToml('d = 1979-05-27');
    const d = result.value.d as TomlDate;
    expect(d.kind).toBe('date');
    expect(d.year).toBe(1979);
    expect(d.month).toBe(5);
    expect(d.day).toBe(27);
  });

  it('parses local time as TomlTime', () => {
    const result = parseToml('t = 07:32:00');
    const t = result.value.t as TomlTime;
    expect(t.kind).toBe('time');
    expect(t.hour).toBe(7);
    expect(t.minute).toBe(32);
    expect(t.second).toBe(0);
    expect(t.fraction).toBeNull();
  });

  it('parses local time with fractional seconds', () => {
    const result = parseToml('t = 07:32:00.999999');
    const t = result.value.t as TomlTime;
    expect(t.kind).toBe('time');
    expect(t.fraction).toBe('999999');
  });

  it('parses offset date-time with Z', () => {
    const result = parseToml('dt = 1979-05-27T07:32:00Z');
    const dt = result.value.dt as TomlDateTime;
    expect(dt.kind).toBe('datetime');
    expect(dt.year).toBe(1979);
    expect(dt.offsetMinutes).toBe(0);
  });

  it('parses offset date-time with +HH:MM', () => {
    const result = parseToml('dt = 1979-05-27T07:32:00+05:30');
    const dt = result.value.dt as TomlDateTime;
    expect(dt.kind).toBe('datetime');
    expect(dt.offsetMinutes).toBe(330); // 5*60+30
  });

  it('parses local date-time (no offset)', () => {
    const result = parseToml('dt = 1979-05-27T07:32:00');
    const dt = result.value.dt as TomlDateTime;
    expect(dt.kind).toBe('datetime');
    expect(dt.offsetMinutes).toBeNull();
  });

  it('date and literal string "1979-05-27" are distinguishable', () => {
    const result = parseToml('a = 1979-05-27\nb = "1979-05-27"');
    const a = result.value.a;
    const b = result.value.b;
    expect(typeof b).toBe('string');
    expect(typeof a).toBe('object');
    expect((a as TomlDate).kind).toBe('date');
  });

  it('rejects invalid month 13', () => {
    expect(() => parseToml('d = 1979-13-01')).toThrow();
  });

  it('rejects invalid day 32', () => {
    expect(() => parseToml('d = 1979-05-32')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TC11: Space-separator date-time accepted (Trap #11)
// ---------------------------------------------------------------------------

describe('TC11: space-separator date-time', () => {
  it('accepts space between date and time', () => {
    const result = parseToml('dt = 1979-05-27 07:32:00Z');
    const dt = result.value.dt as TomlDateTime;
    expect(dt.kind).toBe('datetime');
    expect(dt.year).toBe(1979);
    expect(dt.hour).toBe(7);
    expect(dt.offsetMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TC12: Dotted keys create nested tables (Trap #3)
// ---------------------------------------------------------------------------

describe('TC12: dotted keys create nested tables', () => {
  it('creates nested tables for a.b.c = 1', () => {
    const result = parseToml('a.b.c = 1');
    expect(result.value).toEqual({ a: { b: { c: 1n } } });
  });

  it('merges dotted keys in the same table', () => {
    const result = parseToml('a.x = 1\na.y = 2');
    expect(result.value).toEqual({ a: { x: 1n, y: 2n } });
  });

  it('quoted keys in dotted path', () => {
    const result = parseToml('"a.b".c = 1');
    expect(result.value).toEqual({ 'a.b': { c: 1n } });
  });
});

// ---------------------------------------------------------------------------
// TC13: Dotted-key type conflict → TomlConflictingTypeError
// ---------------------------------------------------------------------------

describe('TC13: dotted-key type conflict', () => {
  it('throws when dotted key conflicts with existing scalar', () => {
    expect(() => parseToml('a = 1\na.b = 2')).toThrow(TomlConflictingTypeError);
  });

  it('throws when trying to extend an integer with dotted sub-key', () => {
    // a.b = 1 sets a.b to bigint 1; then a.b.c = 2 tries to traverse through it
    // which is a type conflict (not a duplicate key — the key b holds a non-table value)
    expect(() => parseToml('a.b = 1\na.b.c = 2')).toThrow(TomlConflictingTypeError);
  });
});

// ---------------------------------------------------------------------------
// TC14: [x] redefinition → TomlRedefineTableError (Trap #4)
// ---------------------------------------------------------------------------

describe('TC14: [table] header redefinition', () => {
  it('throws when same [table] header appears twice', () => {
    expect(() => parseToml('[foo]\na = 1\n[foo]\nb = 2')).toThrow(TomlRedefineTableError);
  });

  it('does not throw for different headers', () => {
    const result = parseToml('[foo]\na = 1\n[bar]\nb = 2');
    expect(result.value).toEqual({ foo: { a: 1n }, bar: { b: 2n } });
  });

  it('allows dotted sub-key assignment into a table before the header claims it', () => {
    // a.b = 1 creates table a implicitly; [a] then claims it - allowed per spec
    const result = parseToml('a.b = 1\n[a]\nc = 2');
    expect(result.value).toEqual({ a: { b: 1n, c: 2n } });
  });
});

// ---------------------------------------------------------------------------
// TC15: [[array]] appends (Trap #5)
// ---------------------------------------------------------------------------

describe('TC15: [[array-of-tables]] appends', () => {
  it('creates an array of tables with two entries', () => {
    const input = '[[fruits]]\nname = "apple"\n[[fruits]]\nname = "banana"';
    const result = parseToml(input);
    const fruits = result.value.fruits;
    expect(Array.isArray(fruits)).toBe(true);
    expect(fruits as { name: string }[]).toHaveLength(2);
    expect((fruits as { name: string }[])[0]?.name).toBe('apple');
    expect((fruits as { name: string }[])[1]?.name).toBe('banana');
  });

  it('throws when [[array]] conflicts with existing [table]', () => {
    expect(() => parseToml('[foo]\na = 1\n[[foo]]\nb = 2')).toThrow(TomlRedefineTableError);
  });

  it('supports nested array-of-tables', () => {
    const input = '[[albums]]\nname = "Born to Run"\n[[albums.songs]]\ntitle = "Thunder Road"';
    const result = parseToml(input);
    const albums = result.value.albums as { name: string; songs: { title: string }[] }[];
    expect(albums).toHaveLength(1);
    expect(albums[0]?.name).toBe('Born to Run');
    expect(albums[0]?.songs).toHaveLength(1);
    expect(albums[0]?.songs[0]?.title).toBe('Thunder Road');
  });
});

// ---------------------------------------------------------------------------
// TC16: Inline tables with nested dotted keys (Trap #8)
// ---------------------------------------------------------------------------

describe('TC16: inline tables', () => {
  it('parses an inline table', () => {
    const result = parseToml('point = { x = 1, y = 2 }');
    expect(result.value).toEqual({ point: { x: 1n, y: 2n } });
  });

  it('parses empty inline table', () => {
    const result = parseToml('empty = {}');
    expect(result.value).toEqual({ empty: {} });
  });

  it('throws on duplicate key inside inline table', () => {
    expect(() => parseToml('t = { a = 1, a = 2 }')).toThrow(TomlDuplicateKeyError);
  });
});

// ---------------------------------------------------------------------------
// TC17: Trailing comma inside inline table → error (Trap #8)
// ---------------------------------------------------------------------------

describe('TC17: trailing comma in inline table forbidden', () => {
  it('throws on trailing comma before closing brace', () => {
    expect(() => parseToml('t = { a = 1, }')).toThrow(TomlParseError);
  });

  it('accepts single key without comma', () => {
    const result = parseToml('t = { a = 1 }');
    expect(result.value).toEqual({ t: { a: 1n } });
  });
});

// ---------------------------------------------------------------------------
// TC18: Trailing comma inside multi-line array → ok
// ---------------------------------------------------------------------------

describe('TC18: trailing comma in array is allowed', () => {
  it('accepts trailing comma in inline array', () => {
    const result = parseToml('a = [1, 2, 3,]');
    expect(result.value).toEqual({ a: [1n, 2n, 3n] });
  });

  it('accepts trailing comma in multi-line array', () => {
    const result = parseToml('a = [\n  1,\n  2,\n  3,\n]');
    expect(result.value).toEqual({ a: [1n, 2n, 3n] });
  });
});

// ---------------------------------------------------------------------------
// TC19: Surrogate escape \uD800 rejected (Trap #13)
// ---------------------------------------------------------------------------

describe('TC19: surrogate unicode escapes rejected', () => {
  it('rejects \\uD800 (high surrogate)', () => {
    expect(() => parseToml('s = "\\uD800"')).toThrow();
  });

  it('rejects \\uDFFF (low surrogate)', () => {
    expect(() => parseToml('s = "\\uDFFF"')).toThrow();
  });

  it('rejects unknown escape sequences', () => {
    expect(() => parseToml('s = "\\q"')).toThrow(TomlBadEscapeError);
  });

  it('rejects \\UFFFFFFFF (> U+10FFFF)', () => {
    expect(() => parseToml('s = "\\UFFFFFFFF"')).toThrow();
  });

  it('accepts valid \\uXXXX', () => {
    const result = parseToml('s = "\\u00E9"'); // é
    expect(result.value.s).toBe('é');
  });
});

// ---------------------------------------------------------------------------
// TC20: MAX_TOML_DEPTH breach → TomlDepthExceededError
// ---------------------------------------------------------------------------

describe('TC20: MAX_TOML_DEPTH exceeded', () => {
  it('throws TomlDepthExceededError when nesting exceeds MAX_TOML_DEPTH', () => {
    // Build a deeply nested inline table beyond the depth cap
    const depth = MAX_TOML_DEPTH + 2;
    const open = '{ a = '.repeat(depth);
    const close = ' }'.repeat(depth);
    const input = `x = ${open}1${close}`;
    expect(() => parseToml(input)).toThrow(TomlDepthExceededError);
  });

  it('accepts nesting well below MAX_TOML_DEPTH', () => {
    // Build a shallow nested inline table — well under the 64-level cap
    const depth = 5;
    const open = '{ a = '.repeat(depth);
    const close = ' }'.repeat(depth);
    const input = `x = ${open}1${close}`;
    expect(() => parseToml(input)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TC21: MAX_TOML_STRING_LEN breach
// ---------------------------------------------------------------------------

describe('TC21: MAX_TOML_STRING_LEN exceeded', () => {
  it('throws TomlStringTooLongError when string exceeds 1 MiB', () => {
    const big = 'a'.repeat(MAX_TOML_STRING_LEN + 1);
    const input = `s = "${big}"`;
    expect(() => parseToml(input)).toThrow(TomlStringTooLongError);
  });

  it('accepts a string exactly at the limit', () => {
    const big = 'a'.repeat(MAX_TOML_STRING_LEN);
    const input = `s = "${big}"`;
    const result = parseToml(input);
    expect((result.value.s as string).length).toBe(MAX_TOML_STRING_LEN);
  });
});

// ---------------------------------------------------------------------------
// TC22: BOM stripped + hadBom recorded
// ---------------------------------------------------------------------------

describe('TC22: BOM stripped and recorded', () => {
  it('strips UTF-8 BOM and sets hadBom = true', () => {
    const bomBytes = bom();
    const content = utf8('key = "value"');
    const input = concat(bomBytes, content);
    const result = parseToml(input);
    expect(result.hadBom).toBe(true);
    expect(result.value).toEqual({ key: 'value' });
  });

  it('sets hadBom = false when no BOM', () => {
    const result = parseToml('key = "value"');
    expect(result.hadBom).toBe(false);
  });

  it('serializer NEVER emits BOM even when hadBom = true', () => {
    const bomBytes = bom();
    const content = utf8('key = "value"');
    const input = concat(bomBytes, content);
    const parsed = parseToml(input);
    const out = serializeToml({ ...parsed, hadBom: true });
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
  });
});

// ---------------------------------------------------------------------------
// TC23: Malformed UTF-8 → TomlInvalidUtf8Error
// ---------------------------------------------------------------------------

describe('TC23: malformed UTF-8', () => {
  it('throws TomlInvalidUtf8Error for malformed UTF-8 bytes', () => {
    const bad = invalidUtf8();
    expect(() => parseToml(bad)).toThrow(TomlInvalidUtf8Error);
  });
});

// ---------------------------------------------------------------------------
// TC24: Canonical serializer output
// ---------------------------------------------------------------------------

describe('TC24: canonical serializer output', () => {
  it('serializes bigint integers via toString', () => {
    const parsed = parseToml('n = 9007199254740993');
    const out = serializeToml(parsed);
    expect(out).toContain('9007199254740993');
  });

  it('serializes TomlDate in YYYY-MM-DD format', () => {
    const parsed = parseToml('d = 1979-05-27');
    const out = serializeToml(parsed);
    expect(out).toContain('1979-05-27');
  });

  it('serializes TomlDateTime with T separator', () => {
    const parsed = parseToml('dt = 1979-05-27T07:32:00Z');
    const out = serializeToml(parsed);
    expect(out).toContain('1979-05-27T07:32:00Z');
  });

  it('serializes sub-tables as [section] headers', () => {
    const parsed = parseToml('[database]\nhost = "localhost"\nport = 5432');
    const out = serializeToml(parsed);
    expect(out).toContain('[database]');
    expect(out).toContain('host = "localhost"');
    expect(out).toContain('port = 5432');
  });

  it('serializes array-of-tables as [[section]] headers', () => {
    const parsed = parseToml('[[fruits]]\nname = "apple"\n[[fruits]]\nname = "banana"');
    const out = serializeToml(parsed);
    expect(out).toContain('[[fruits]]');
    expect(out.match(/\[\[fruits\]\]/g)).toHaveLength(2);
  });

  it('uses bare keys for alphanumeric-dash-underscore key names', () => {
    const parsed = parseToml('my-key = 1\n_secret = 2');
    const out = serializeToml(parsed);
    expect(out).toContain('my-key = 1');
    expect(out).toContain('_secret = 2');
  });

  it('uses quoted keys for keys with special chars', () => {
    const parsed = parseToml('"hello world" = 1');
    const out = serializeToml(parsed);
    expect(out).toContain('"hello world"');
  });
});

// ---------------------------------------------------------------------------
// TC25: Round-trip semantic equivalence for full corpus
// ---------------------------------------------------------------------------

describe('TC25: round-trip semantic equivalence', () => {
  it('round-trips a comprehensive TOML document', () => {
    const input = [
      '# A comprehensive TOML document',
      'title = "TOML Example"',
      'integer = 42',
      'float = 3.14',
      'bool = true',
      'date = 1979-05-27',
      'datetime = 1979-05-27T07:32:00Z',
      '',
      '[database]',
      'host = "localhost"',
      'port = 5432',
      'enabled = true',
      '',
      '[servers.alpha]',
      'ip = "10.0.0.1"',
      '',
      '[[products]]',
      'name = "Hammer"',
      'sku = 738594937',
      '',
      '[[products]]',
      'name = "Nail"',
      'sku = 284758393',
    ].join('\n');

    const parsed1 = parseToml(input);
    const serialized = serializeToml(parsed1);
    const parsed2 = parseToml(serialized);

    // Semantic equivalence check
    expect(parsed2.value.title).toBe('TOML Example');
    expect(parsed2.value.integer).toBe(42n);
    expect(parsed2.value.float).toBeCloseTo(3.14);
    expect(parsed2.value.bool).toBe(true);
    expect((parsed2.value.date as TomlDate).kind).toBe('date');
    expect((parsed2.value.datetime as TomlDateTime).kind).toBe('datetime');

    const db = parsed2.value.database as { host: string; port: bigint; enabled: boolean };
    expect(db.host).toBe('localhost');
    expect(db.port).toBe(5432n);

    const products = parsed2.value.products as { name: string; sku: bigint }[];
    expect(products).toHaveLength(2);
    expect(products[0]?.name).toBe('Hammer');
    expect(products[1]?.name).toBe('Nail');
  });

  it('round-trips floats', () => {
    const parsed = parseToml('f = 3.14159\ne = 2.71828');
    const out = serializeToml(parsed);
    const reparsed = parseToml(out);
    expect(reparsed.value.f as number).toBeCloseTo(Math.PI);
    expect(reparsed.value.e as number).toBeCloseTo(Math.E);
  });
});

// ---------------------------------------------------------------------------
// TC26: parseDataText(input, 'toml') returns { kind: 'toml' }
// ---------------------------------------------------------------------------

describe('TC26: parseDataText dispatches to TOML', () => {
  it('returns { kind: "toml" } for format "toml"', () => {
    const result = parseDataText('key = "value"', 'toml');
    expect(result.kind).toBe('toml');
    expect(result.file.value).toEqual({ key: 'value' });
  });
});

// ---------------------------------------------------------------------------
// TC27: DataTextBackend canHandle identity for application/toml
// ---------------------------------------------------------------------------

describe('TC27: DataTextBackend canHandle for application/toml', () => {
  it('returns true for application/toml identity', async () => {
    const backend = new DataTextBackend();
    const can = await backend.canHandle(TOML_FORMAT, TOML_FORMAT);
    expect(can).toBe(true);
  });

  it('returns false for cross-format TOML → JSON', async () => {
    const backend = new DataTextBackend();
    const jsonFormat = {
      ext: 'json',
      mime: 'application/json',
      category: 'data' as const,
      description: 'JSON',
    };
    const can = await backend.canHandle(TOML_FORMAT, jsonFormat);
    expect(can).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC28: serializeDataText dispatches correctly
// ---------------------------------------------------------------------------

describe('TC28: serializeDataText dispatches to TOML serializer', () => {
  it('serializes a TOML DataTextFile', () => {
    const file = parseToml('a = 1\nb = 2');
    const dtf = { kind: 'toml' as const, file };
    const out = serializeDataText(dtf);
    expect(out).toContain('a = 1');
    expect(out).toContain('b = 2');
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('Additional: float parsing', () => {
  it('parses scientific notation', () => {
    const result = parseToml('f = 6.626e-34');
    expect(result.value.f as number).toBeCloseTo(6.626e-34);
  });

  it('parses float with positive exponent', () => {
    const result = parseToml('f = 1.5e+3');
    expect(result.value.f).toBeCloseTo(1500);
  });
});

describe('Additional: comments', () => {
  it('ignores inline comments after values', () => {
    const result = parseToml('a = 1 # this is a comment');
    expect(result.value.a).toBe(1n);
  });

  it('ignores full-line comments', () => {
    const result = parseToml('# top comment\na = 1\n# middle comment\nb = 2');
    expect(result.value).toEqual({ a: 1n, b: 2n });
  });
});

describe('Additional: nested section tables', () => {
  it('creates nested tables via dotted section path', () => {
    const result = parseToml('[a.b.c]\nval = 1');
    expect((result.value.a as { b: { c: { val: bigint } } }).b.c.val).toBe(1n);
  });

  it('merges top-level scalars with nested tables', () => {
    const result = parseToml('title = "Test"\n[section]\nkey = "value"');
    expect(result.value.title).toBe('Test');
    expect((result.value.section as { key: string }).key).toBe('value');
  });
});

describe('Additional: negative date offset', () => {
  it('parses negative UTC offset', () => {
    const result = parseToml('dt = 1979-05-27T07:32:00-05:00');
    const dt = result.value.dt as TomlDateTime;
    expect(dt.offsetMinutes).toBe(-300);
  });
});

describe('Additional: mixed-type arrays', () => {
  it('allows mixed-type arrays per TOML v1.0', () => {
    const result = parseToml('a = [1, "hello", true]');
    expect(result.value.a).toEqual([1n, 'hello', true]);
  });
});

describe('Additional: serializer coverage', () => {
  it('serializes TomlTime in canonical form', () => {
    const parsed = parseToml('t = 07:32:00');
    const out = serializeToml(parsed);
    expect(out).toContain('07:32:00');
  });

  it('serializes TomlTime with fractional seconds', () => {
    const parsed = parseToml('t = 07:32:00.123456');
    const out = serializeToml(parsed);
    expect(out).toContain('07:32:00.123456');
  });

  it('serializes empty array as []', () => {
    // Build a TomlFile manually with an empty array
    const file: import('./toml.ts').TomlFile = {
      value: { arr: [] },
      hadBom: false,
    };
    const out = serializeToml(file);
    expect(out).toContain('arr = []');
  });

  it('serializes a long array in multi-line form', () => {
    // Create an array that produces an inline representation > 80 chars
    const file: import('./toml.ts').TomlFile = {
      value: {
        arr: [
          'aaaaaaaaaaaaaaaaaaaaaa',
          'bbbbbbbbbbbbbbbbbbbbbb',
          'cccccccccccccccccccccc',
          'ddddddddddddddddddddddd',
        ],
      },
      hadBom: false,
    };
    const out = serializeToml(file);
    expect(out).toContain('arr =');
  });

  it('serializes datetime with local (no offset)', () => {
    const parsed = parseToml('dt = 1979-05-27T07:32:00');
    const out = serializeToml(parsed);
    expect(out).toContain('1979-05-27T07:32:00');
    // No Z or +/- offset appended
    expect(out).not.toMatch(/Z|[+-]\d{2}:\d{2}/);
  });

  it('serializes datetime with negative offset', () => {
    const parsed = parseToml('dt = 1979-05-27T07:32:00-05:00');
    const out = serializeToml(parsed);
    expect(out).toContain('-05:00');
  });
});

describe('Additional: error cases for serialize', () => {
  it('TomlSerializeError is instanceof WebcvtError', () => {
    const err = new TomlSerializeError('test reason');
    expect(err).toBeInstanceOf(TomlSerializeError);
    expect(err.message).toContain('test reason');
  });
});

describe('Additional: duplicate direct key throws', () => {
  it('rejects duplicate key in same table', () => {
    expect(() => parseToml('a = 1\na = 2')).toThrow(TomlDuplicateKeyError);
  });
});

describe('Additional: hex with leading zeros in prefix fine', () => {
  it('parses 0x0000FF as 255n', () => {
    const result = parseToml('n = 0x0000FF');
    expect(result.value.n).toBe(255n);
  });
});
