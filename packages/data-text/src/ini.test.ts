/**
 * Tests for ini.ts — covers design-note test cases:
 * TC16: parseIni groups keys under [section] and uses __default__ for bare keys
 * TC17: parseIni emits duplicate-key warning, last-wins
 * TC18: parseIni treats [a.b] as literal section name (no nesting)
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { IniEmptyKeyError, IniInvalidUtf8Error, IniSyntaxError } from './errors.ts';
import { parseIni, serializeIni } from './ini.ts';

describe('parseIni', () => {
  // TC16
  it('groups keys under [section] and uses __default__ for bare keys', () => {
    const input = `
bare=1
[section1]
key=value
[section2]
other=data
`;
    const result = parseIni(input);
    expect(result.sections).toContain('__default__');
    expect(result.sections).toContain('section1');
    expect(result.sections).toContain('section2');
    expect(result.data.__default__?.bare).toBe('1');
    expect(result.data.section1?.key).toBe('value');
    expect(result.data.section2?.other).toBe('data');
  });

  it('omits __default__ from sections when no bare keys exist', () => {
    const input = '[s1]\na=1\n';
    const result = parseIni(input);
    expect(result.sections).not.toContain('__default__');
    expect(result.sections).toContain('s1');
  });

  // TC17
  it('emits duplicate-key warning, last-wins', () => {
    const input = '[s]\nkey=first\nkey=second\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('second');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('duplicate key');
    expect(result.warnings[0]).toContain('key');
  });

  // TC18
  it('treats [a.b] as literal section name (no nesting)', () => {
    const input = '[a.b]\nkey=value\n';
    const result = parseIni(input);
    expect(result.sections).toContain('a.b');
    expect(result.data['a.b']?.key).toBe('value');
  });

  it('skips ; comment lines', () => {
    const input = '; this is a comment\n[s]\nkey=val\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('val');
  });

  it('skips # comment lines', () => {
    const input = '# another comment\n[s]\nkey=val\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('val');
  });

  it('skips blank lines', () => {
    const input = '\n\n[s]\n\nkey=val\n\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('val');
  });

  it('handles key: value (colon delimiter)', () => {
    const input = '[s]\nkey: value\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('value');
  });

  it('trims whitespace around keys and values', () => {
    const input = '[s]\n  key  =  value  \n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('value');
  });

  it('handles Windows CRLF line endings', () => {
    const input = '[s]\r\nkey=value\r\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('value');
  });

  it('handles bare-CR line endings', () => {
    const input = '[s]\rkey=value\r';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('value');
  });

  it('throws IniEmptyKeyError for empty key', () => {
    expect(() => parseIni('[s]\n=value\n')).toThrow(IniEmptyKeyError);
  });

  it('throws IniSyntaxError for unrecognized line', () => {
    expect(() => parseIni('[s]\njust text here\n')).toThrow(IniSyntaxError);
  });

  it('throws IniInvalidUtf8Error on malformed UTF-8 bytes', () => {
    const bad = concat(utf8('[s]\nkey='), invalidUtf8());
    expect(() => parseIni(bad)).toThrow(IniInvalidUtf8Error);
  });

  it('strips UTF-8 BOM', () => {
    const bytes = concat(bom(), utf8('[s]\nkey=val\n'));
    const result = parseIni(bytes);
    expect(result.data.s?.key).toBe('val');
  });

  it('handles multiple sections in order', () => {
    const input = '[b]\nb=2\n[a]\na=1\n';
    const result = parseIni(input);
    expect(result.sections[0]).toBe('b');
    expect(result.sections[1]).toBe('a');
  });

  it('last-wins for duplicate sections: only one entry, keys merged', () => {
    const input = '[s]\na=1\n[s]\nb=2\n';
    const result = parseIni(input);
    // section 's' should appear only once
    expect(result.sections.filter((s) => s === 's')).toHaveLength(1);
    expect(result.data.s?.a).toBe('1');
    expect(result.data.s?.b).toBe('2');
  });

  it('returns empty warnings for clean input', () => {
    const input = '[s]\nkey=val\n';
    const result = parseIni(input);
    expect(result.warnings).toHaveLength(0);
  });

  it('value contains = sign (splits on first =)', () => {
    const input = '[s]\nkey=a=b=c\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('a=b=c');
  });

  it('value contains : sign after = delimiter (splits on first =)', () => {
    const input = '[s]\nkey=val:ue\n';
    const result = parseIni(input);
    expect(result.data.s?.key).toBe('val:ue');
  });
});

describe('serializeIni', () => {
  it('round-trips a simple INI document', () => {
    const input = '[s1]\na=1\nb=2\n[s2]\nc=3\n';
    const parsed = parseIni(input);
    const out = serializeIni(parsed);
    const reparsed = parseIni(out);
    expect(reparsed.data.s1?.a).toBe('1');
    expect(reparsed.data.s1?.b).toBe('2');
    expect(reparsed.data.s2?.c).toBe('3');
  });

  it('emits __default__ keys without a section header', () => {
    const input = 'bare=1\n[s]\nkey=val\n';
    const parsed = parseIni(input);
    const out = serializeIni(parsed);
    expect(out).toContain('bare=1');
    expect(out).not.toMatch(/\[__default__\]/);
  });

  it('emits [section] headers for named sections', () => {
    const input = '[mySection]\nfoo=bar\n';
    const parsed = parseIni(input);
    const out = serializeIni(parsed);
    expect(out).toContain('[mySection]\n');
  });

  it('inserts blank line between sections', () => {
    const input = '[s1]\na=1\n[s2]\nb=2\n';
    const parsed = parseIni(input);
    const out = serializeIni(parsed);
    expect(out).toMatch(/\n\n/);
  });

  it('serializes empty ini file to empty string', () => {
    const parsed = parseIni('');
    const out = serializeIni(parsed);
    expect(out).toBe('');
  });

  // Sec-H-1 regression: malicious __proto__ section MUST NOT pollute Object.prototype.
  it('Sec-H-1: rejects prototype pollution via [__proto__] section', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const parsed = parseIni('[__proto__]\npolluted=true\n');
    expect(parsed.sections).toContain('__proto__');
    expect(Object.getPrototypeOf(parsed.data)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });

  it('Sec-H-1: rejects prototype pollution via constructor key inside section', () => {
    const parsed = parseIni('[s]\nconstructor=hijack\n');
    const sectionData = parsed.data.s as Record<string, string>;
    expect(sectionData.constructor).toBe('hijack');
    expect(Object.getPrototypeOf(sectionData)).toBeNull();
  });
});
