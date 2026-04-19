/**
 * Tests for csv.ts — covers all design-note test cases for CSV:
 * TC7:  parseCsv parses a 3-row, 4-column input with header:true
 * TC8:  parseCsv handles quote-doubling: "a""b" -> a"b
 * TC9:  parseCsv handles embedded CRLF inside quoted field
 * TC10: parseCsv strips leading UTF-8 BOM
 * TC11: parseCsv tolerates trailing newline (no extra empty row)
 * TC12: parseCsv rejects unterminated quoted field
 * TC13: parseCsv rejects bare quote in unquoted field
 * TC14: parseCsv enforces MAX_CSV_ROWS cap
 */

import { describe, expect, it } from 'vitest';
import { buildCsv } from './_test-helpers/build-csv.ts';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { parseDelimited, serializeDelimited } from './csv.ts';
import {
  CsvBadQuoteError,
  CsvColCapError,
  CsvDuplicateHeaderError,
  CsvInvalidUtf8Error,
  CsvRaggedRowError,
  CsvRowCapError,
  CsvUnexpectedQuoteError,
  CsvUnterminatedQuoteError,
} from './errors.ts';

describe('parseDelimited (CSV)', () => {
  // TC7
  it('parses a 3-row, 4-column input with header:true', () => {
    const input = buildCsv([
      ['name', 'age', 'city', 'active'],
      ['Alice', '30', 'NYC', 'true'],
      ['Bob', '25', 'LA', 'false'],
      ['Charlie', '35', 'Chicago', 'true'],
    ]);
    const result = parseDelimited(input, ',', { header: true });
    expect(result.headers).toEqual(['name', 'age', 'city', 'active']);
    expect(result.rows).toHaveLength(3);
    const rows = result.rows as Record<string, string>[];
    expect(rows[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC', active: 'true' });
    expect(rows[1]).toEqual({ name: 'Bob', age: '25', city: 'LA', active: 'false' });
    expect(rows[2]).toEqual({ name: 'Charlie', age: '35', city: 'Chicago', active: 'true' });
  });

  // TC8
  it('handles quote-doubling: "a""b" -> a"b', () => {
    const input = `"a""b"\r\n`;
    const result = parseDelimited(input, ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('a"b');
  });

  it('handles multiple quote-doublings', () => {
    const input = `"he said ""hello"" to me"\r\n`;
    const result = parseDelimited(input, ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('he said "hello" to me');
  });

  // TC9
  it('handles embedded CRLF inside quoted field', () => {
    const input = `"line1\r\nline2"\r\n`;
    const result = parseDelimited(input, ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('line1\r\nline2');
    expect(rows).toHaveLength(1);
  });

  it('handles embedded LF inside quoted field', () => {
    const input = `"line1\nline2"\r\n`;
    const result = parseDelimited(input, ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('line1\nline2');
    expect(rows).toHaveLength(1);
  });

  it('handles embedded comma inside quoted field', () => {
    const input = `"a,b,c"\r\n`;
    const result = parseDelimited(input, ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('a,b,c');
  });

  // TC10
  it('strips leading UTF-8 BOM', () => {
    const bytes = concat(bom(), utf8('a,b\r\n1,2\r\n'));
    const result = parseDelimited(bytes, ',');
    const rows = result.rows as string[][];
    expect(result.hadBom).toBe(true);
    expect(rows[0]).toEqual(['a', 'b']);
  });

  // TC11
  it('tolerates trailing newline (no extra empty row)', () => {
    const input = 'a,b\r\n1,2\r\n';
    const result = parseDelimited(input, ',');
    expect(result.rows).toHaveLength(2);
  });

  it('tolerates trailing LF (no extra empty row)', () => {
    const input = 'a,b\n1,2\n';
    const result = parseDelimited(input, ',');
    expect(result.rows).toHaveLength(2);
  });

  it('parses input without trailing newline', () => {
    const input = 'a,b\r\n1,2';
    const result = parseDelimited(input, ',');
    expect(result.rows).toHaveLength(2);
  });

  it('handles bare-CR row terminator (Trap §6)', () => {
    const input = 'a,b\r1,2\r';
    const result = parseDelimited(input, ',');
    expect(result.rows).toHaveLength(2);
    const rows = result.rows as string[][];
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['1', '2']);
  });

  // TC12
  it('rejects unterminated quoted field with CsvUnterminatedQuoteError', () => {
    expect(() => parseDelimited('"unterminated', ',')).toThrow(CsvUnterminatedQuoteError);
  });

  // TC13
  it('rejects bare quote in unquoted field with CsvUnexpectedQuoteError', () => {
    expect(() => parseDelimited('a"b,c', ',')).toThrow(CsvUnexpectedQuoteError);
  });

  it('throws CsvBadQuoteError for malformed quoted field', () => {
    // "abc"x is invalid — x after closing quote is not a delimiter, EOL, or second quote
    expect(() => parseDelimited('"abc"x', ',')).toThrow(CsvBadQuoteError);
  });

  // TC14
  it('enforces MAX_CSV_ROWS cap', () => {
    // Build 1_000_001 rows of single-field data
    const rows = Array.from({ length: 1_000_001 }, (_, i) => `${i}`);
    const input = `${rows.join('\n')}\n`;
    expect(() => parseDelimited(input, ',')).toThrow(CsvRowCapError);
  });

  it('throws CsvInvalidUtf8Error on malformed UTF-8 bytes', () => {
    const bad = concat(utf8('a,b\n'), invalidUtf8());
    expect(() => parseDelimited(bad, ',')).toThrow(CsvInvalidUtf8Error);
  });

  it('throws CsvColCapError when a row has more than MAX_CSV_COLS columns', () => {
    // 1025 empty fields in one row
    const input = `${','.repeat(1024)}\n`;
    expect(() => parseDelimited(input, ',')).toThrow(CsvColCapError);
  });

  it('throws CsvDuplicateHeaderError on duplicate header names', () => {
    const input = 'name,age,name\n';
    expect(() => parseDelimited(input, ',', { header: true })).toThrow(CsvDuplicateHeaderError);
  });

  it('throws CsvRaggedRowError when a row has more fields than headers', () => {
    const input = 'a,b\n1,2,3\n';
    expect(() => parseDelimited(input, ',', { header: true })).toThrow(CsvRaggedRowError);
  });

  it('pads short rows with empty strings when row has fewer fields than headers', () => {
    const input = 'a,b,c\n1,2\n';
    const result = parseDelimited(input, ',', { header: true });
    const rows = result.rows as Record<string, string>[];
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('returns empty result for header-only CSV', () => {
    const input = 'a,b,c\n';
    const result = parseDelimited(input, ',', { header: true });
    expect(result.headers).toEqual(['a', 'b', 'c']);
    expect(result.rows).toHaveLength(0);
  });

  it('parses empty string as zero rows', () => {
    const result = parseDelimited('', ',');
    expect(result.rows).toHaveLength(0);
  });

  it('parses single field row', () => {
    const result = parseDelimited('hello\n', ',');
    const rows = result.rows as string[][];
    expect(rows[0]).toEqual(['hello']);
  });

  it('parses empty quoted field as empty string', () => {
    const result = parseDelimited('""\n', ',');
    const rows = result.rows as string[][];
    expect(rows[0]?.[0]).toBe('');
  });

  it('records hadBom=false when no BOM present', () => {
    const result = parseDelimited('a,b\n', ',');
    expect(result.hadBom).toBe(false);
  });
});

describe('serializeDelimited (CSV)', () => {
  it('serializes a headerless table with CRLF terminators', () => {
    const file = parseDelimited('a,b\r\n1,2\r\n', ',');
    const out = serializeDelimited(file);
    expect(out).toBe('a,b\r\n1,2\r\n');
  });

  it('quotes fields containing commas', () => {
    const file = parseDelimited('"a,b",c\r\n', ',');
    const out = serializeDelimited(file);
    expect(out).toBe('"a,b",c\r\n');
  });

  it('quotes fields containing double-quotes (doubling them)', () => {
    const file = parseDelimited('"a""b",c\r\n', ',');
    const out = serializeDelimited(file);
    expect(out).toBe('"a""b",c\r\n');
  });

  it('preserves BOM on serialize', () => {
    const bytes = concat(bom(), utf8('a,b\r\n1,2\r\n'));
    const file = parseDelimited(bytes, ',');
    const out = serializeDelimited(file);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it('round-trips a table with headers', () => {
    const input = buildCsv([
      ['id', 'value'],
      ['1', 'hello'],
      ['2', 'world'],
    ]);
    const parsed = parseDelimited(input, ',', { header: true });
    const out = serializeDelimited(parsed);
    const reparsed = parseDelimited(out, ',', { header: true });
    expect(reparsed.headers).toEqual(['id', 'value']);
    const rows = reparsed.rows as Record<string, string>[];
    expect(rows[0]).toEqual({ id: '1', value: 'hello' });
    expect(rows[1]).toEqual({ id: '2', value: 'world' });
  });

  it('includes trailing CRLF on last row', () => {
    const file = parseDelimited('a\r\n', ',');
    const out = serializeDelimited(file);
    expect(out.endsWith('\r\n')).toBe(true);
  });
});
