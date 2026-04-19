/**
 * Tests for env.ts — covers design-note test cases:
 * TC19: parseEnv tolerates 'export FOO=bar' prefix
 * TC20: parseEnv expands \n inside double-quoted value
 * TC21: parseEnv strips '# comment' outside quotes, preserves it inside
 * TC22: parseEnv rejects raw multi-line value with EnvSyntaxError
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { parseEnv, serializeEnv } from './env.ts';
import { EnvBadEscapeError, EnvInvalidUtf8Error, EnvSyntaxError } from './errors.ts';

describe('parseEnv', () => {
  // TC19
  it("tolerates 'export FOO=bar' prefix", () => {
    const result = parseEnv('export FOO=bar\n');
    expect(result.data.FOO).toBe('bar');
    expect(result.keys).toContain('FOO');
  });

  it('tolerates export with multiple spaces', () => {
    const result = parseEnv('export  FOO=bar\n');
    expect(result.data.FOO).toBe('bar');
  });

  // TC20
  it('expands \\n inside double-quoted value', () => {
    const result = parseEnv('KEY="line1\\nline2"\n');
    expect(result.data.KEY).toBe('line1\nline2');
  });

  it('expands \\t inside double-quoted value', () => {
    const result = parseEnv('KEY="col1\\tcol2"\n');
    expect(result.data.KEY).toBe('col1\tcol2');
  });

  it('expands \\\\ inside double-quoted value', () => {
    const result = parseEnv('KEY="back\\\\slash"\n');
    expect(result.data.KEY).toBe('back\\slash');
  });

  it('expands \\" inside double-quoted value', () => {
    const result = parseEnv('KEY="say \\"hello\\""\n');
    expect(result.data.KEY).toBe('say "hello"');
  });

  it('rejects unrecognized escape with EnvBadEscapeError', () => {
    expect(() => parseEnv('KEY="val\\r"\n')).toThrow(EnvBadEscapeError);
  });

  // TC21
  it("strips '# comment' outside quotes in unquoted value", () => {
    const result = parseEnv('FOO=bar # comment\n');
    expect(result.data.FOO).toBe('bar');
  });

  it('preserves # inside single-quoted value', () => {
    const result = parseEnv("FOO='bar # not a comment'\n");
    expect(result.data.FOO).toBe('bar # not a comment');
  });

  it('preserves # inside double-quoted value', () => {
    const result = parseEnv('FOO="bar # not a comment"\n');
    expect(result.data.FOO).toBe('bar # not a comment');
  });

  it('FOO=foo#bar yields foo (# with no space is still comment)', () => {
    const result = parseEnv('FOO=foo#bar\n');
    expect(result.data.FOO).toBe('foo');
  });

  // TC22
  it('rejects raw multi-line value (line-split parser catches missing =)', () => {
    // A value that would only exist if literal newlines were allowed
    // Since we split on newlines, the second line is treated as a new line
    // and fails the KEY=value pattern
    const input = 'KEY=line1\ncontinuation line without equals\n';
    expect(() => parseEnv(input)).toThrow(EnvSyntaxError);
  });

  it('parses empty value KEY=', () => {
    const result = parseEnv('KEY=\n');
    expect(result.data.KEY).toBe('');
  });

  it('parses empty string single-quoted', () => {
    const result = parseEnv("KEY=''\n");
    expect(result.data.KEY).toBe('');
  });

  it('parses empty string double-quoted', () => {
    const result = parseEnv('KEY=""\n');
    expect(result.data.KEY).toBe('');
  });

  it('parses single-quoted value with no escapes', () => {
    const result = parseEnv("KEY='hello world'\n");
    expect(result.data.KEY).toBe('hello world');
  });

  it('single-quoted value treats backslash as literal', () => {
    const result = parseEnv("KEY='back\\slash'\n");
    expect(result.data.KEY).toBe('back\\slash');
  });

  it('skips blank lines', () => {
    const result = parseEnv('\n\nFOO=bar\n\n');
    expect(result.data.FOO).toBe('bar');
  });

  it('skips # comment lines', () => {
    const result = parseEnv('# full line comment\nFOO=bar\n');
    expect(result.keys).toEqual(['FOO']);
    expect(result.data.FOO).toBe('bar');
  });

  it('preserves insertion order of keys', () => {
    const result = parseEnv('Z=1\nA=2\nM=3\n');
    expect(result.keys).toEqual(['Z', 'A', 'M']);
  });

  it('emits duplicate-key warning, last-wins', () => {
    const result = parseEnv('FOO=first\nFOO=second\n');
    expect(result.data.FOO).toBe('second');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('duplicate key');
  });

  it('handles Windows CRLF line endings', () => {
    const result = parseEnv('FOO=bar\r\nBAZ=qux\r\n');
    expect(result.data.FOO).toBe('bar');
    expect(result.data.BAZ).toBe('qux');
  });

  it('throws EnvSyntaxError for invalid key pattern', () => {
    expect(() => parseEnv('123KEY=val\n')).toThrow(EnvSyntaxError);
  });

  it('throws EnvSyntaxError for unterminated double-quoted value', () => {
    expect(() => parseEnv('KEY="unterminated\n')).toThrow(EnvSyntaxError);
  });

  it('throws EnvSyntaxError for unterminated single-quoted value', () => {
    expect(() => parseEnv("KEY='unterminated\n")).toThrow(EnvSyntaxError);
  });

  it('throws EnvSyntaxError for garbage after closing single quote', () => {
    expect(() => parseEnv("KEY='val'garbage\n")).toThrow(EnvSyntaxError);
  });

  it('throws EnvInvalidUtf8Error on malformed UTF-8 bytes', () => {
    const bad = concat(utf8('KEY='), invalidUtf8());
    expect(() => parseEnv(bad)).toThrow(EnvInvalidUtf8Error);
  });

  it('strips UTF-8 BOM', () => {
    const bytes = concat(bom(), utf8('FOO=bar\n'));
    const result = parseEnv(bytes);
    expect(result.data.FOO).toBe('bar');
  });

  it('trims trailing whitespace from unquoted values', () => {
    const result = parseEnv('FOO=bar   \n');
    expect(result.data.FOO).toBe('bar');
  });

  it('handles value with = sign', () => {
    const result = parseEnv('KEY=a=b=c\n');
    expect(result.data.KEY).toBe('a=b=c');
  });

  it('allows comment after double-quoted value', () => {
    const result = parseEnv('KEY="val" # comment\n');
    expect(result.data.KEY).toBe('val');
  });

  it('allows comment after single-quoted value', () => {
    const result = parseEnv("KEY='val' # comment\n");
    expect(result.data.KEY).toBe('val');
  });
});

describe('serializeEnv', () => {
  it('emits KEY= for empty values', () => {
    const file = parseEnv('KEY=\n');
    const out = serializeEnv(file);
    expect(out).toBe('KEY=\n');
  });

  it('emits safe values unquoted', () => {
    const file = parseEnv('FOO=simple\n');
    const out = serializeEnv(file);
    expect(out).toBe('FOO=simple\n');
  });

  it('double-quotes values with special characters', () => {
    const file = { keys: ['K'], data: { K: 'a b c' }, warnings: [] };
    const out = serializeEnv(file);
    expect(out).toBe('K="a b c"\n');
  });

  it('escapes backslash, quote, newline, tab in double-quoted values', () => {
    const file = { keys: ['K'], data: { K: 'a\nb\tc\\d"e' }, warnings: [] };
    const out = serializeEnv(file);
    expect(out).toBe('K="a\\nb\\tc\\\\d\\"e"\n');
  });

  it('round-trips a simple ENV file', () => {
    const input = 'FOO=bar\nBAZ=qux\n';
    const parsed = parseEnv(input);
    const out = serializeEnv(parsed);
    const reparsed = parseEnv(out);
    expect(reparsed.data.FOO).toBe('bar');
    expect(reparsed.data.BAZ).toBe('qux');
  });

  it('preserves key order on serialize', () => {
    const input = 'Z=1\nA=2\nM=3\n';
    const parsed = parseEnv(input);
    const out = serializeEnv(parsed);
    const lines = out.split('\n').filter(Boolean);
    expect(lines[0]).toMatch(/^Z=/);
    expect(lines[1]).toMatch(/^A=/);
    expect(lines[2]).toMatch(/^M=/);
  });

  it('emits LF line terminators', () => {
    const parsed = parseEnv('FOO=bar\n');
    const out = serializeEnv(parsed);
    expect(out.includes('\r')).toBe(false);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('round-trips newline inside double-quoted value', () => {
    const input = 'KEY="line1\\nline2"\n';
    const parsed = parseEnv(input);
    expect(parsed.data.KEY).toBe('line1\nline2');
    const out = serializeEnv(parsed);
    const reparsed = parseEnv(out);
    expect(reparsed.data.KEY).toBe('line1\nline2');
  });

  // Sec-H-1 regression: malicious __proto__ key MUST NOT pollute Object.prototype.
  it('Sec-H-1: rejects prototype pollution via __proto__ key', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const parsed = parseEnv('__proto__=evil\n');
    expect(parsed.data.__proto__).toBe('evil');
    // After parse: a fresh empty object has NOT inherited a 'polluted' property.
    expect(({} as Record<string, unknown>).polluted).toBe(before);
    // The data store itself uses Object.create(null) — no prototype.
    expect(Object.getPrototypeOf(parsed.data)).toBeNull();
  });

  it('Sec-H-1: rejects prototype pollution via constructor key', () => {
    const parsed = parseEnv('constructor=hijack\n');
    expect(parsed.data.constructor).toBe('hijack');
    expect(Object.getPrototypeOf(parsed.data)).toBeNull();
  });
});
