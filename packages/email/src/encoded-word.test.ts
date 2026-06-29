import { describe, expect, it } from 'vitest';
import { decodeEncodedWords } from './encoded-word.ts';
import { encodeBase64 } from './transfer-encoding.ts';

const bWord = (charset: string, s: string): string =>
  `=?${charset}?B?${encodeBase64(new TextEncoder().encode(s))}?=`;

describe('decodeEncodedWords', () => {
  it('passes through plain text unchanged', () => {
    expect(decodeEncodedWords('Just a plain subject')).toBe('Just a plain subject');
  });

  it('decodes a base64 (B) encoded-word with UTF-8', () => {
    expect(decodeEncodedWords(bWord('UTF-8', 'Héllo wörld'))).toBe('Héllo wörld');
  });

  it('decodes a quoted-printable (Q) encoded-word', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Caf=C3=A9?=')).toBe('Café');
  });

  it('treats underscore as space in Q encoding', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?a_b?=')).toBe('a b');
  });

  it('drops whitespace between two adjacent encoded-words', () => {
    const input = `${bWord('UTF-8', 'foo')} ${bWord('UTF-8', 'bar')}`;
    expect(decodeEncodedWords(input)).toBe('foobar');
  });

  it('keeps surrounding plain text and whitespace', () => {
    const input = `Re: ${bWord('UTF-8', 'café')} (urgent)`;
    expect(decodeEncodedWords(input)).toBe('Re: café (urgent)');
  });

  it('decodes a latin1 charset label', () => {
    expect(decodeEncodedWords('=?ISO-8859-1?Q?=E9t=E9?=')).toBe('été');
  });

  it('leaves a malformed pseudo encoded-word as literal text', () => {
    expect(decodeEncodedWords('=?broken without close')).toBe('=?broken without close');
    expect(decodeEncodedWords('=?utf-8?Z?zz?=')).toBe('=?utf-8?Z?zz?=');
    expect(decodeEncodedWords('=?utf-8?Q?has space?=')).toBe('=?utf-8?Q?has space?=');
  });

  it('leaves an empty charset encoded-word as literal', () => {
    expect(decodeEncodedWords('=??Q?x?=')).toBe('=??Q?x?=');
  });
});
