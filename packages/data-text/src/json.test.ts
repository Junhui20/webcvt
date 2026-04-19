/**
 * Tests for json.ts — covers all design-note test cases for JSON:
 * TC1: parseJson decodes a 3-key object
 * TC2: parseJson rejects 257-deep nested array with JsonDepthExceededError
 * TC3: parseJson strips UTF-8 BOM and records hadBom=true
 * TC4: parseJson rejects malformed UTF-8 with JsonInvalidUtf8Error
 * TC5: parseJson rejects input over MAX_INPUT_BYTES
 * TC6: serializeJson round-trip preserves insertion-ordered string keys
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import {
  InputTooLargeError,
  JsonDepthExceededError,
  JsonInvalidUtf8Error,
  JsonParseError,
} from './errors.ts';
import { parseJson, serializeJson } from './json.ts';

describe('parseJson', () => {
  // TC1
  it('decodes a 3-key object and recovers value tree', () => {
    const result = parseJson('{"a":1,"b":"hello","c":true}');
    expect(result.hadBom).toBe(false);
    expect(result.value).toEqual({ a: 1, b: 'hello', c: true });
  });

  it('handles nested objects and arrays', () => {
    const result = parseJson('{"x":[1,2,{"y":null}]}');
    expect(result.value).toEqual({ x: [1, 2, { y: null }] });
  });

  it('parses a JSON array as root', () => {
    const result = parseJson('[1,"two",false,null]');
    expect(result.value).toEqual([1, 'two', false, null]);
  });

  it('parses a JSON string as root', () => {
    const result = parseJson('"hello world"');
    expect(result.value).toBe('hello world');
  });

  it('parses JSON numbers', () => {
    const result = parseJson('42');
    expect(result.value).toBe(42);
  });

  it('parses null', () => {
    const result = parseJson('null');
    expect(result.value).toBeNull();
  });

  // TC2: depth pre-scan BEFORE JSON.parse
  it('rejects 257-deep nested array with JsonDepthExceededError', () => {
    const deep = '['.repeat(257) + ']'.repeat(257);
    expect(() => parseJson(deep)).toThrow(JsonDepthExceededError);
  });

  it('accepts exactly 256-deep nested array', () => {
    const deep = '['.repeat(256) + ']'.repeat(256);
    // should not throw
    expect(() => parseJson(deep)).not.toThrow();
  });

  it('depth pre-scan does not count brackets inside strings', () => {
    // The value is a string containing brackets — depth is 1, not 257
    const tricky = `{"key":"${'['.repeat(255)}"}`;
    expect(() => parseJson(tricky)).not.toThrow();
  });

  it('depth pre-scan handles escaped quotes inside strings', () => {
    const json = '{"k":"a\\"b"}';
    const result = parseJson(json);
    expect((result.value as Record<string, string>).k).toBe('a"b');
  });

  // TC3
  it('strips UTF-8 BOM and records hadBom=true', () => {
    const bytes = concat(bom(), utf8('{"a":1}'));
    const result = parseJson(bytes);
    expect(result.hadBom).toBe(true);
    expect(result.value).toEqual({ a: 1 });
  });

  it('strips UTF-8 BOM from string input', () => {
    const result = parseJson('\uFEFF{"a":1}');
    expect(result.hadBom).toBe(true);
    expect(result.value).toEqual({ a: 1 });
  });

  // TC4
  it('rejects malformed UTF-8 with JsonInvalidUtf8Error', () => {
    const bytes = concat(utf8('{"a":'), invalidUtf8(), utf8('}'));
    expect(() => parseJson(bytes)).toThrow(JsonInvalidUtf8Error);
  });

  // TC5
  it('rejects input over MAX_INPUT_BYTES (10 MiB)', () => {
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(() => parseJson(huge)).toThrow(InputTooLargeError);
  });

  it('wraps SyntaxError in JsonParseError', () => {
    expect(() => parseJson('{invalid}')).toThrow(JsonParseError);
  });

  it('wraps SyntaxError in JsonParseError for truncated input', () => {
    expect(() => parseJson('{"a":')).toThrow(JsonParseError);
  });
});

describe('serializeJson', () => {
  // TC6
  it('round-trip preserves insertion-ordered string keys', () => {
    const original = '{"z":1,"a":2,"m":3}';
    const parsed = parseJson(original);
    const serialized = serializeJson(parsed);
    expect(serialized).toBe('{"z":1,"a":2,"m":3}');
  });

  it('round-trips an object through parse → serialize', () => {
    const obj = { name: 'Alice', age: 30, active: true };
    const file = parseJson(JSON.stringify(obj));
    const out = serializeJson(file);
    expect(JSON.parse(out)).toEqual(obj);
  });

  it('preserves hadBom on serialize (prepends BOM)', () => {
    const bytes = concat(bom(), utf8('"hello"'));
    const file = parseJson(bytes);
    expect(file.hadBom).toBe(true);
    const out = serializeJson(file);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('"hello"');
  });

  it('does not prepend BOM when hadBom is false', () => {
    const file = parseJson('"hello"');
    const out = serializeJson(file);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('respects indent option', () => {
    const file = parseJson('{"a":1}');
    const out = serializeJson(file, { indent: 2 });
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it('emits compact JSON by default (indent=0)', () => {
    const file = parseJson('{"a":1,"b":2}');
    const out = serializeJson(file);
    expect(out).toBe('{"a":1,"b":2}');
  });

  it('serializes array', () => {
    const file = parseJson('[1,2,3]');
    expect(serializeJson(file)).toBe('[1,2,3]');
  });

  it('serializes null', () => {
    const file = parseJson('null');
    expect(serializeJson(file)).toBe('null');
  });
});

describe('JSON depth pre-scan confirmation', () => {
  it('pre-scan runs before JSON.parse: depth bomb is caught without stack overflow', () => {
    // 300 levels deep — would overflow V8 if JSON.parse were called first
    const bomb = '['.repeat(300) + ']'.repeat(300);
    let threw = false;
    let errorType = '';
    try {
      parseJson(bomb);
    } catch (err) {
      threw = true;
      errorType = (err as Error).constructor.name;
    }
    expect(threw).toBe(true);
    expect(errorType).toBe('JsonDepthExceededError');
  });
});
