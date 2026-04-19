import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { InputTooLargeError, InputTooManyCharsError } from './errors.ts';
import { decodeInput } from './utf8.ts';

function makeErr(cause: unknown): Error {
  return new Error(`utf8 error: ${String(cause)}`);
}

describe('decodeInput', () => {
  it('decodes a plain UTF-8 string input', () => {
    const result = decodeInput('hello world', 'TEST', makeErr);
    expect(result.text).toBe('hello world');
    expect(result.hadBom).toBe(false);
  });

  it('passes string input through without re-decoding', () => {
    const result = decodeInput('{"a":1}', 'JSON', makeErr);
    expect(result.text).toBe('{"a":1}');
  });

  it('decodes Uint8Array with valid UTF-8', () => {
    const bytes = utf8('hello');
    const result = decodeInput(bytes, 'TEST', makeErr);
    expect(result.text).toBe('hello');
  });

  it('strips BOM from Uint8Array and sets hadBom=true', () => {
    const bytes = concat(bom(), utf8('hello'));
    const result = decodeInput(bytes, 'TEST', makeErr);
    expect(result.hadBom).toBe(true);
    expect(result.text).toBe('hello');
  });

  it('strips BOM from string input and sets hadBom=true', () => {
    const result = decodeInput('\uFEFFhello', 'TEST', makeErr);
    expect(result.hadBom).toBe(true);
    expect(result.text).toBe('hello');
  });

  it('throws InputTooLargeError when Uint8Array exceeds MAX_INPUT_BYTES', () => {
    const hugeArray = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(() => decodeInput(hugeArray, 'TEST', makeErr)).toThrow(InputTooLargeError);
  });

  it('throws InputTooManyCharsError when decoded string exceeds MAX_INPUT_CHARS', () => {
    // Create a string of exactly MAX_INPUT_CHARS + 1 characters
    const longString = 'a'.repeat(10_485_761);
    expect(() => decodeInput(longString, 'TEST', makeErr)).toThrow(InputTooManyCharsError);
  });

  it('calls makeUtf8Error factory on malformed UTF-8 bytes', () => {
    const badBytes = concat(utf8('prefix'), invalidUtf8());
    let factoryCalled = false;
    const factory = (cause: unknown): Error => {
      factoryCalled = true;
      return new Error(`bad: ${String(cause)}`);
    };
    expect(() => decodeInput(badBytes, 'TEST', factory)).toThrow();
    expect(factoryCalled).toBe(true);
  });

  it('hadBom is false when no BOM is present', () => {
    const result = decodeInput(utf8('no bom here'), 'TEST', makeErr);
    expect(result.hadBom).toBe(false);
  });
});
