import { describe, expect, it } from 'vitest';
import { MAX_HEADERS, MAX_HEADER_LINE_BYTES } from './constants.ts';
import { EmailHeaderLineTooLongError, EmailTooManyHeadersError } from './errors.ts';
import {
  buildHeaderMap,
  firstHeader,
  parseContentType,
  parseHeaderFields,
  parseParameterisedHeader,
} from './headers.ts';

describe('parseHeaderFields', () => {
  it('parses simple fields preserving original-case names', () => {
    const fields = parseHeaderFields('From: a@x.com\r\nSubject: Hi');
    expect(fields).toHaveLength(2);
    expect(fields[0]).toEqual({ name: 'From', value: 'a@x.com' });
    expect(fields[1]?.name).toBe('Subject');
  });

  it('unfolds folded continuation lines (§2.2.3)', () => {
    const fields = parseHeaderFields('Subject: This is\r\n a folded\r\n  subject');
    expect(fields[0]?.value).toBe('This is a folded  subject');
  });

  it('tolerates bare-LF line endings', () => {
    const fields = parseHeaderFields('A: 1\nB: 2');
    expect(fields.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('preserves multiple same-name headers in order', () => {
    const fields = parseHeaderFields('Received: one\r\nReceived: two');
    expect(fields).toHaveLength(2);
    expect(fields.every((f) => f.name === 'Received')).toBe(true);
  });

  it('skips lines without a colon', () => {
    const fields = parseHeaderFields('garbage line\r\nReal: yes');
    expect(fields).toHaveLength(1);
    expect(fields[0]?.name).toBe('Real');
  });

  it('throws when there are too many headers', () => {
    const lines = Array.from({ length: MAX_HEADERS + 1 }, (_, i) => `X-${i}: v`).join('\r\n');
    expect(() => parseHeaderFields(lines)).toThrow(EmailTooManyHeadersError);
  });

  it('throws when a single line is too long', () => {
    const huge = `X: ${'a'.repeat(MAX_HEADER_LINE_BYTES + 1)}`;
    expect(() => parseHeaderFields(huge)).toThrow(EmailHeaderLineTooLongError);
  });
});

describe('buildHeaderMap', () => {
  it('builds a prototype-free, case-insensitive map', () => {
    const map = buildHeaderMap(parseHeaderFields('Content-Type: text/plain\r\nX-A: 1\r\nX-A: 2'));
    expect(Object.getPrototypeOf(map)).toBeNull();
    expect(firstHeader(map, 'content-type')).toBe('text/plain');
    expect(map['x-a']).toEqual(['1', '2']);
    expect(firstHeader(map, 'missing')).toBeUndefined();
  });

  it('is immune to prototype-pollution-style keys', () => {
    const map = buildHeaderMap(parseHeaderFields('__proto__: injected'));
    // Stored as an own property on the null-proto map, not as a prototype.
    expect(firstHeader(map, '__proto__')).toBe('injected');
    // A fresh object is unaffected — Object.prototype was not polluted.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('parseParameterisedHeader / parseContentType', () => {
  it('parses params, respecting quoted values that contain a semicolon', () => {
    const ct = parseContentType('text/plain; boundary="a;b"; charset=utf-8');
    expect(ct.type).toBe('text');
    expect(ct.subtype).toBe('plain');
    expect(ct.params.boundary).toBe('a;b');
    expect(ct.params.charset).toBe('utf-8');
  });

  it('handles a value with no subtype', () => {
    const ct = parseContentType('multipart');
    expect(ct.type).toBe('multipart');
    expect(ct.subtype).toBe('');
  });

  it('uses a prototype-free params object and first-occurrence-wins', () => {
    const header = parseParameterisedHeader('attachment; filename="a.txt"; filename="b.txt"');
    expect(Object.getPrototypeOf(header.params)).toBeNull();
    expect(header.value).toBe('attachment');
    expect(header.params.filename).toBe('a.txt');
  });

  it('unescapes backslash escapes inside a quoted parameter', () => {
    const header = parseParameterisedHeader('x; name="a\\"b"');
    expect(header.params.name).toBe('a"b');
  });
});
