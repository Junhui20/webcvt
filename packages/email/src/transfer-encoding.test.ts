import { describe, expect, it } from 'vitest';
import { EmailUnsupportedTransferEncodingError } from './errors.ts';
import {
  decodeBase64,
  decodeBytesWithCharset,
  decodeQEncodedWord,
  decodeQuotedPrintable,
  decodeTransferEncoding,
  encodeBase64,
} from './transfer-encoding.ts';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b);

describe('base64', () => {
  it('decodes a known vector', () => {
    expect(text(decodeBase64('SGVsbG8='))).toBe('Hello');
  });

  it('ignores embedded whitespace/newlines', () => {
    expect(text(decodeBase64('SGVs\r\n bG8='))).toBe('Hello');
  });

  it('round-trips arbitrary bytes through encode/decode', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('encodes with 1-byte and 2-byte tails (padding)', () => {
    expect(encodeBase64(utf8('a'))).toBe('YQ==');
    expect(encodeBase64(utf8('ab'))).toBe('YWI=');
    expect(encodeBase64(utf8('abc'))).toBe('YWJj');
    expect(encodeBase64(new Uint8Array(0))).toBe('');
  });
});

describe('quoted-printable', () => {
  it('decodes =XX hex escapes', () => {
    expect(text(decodeQuotedPrintable('Caf=C3=A9'))).toBe('Café');
  });

  it('honours =CRLF and =LF soft breaks', () => {
    expect(text(decodeQuotedPrintable('abc=\r\ndef'))).toBe('abcdef');
    expect(text(decodeQuotedPrintable('abc=\ndef'))).toBe('abcdef');
  });

  it('emits a stray = literally on a malformed escape', () => {
    expect(text(decodeQuotedPrintable('a=ZZb'))).toBe('a=ZZb');
  });
});

describe('Q encoded-word payload', () => {
  it('maps underscore to space and decodes =XX', () => {
    expect(text(decodeQEncodedWord('A_=C3=A9'))).toBe('A é');
  });

  it('emits a stray = literally', () => {
    expect(text(decodeQEncodedWord('a=Zb'))).toBe('a=Zb');
  });
});

describe('decodeBytesWithCharset', () => {
  it('decodes utf-8 (default and explicit)', () => {
    expect(decodeBytesWithCharset(utf8('Café'), 'utf-8')).toBe('Café');
    expect(decodeBytesWithCharset(utf8('Café'), '')).toBe('Café');
  });

  it('decodes latin1 family with a 1:1 mapping', () => {
    expect(decodeBytesWithCharset(new Uint8Array([0xe9]), 'iso-8859-1')).toBe('é');
    expect(decodeBytesWithCharset(new Uint8Array([0xe9]), 'us-ascii')).toBe('é');
  });

  it('strips an RFC 2231 *language suffix on the charset label', () => {
    expect(decodeBytesWithCharset(utf8('hi'), 'utf-8*en')).toBe('hi');
  });

  it('falls back to latin1 for an unknown charset label', () => {
    expect(decodeBytesWithCharset(new Uint8Array([0x41]), 'x-not-a-charset')).toBe('A');
  });
});

describe('decodeTransferEncoding', () => {
  const body = utf8('hello');

  it('is identity for 7bit/8bit/binary/empty', () => {
    expect(text(decodeTransferEncoding(body, ''))).toBe('hello');
    expect(text(decodeTransferEncoding(body, '7bit'))).toBe('hello');
    expect(text(decodeTransferEncoding(body, '8bit'))).toBe('hello');
    expect(text(decodeTransferEncoding(body, 'binary'))).toBe('hello');
  });

  it('decodes base64 and quoted-printable bodies', () => {
    expect(text(decodeTransferEncoding(utf8('aGVsbG8='), 'base64'))).toBe('hello');
    expect(text(decodeTransferEncoding(utf8('h=65llo'), 'quoted-printable'))).toBe('hello');
  });

  it('throws on an unsupported transfer encoding', () => {
    expect(() => decodeTransferEncoding(body, 'x-uuencode')).toThrow(
      EmailUnsupportedTransferEncodingError,
    );
  });
});
