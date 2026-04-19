/**
 * Tests for tsv.ts — covers design-note test case TC15:
 * TC15: parseTsv uses tab delimiter and round-trips identically
 */

import { describe, expect, it } from 'vitest';
import { buildCsv } from './_test-helpers/build-csv.ts';
import { parseTsv, serializeTsv } from './tsv.ts';

describe('parseTsv', () => {
  // TC15
  it('uses tab delimiter and round-trips identically', () => {
    const input = buildCsv(
      [
        ['name', 'score'],
        ['Alice', '95'],
        ['Bob', '87'],
      ],
      { delimiter: '\t' },
    );
    const result = parseTsv(input, { header: true });
    expect(result.delimiter).toBe('\t');
    expect(result.headers).toEqual(['name', 'score']);
    const rows = result.rows as Record<string, string>[];
    expect(rows[0]).toEqual({ name: 'Alice', score: '95' });
    expect(rows[1]).toEqual({ name: 'Bob', score: '87' });
  });

  it('parses tab-delimited without header', () => {
    const input = 'a\tb\tc\r\n1\t2\t3\r\n';
    const result = parseTsv(input);
    const rows = result.rows as string[][];
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('handles quoted fields with embedded tabs', () => {
    const input = '"a\tb"\tc\r\n';
    const result = parseTsv(input);
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('a\tb');
    expect(rows[0]?.[1]).toBe('c');
  });

  it('handles quote-doubling in TSV', () => {
    const input = '"a""b"\tc\r\n';
    const result = parseTsv(input);
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('a"b');
  });

  it('handles trailing newline without extra empty row', () => {
    const input = 'a\tb\r\n1\t2\r\n';
    const result = parseTsv(input);
    expect(result.rows).toHaveLength(2);
  });
});

describe('serializeTsv', () => {
  it('round-trips a TSV table', () => {
    const input = buildCsv(
      [
        ['col1', 'col2'],
        ['val1', 'val2'],
      ],
      { delimiter: '\t' },
    );
    const parsed = parseTsv(input, { header: true });
    const out = serializeTsv(parsed);
    const reparsed = parseTsv(out, { header: true });
    expect(reparsed.headers).toEqual(['col1', 'col2']);
    const rows = reparsed.rows as Record<string, string>[];
    expect(rows[0]).toEqual({ col1: 'val1', col2: 'val2' });
  });

  it('quotes fields containing tabs in serialized TSV', () => {
    const result = parseTsv('"a\tb"\tc\r\n');
    const out = serializeTsv(result);
    // The field 'a\tb' must be quoted in output
    expect(out).toContain('"a\tb"');
  });

  it('emits CRLF terminators', () => {
    const result = parseTsv('a\tb\r\n');
    const out = serializeTsv(result);
    expect(out.endsWith('\r\n')).toBe(true);
  });
});
