/**
 * Tests for serializer.ts — top-level serializeDataText dispatch.
 * TC23: serializeDataText round-trip preserves all five format payloads.
 */

import { describe, expect, it } from 'vitest';
import { parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';

describe('serializeDataText', () => {
  // TC23
  it('round-trip preserves JSON payload', () => {
    const parsed = parseDataText('{"a":1,"b":"hello"}', 'json');
    const out = serializeDataText(parsed);
    const reparsed = parseDataText(out, 'json');
    expect(reparsed.kind).toBe('json');
    if (reparsed.kind === 'json') {
      expect(reparsed.file.value).toEqual({ a: 1, b: 'hello' });
    }
  });

  it('round-trip preserves CSV payload', () => {
    const parsed = parseDataText('a,b\n1,2\n3,4\n', 'csv');
    const out = serializeDataText(parsed);
    const reparsed = parseDataText(out, 'csv');
    expect(reparsed.kind).toBe('csv');
    if (reparsed.kind === 'csv') {
      expect(reparsed.file.rows).toHaveLength(3);
    }
  });

  it('round-trip preserves TSV payload', () => {
    const parsed = parseDataText('a\tb\n1\t2\n', 'tsv');
    const out = serializeDataText(parsed);
    const reparsed = parseDataText(out, 'tsv');
    expect(reparsed.kind).toBe('tsv');
    if (reparsed.kind === 'tsv') {
      const rows = reparsed.file.rows as string[][];
      expect(rows[0]).toEqual(['a', 'b']);
      expect(rows[1]).toEqual(['1', '2']);
    }
  });

  it('round-trip preserves INI payload', () => {
    const parsed = parseDataText('[s1]\na=1\nb=2\n', 'ini');
    const out = serializeDataText(parsed);
    const reparsed = parseDataText(out, 'ini');
    expect(reparsed.kind).toBe('ini');
    if (reparsed.kind === 'ini') {
      expect(reparsed.file.data.s1?.a).toBe('1');
      expect(reparsed.file.data.s1?.b).toBe('2');
    }
  });

  it('round-trip preserves ENV payload', () => {
    const parsed = parseDataText('FOO=bar\nBAZ=qux\n', 'env');
    const out = serializeDataText(parsed);
    const reparsed = parseDataText(out, 'env');
    expect(reparsed.kind).toBe('env');
    if (reparsed.kind === 'env') {
      expect(reparsed.file.data.FOO).toBe('bar');
      expect(reparsed.file.data.BAZ).toBe('qux');
    }
  });

  it('dispatches json kind to serializeJson', () => {
    const parsed = parseDataText('42', 'json');
    expect(serializeDataText(parsed)).toBe('42');
  });

  it('dispatches csv kind to serializeDelimited', () => {
    const parsed = parseDataText('a,b\r\n', 'csv');
    const out = serializeDataText(parsed);
    expect(out).toContain(',');
    expect(out).toContain('\r\n');
  });

  it('dispatches tsv kind to serializeDelimited with tab', () => {
    const parsed = parseDataText('a\tb\r\n', 'tsv');
    const out = serializeDataText(parsed);
    expect(out).toContain('\t');
  });

  it('dispatches ini kind to serializeIni', () => {
    const parsed = parseDataText('[s]\nkey=val\n', 'ini');
    const out = serializeDataText(parsed);
    expect(out).toContain('[s]');
  });

  it('dispatches env kind to serializeEnv', () => {
    const parsed = parseDataText('KEY=value\n', 'env');
    const out = serializeDataText(parsed);
    expect(out).toContain('KEY=');
  });
});
