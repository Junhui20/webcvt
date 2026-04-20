/**
 * Tests for jsonl.ts — covers all 16 design-note test cases plus extras.
 *
 * TC1:  Happy-path object records
 * TC2:  Mixed record kinds (object, number, string, null, array, bool)
 * TC3:  Empty lines skipped
 * TC4:  CRLF accepted, serializer emits LF
 * TC5:  No trailing newline tolerated
 * TC6:  BOM stripped on parse, NOT re-emitted on serialize
 * TC7:  Malformed UTF-8 → JsonlInvalidUtf8Error
 * TC8:  Per-record parse failure reports lineNumber
 * TC9:  Per-record depth cap rejects 257-deep on line 2
 * TC10: Per-record length cap (1 MiB + 1 char)
 * TC11: Record-count cap at raw-line level
 * TC12: Serialize empty file = '' (NOT '\n')
 * TC13: Serialize forbids undefined record
 * TC14: Round-trip preserves order and values
 * TC15: DataTextBackend.canHandle identity + alias + cross-alias=false
 * TC16: parseDataText(..., 'jsonl') returns { kind: 'jsonl' } branch
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { DataTextBackend, JSONL_FORMAT } from './backend.ts';
import { MAX_JSONL_RECORDS, MAX_JSONL_RECORD_CHARS, MAX_JSON_DEPTH } from './constants.ts';
import {
  JsonlInvalidUtf8Error,
  JsonlRecordDepthExceededError,
  JsonlRecordParseError,
  JsonlRecordTooLongError,
  JsonlTooManyRecordsError,
} from './errors.ts';
import { parseJsonl, serializeJsonl } from './jsonl.ts';
import { parseDataText } from './parser.ts';

// ---------------------------------------------------------------------------
// TC1: Happy-path object records
// ---------------------------------------------------------------------------

describe('TC1: parseJsonl happy-path object records', () => {
  it('parses two object records correctly', () => {
    const input = '{"id":1,"msg":"hello"}\n{"id":2,"msg":"world"}\n';
    const result = parseJsonl(input);
    expect(result.hadBom).toBe(false);
    expect(result.trailingNewline).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({ id: 1, msg: 'hello' });
    expect(result.records[1]).toEqual({ id: 2, msg: 'world' });
  });

  it('parses a single record with no trailing newline', () => {
    const result = parseJsonl('{"a":1}');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual({ a: 1 });
    expect(result.trailingNewline).toBe(false);
  });

  it('empty string produces zero records', () => {
    const result = parseJsonl('');
    expect(result.records).toHaveLength(0);
    expect(result.hadBom).toBe(false);
    expect(result.trailingNewline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC2: Mixed record kinds
// ---------------------------------------------------------------------------

describe('TC2: parseJsonl mixed record kinds', () => {
  it('accepts object, number, string, null, array, boolean records', () => {
    const lines = ['{"key":"val"}', '42', '"hello"', 'null', '[1,2,3]', 'true', 'false'].join('\n');
    const result = parseJsonl(lines);
    expect(result.records).toHaveLength(7);
    expect(result.records[0]).toEqual({ key: 'val' });
    expect(result.records[1]).toBe(42);
    expect(result.records[2]).toBe('hello');
    expect(result.records[3]).toBeNull();
    expect(result.records[4]).toEqual([1, 2, 3]);
    expect(result.records[5]).toBe(true);
    expect(result.records[6]).toBe(false);
  });

  it('accepts Uint8Array input', () => {
    const result = parseJsonl(utf8('{"x":1}\n{"y":2}\n'));
    expect(result.records).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// TC3: Empty lines skipped (Trap #1)
// ---------------------------------------------------------------------------

describe('TC3: empty lines skipped (Trap #1)', () => {
  it('skips blank lines between records', () => {
    const input = '{"a":1}\n\n{"b":2}\n';
    const result = parseJsonl(input);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({ a: 1 });
    expect(result.records[1]).toEqual({ b: 2 });
  });

  it('skips whitespace-only lines', () => {
    const input = '{"a":1}\n   \n\t\n{"b":2}';
    const result = parseJsonl(input);
    expect(result.records).toHaveLength(2);
  });

  it('whitespace-only file yields zero records', () => {
    const result = parseJsonl('   \n\n\t\n');
    expect(result.records).toHaveLength(0);
  });

  it('single blank line yields zero records', () => {
    const result = parseJsonl('\n');
    expect(result.records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC4: CRLF accepted, serializer emits LF (Trap #5)
// ---------------------------------------------------------------------------

describe('TC4: CRLF accepted on parse, serializer emits LF (Trap #5)', () => {
  it('parses CRLF-terminated lines correctly', () => {
    const input = '{"a":1}\r\n{"b":2}\r\n';
    const result = parseJsonl(input);
    expect(result.trailingNewline).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({ a: 1 });
    expect(result.records[1]).toEqual({ b: 2 });
  });

  it('serializer emits LF only (no CRLF)', () => {
    const file = { records: [{ a: 1 }, { b: 2 }], hadBom: false, trailingNewline: true };
    const out = serializeJsonl(file);
    expect(out).not.toContain('\r\n');
    expect(out).toBe('{"a":1}\n{"b":2}\n');
  });

  it('bare \\r is NOT a line terminator (Trap #10)', () => {
    // A file with bare \r is treated as a single very long line
    const input = '{"a":1}\r{"b":2}';
    // This should either fail JSON.parse (invalid JSON containing \r) or treat as single record
    // The key guarantee: bare \r does NOT split lines
    expect(() => parseJsonl(input)).toThrow(JsonlRecordParseError);
  });
});

// ---------------------------------------------------------------------------
// TC5: No trailing newline tolerated (Trap #2)
// ---------------------------------------------------------------------------

describe('TC5: no trailing newline tolerated (Trap #2)', () => {
  it('parses correctly when file does not end with newline', () => {
    const input = '{"a":1}\n{"b":2}';
    const result = parseJsonl(input);
    expect(result.trailingNewline).toBe(false);
    expect(result.records).toHaveLength(2);
  });

  it('trailingNewline=true when file ends with \\n', () => {
    const result = parseJsonl('{"a":1}\n');
    expect(result.trailingNewline).toBe(true);
  });

  it('trailingNewline=true when file ends with \\r\\n', () => {
    const result = parseJsonl('{"a":1}\r\n');
    expect(result.trailingNewline).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC6: BOM stripped on parse, NOT re-emitted on serialize (Trap #4)
// ---------------------------------------------------------------------------

describe('TC6: BOM stripped on parse, NOT re-emitted on serialize (Trap #4)', () => {
  it('strips UTF-8 BOM from Uint8Array and records hadBom=true', () => {
    const bytes = concat(bom(), utf8('{"a":1}\n{"b":2}\n'));
    const result = parseJsonl(bytes);
    expect(result.hadBom).toBe(true);
    expect(result.records).toHaveLength(2);
  });

  it('strips BOM from string input', () => {
    const result = parseJsonl('\uFEFF{"a":1}');
    expect(result.hadBom).toBe(true);
    expect(result.records).toHaveLength(1);
  });

  it('does NOT re-emit BOM on serialize even when hadBom=true', () => {
    const bytes = concat(bom(), utf8('{"a":1}\n'));
    const parsed = parseJsonl(bytes);
    expect(parsed.hadBom).toBe(true);
    const out = serializeJsonl(parsed);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out).toBe('{"a":1}\n');
  });
});

// ---------------------------------------------------------------------------
// TC7: Malformed UTF-8 → JsonlInvalidUtf8Error
// ---------------------------------------------------------------------------

describe('TC7: malformed UTF-8 → JsonlInvalidUtf8Error', () => {
  it('throws JsonlInvalidUtf8Error for invalid UTF-8 bytes', () => {
    const bytes = concat(utf8('{"a":'), invalidUtf8(), utf8('}'));
    expect(() => parseJsonl(bytes)).toThrow(JsonlInvalidUtf8Error);
  });

  it('has error code JSONL_INVALID_UTF8', () => {
    try {
      parseJsonl(invalidUtf8());
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_INVALID_UTF8');
    }
  });
});

// ---------------------------------------------------------------------------
// TC8: Per-record parse failure reports lineNumber
// ---------------------------------------------------------------------------

describe('TC8: per-record parse failure reports lineNumber', () => {
  it('throws JsonlRecordParseError with correct lineNumber for malformed record', () => {
    const input = '{"valid":1}\n{invalid json}\n{"also":2}';
    let threw: JsonlRecordParseError | undefined;
    try {
      parseJsonl(input);
    } catch (err) {
      if (err instanceof JsonlRecordParseError) threw = err;
    }
    expect(threw).toBeDefined();
    expect(threw?.lineNumber).toBe(2);
  });

  it('reports lineNumber 1 for first-line failure', () => {
    expect(() => parseJsonl('not json')).toThrow(JsonlRecordParseError);
    try {
      parseJsonl('not json');
    } catch (err) {
      expect(err instanceof JsonlRecordParseError && err.lineNumber).toBe(1);
    }
  });

  it('all-or-nothing: does not return partial records on failure', () => {
    const input = '{"a":1}\n{bad}\n{"c":3}';
    expect(() => parseJsonl(input)).toThrow(JsonlRecordParseError);
  });

  it('error code is JSONL_RECORD_PARSE', () => {
    try {
      parseJsonl('not json');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_RECORD_PARSE');
    }
  });
});

// ---------------------------------------------------------------------------
// TC9: Per-record depth cap rejects 257-deep on line 2 (Trap #3)
// ---------------------------------------------------------------------------

describe('TC9: per-record depth cap (Trap #3)', () => {
  it('rejects 257-deep nesting on line 2 with JsonlRecordDepthExceededError', () => {
    const okRecord = '{"valid":1}';
    const bomb = '['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1);
    const input = `${okRecord}\n${bomb}`;
    let threw: JsonlRecordDepthExceededError | undefined;
    try {
      parseJsonl(input);
    } catch (err) {
      if (err instanceof JsonlRecordDepthExceededError) threw = err;
    }
    expect(threw).toBeDefined();
    expect(threw?.lineNumber).toBe(2);
  });

  it('accepts exactly 256-deep nesting', () => {
    const ok = '['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH);
    const result = parseJsonl(ok);
    expect(result.records).toHaveLength(1);
  });

  it('error code is JSONL_RECORD_DEPTH_EXCEEDED', () => {
    const bomb = '['.repeat(300) + ']'.repeat(300);
    try {
      parseJsonl(bomb);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_RECORD_DEPTH_EXCEEDED');
    }
  });

  it('depth check runs before JSON.parse (no stack overflow)', () => {
    // 1000-deep nesting — would overflow V8 stack if JSON.parse were called first
    const bomb = '['.repeat(1000) + ']'.repeat(1000);
    expect(() => parseJsonl(bomb)).toThrow(JsonlRecordDepthExceededError);
  });
});

// ---------------------------------------------------------------------------
// TC10: Per-record length cap (1 MiB + 1 char) (Trap #7)
// ---------------------------------------------------------------------------

describe('TC10: per-record length cap (Trap #7)', () => {
  it('throws JsonlRecordTooLongError for line exceeding MAX_JSONL_RECORD_CHARS', () => {
    // Build a valid JSON string that is 1 MiB + 1 char
    // "..." where the content is MAX_JSONL_RECORD_CHARS - 1 chars (including quotes = too long)
    const padding = 'x'.repeat(MAX_JSONL_RECORD_CHARS);
    const longLine = `"${padding}"`;
    // longLine.length = MAX_JSONL_RECORD_CHARS + 2 > MAX_JSONL_RECORD_CHARS
    expect(() => parseJsonl(longLine)).toThrow(JsonlRecordTooLongError);
  });

  it('accepts a line at exactly MAX_JSONL_RECORD_CHARS', () => {
    // Build a valid JSON string whose total length = MAX_JSONL_RECORD_CHARS
    // "xxx...x" where content length = MAX_JSONL_RECORD_CHARS - 2 (for quotes)
    const contentLen = MAX_JSONL_RECORD_CHARS - 2;
    const line = `"${'a'.repeat(contentLen)}"`;
    expect(line.length).toBe(MAX_JSONL_RECORD_CHARS);
    const result = parseJsonl(line);
    expect(result.records).toHaveLength(1);
  });

  it('reports lineNumber in JsonlRecordTooLongError', () => {
    const okLine = '{"ok":true}';
    const padding = 'x'.repeat(MAX_JSONL_RECORD_CHARS + 1);
    const longLine = `"${padding}"`;
    let threw: JsonlRecordTooLongError | undefined;
    try {
      parseJsonl(`${okLine}\n${longLine}`);
    } catch (err) {
      if (err instanceof JsonlRecordTooLongError) threw = err;
    }
    expect(threw).toBeDefined();
    expect(threw?.lineNumber).toBe(2);
  });

  it('error code is JSONL_RECORD_TOO_LONG', () => {
    const longLine = 'x'.repeat(MAX_JSONL_RECORD_CHARS + 1);
    try {
      parseJsonl(longLine);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_RECORD_TOO_LONG');
    }
  });
});

// ---------------------------------------------------------------------------
// TC11: Record-count cap at raw-line level (Trap #6)
// ---------------------------------------------------------------------------

describe('TC11: record-count cap at raw-line level (Trap #6)', () => {
  it('throws JsonlTooManyRecordsError when raw line count exceeds MAX_JSONL_RECORDS', () => {
    // `'\n'.repeat(N)` produces N \n terminators → split yields N+1 segments
    // (N empty lines + 1 trailing empty string). trailingNewline is true so
    // the trailing empty is popped, leaving N lines. With N = MAX+1, the
    // post-pop count exceeds the cap and the check fires BEFORE skip-empty.
    const overCount = MAX_JSONL_RECORDS + 1;
    const input = '\n'.repeat(overCount);
    expect(() => parseJsonl(input)).toThrow(JsonlTooManyRecordsError);
  });

  it('accepts exactly MAX_JSONL_RECORDS empty lines (boundary)', () => {
    // All lines are empty → skipped → records.length === 0; but the cap
    // check runs on raw count, which is exactly MAX → does NOT throw.
    const input = '\n'.repeat(MAX_JSONL_RECORDS);
    const result = parseJsonl(input);
    expect(result.records).toHaveLength(0);
  });

  it('error code is JSONL_TOO_MANY_RECORDS', () => {
    const input = '\n'.repeat(MAX_JSONL_RECORDS + 1);
    try {
      parseJsonl(input);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_TOO_MANY_RECORDS');
    }
  });
});

// ---------------------------------------------------------------------------
// TC12: Serialize empty file = '' (NOT '\n') (Trap #2)
// ---------------------------------------------------------------------------

describe("TC12: serialize empty file = ''", () => {
  it('returns empty string for zero records regardless of trailingNewline option', () => {
    const file = { records: [], hadBom: false, trailingNewline: true };
    expect(serializeJsonl(file)).toBe('');
    expect(serializeJsonl(file, { trailingNewline: true })).toBe('');
    expect(serializeJsonl(file, { trailingNewline: false })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TC13: Serialize forbids undefined record (Trap #8)
// ---------------------------------------------------------------------------

describe('TC13: serialize forbids undefined record (Trap #8)', () => {
  it('throws JsonlRecordParseError when JSON.stringify returns undefined', () => {
    // undefined is not a JsonValue, but we can cast to test the runtime guard
    const file = {
      records: [{ a: 1 }, undefined as unknown as null, { b: 2 }],
      hadBom: false,
      trailingNewline: true,
    };
    let threw: JsonlRecordParseError | undefined;
    try {
      serializeJsonl(file);
    } catch (err) {
      if (err instanceof JsonlRecordParseError) threw = err;
    }
    expect(threw).toBeDefined();
    // lineNumber should be 2 (1-based index of undefined record)
    expect(threw?.lineNumber).toBe(2);
  });

  it('error code is JSONL_RECORD_PARSE for undefined serialize', () => {
    const file = {
      records: [undefined as unknown as null],
      hadBom: false,
      trailingNewline: true,
    };
    try {
      serializeJsonl(file);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('JSONL_RECORD_PARSE');
    }
  });
});

// ---------------------------------------------------------------------------
// TC14: Round-trip preserves order and values
// ---------------------------------------------------------------------------

describe('TC14: round-trip preserves order and values', () => {
  it('parse → serialize → parse yields identical records', () => {
    const original = [
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 'Bob', active: false, tags: ['admin', 'user'] },
      null,
      42,
      'bare string',
      [1, 2, 3],
    ];
    const input = `${original.map((r) => JSON.stringify(r)).join('\n')}\n`;
    const parsed = parseJsonl(input);
    const serialized = serializeJsonl(parsed);
    const reparsed = parseJsonl(serialized);
    expect(reparsed.records).toEqual(original);
  });

  it('serializer emits trailingNewline by default', () => {
    const file = { records: [{ a: 1 }], hadBom: false, trailingNewline: false };
    const out = serializeJsonl(file);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('serializer respects trailingNewline=false', () => {
    const file = { records: [{ a: 1 }, { b: 2 }], hadBom: false, trailingNewline: true };
    const out = serializeJsonl(file, { trailingNewline: false });
    expect(out).toBe('{"a":1}\n{"b":2}');
    expect(out.endsWith('\n')).toBe(false);
  });

  it('round-trip single record', () => {
    const result = parseJsonl('{"x":99}\n');
    const out = serializeJsonl(result);
    expect(out).toBe('{"x":99}\n');
  });
});

// ---------------------------------------------------------------------------
// TC15: DataTextBackend.canHandle identity + alias + cross-alias=false
// ---------------------------------------------------------------------------

describe('TC15: DataTextBackend.canHandle for JSONL', () => {
  const backend = new DataTextBackend();

  const JSONL_DESCRIPTOR = { ext: 'jsonl', mime: 'application/jsonl', category: 'data' as const };
  const NDJSON_DESCRIPTOR = {
    ext: 'ndjson',
    mime: 'application/x-ndjson',
    category: 'data' as const,
  };
  const JSON_DESCRIPTOR = { ext: 'json', mime: 'application/json', category: 'data' as const };

  it('accepts application/jsonl → application/jsonl (identity)', async () => {
    expect(await backend.canHandle(JSONL_DESCRIPTOR, JSONL_DESCRIPTOR)).toBe(true);
  });

  it('accepts application/x-ndjson → application/x-ndjson (alias identity)', async () => {
    expect(await backend.canHandle(NDJSON_DESCRIPTOR, NDJSON_DESCRIPTOR)).toBe(true);
  });

  it('rejects application/jsonl → application/x-ndjson (cross-alias)', async () => {
    expect(await backend.canHandle(JSONL_DESCRIPTOR, NDJSON_DESCRIPTOR)).toBe(false);
  });

  it('rejects application/x-ndjson → application/jsonl (reverse cross-alias)', async () => {
    expect(await backend.canHandle(NDJSON_DESCRIPTOR, JSONL_DESCRIPTOR)).toBe(false);
  });

  it('rejects application/jsonl → application/json (cross-format)', async () => {
    expect(await backend.canHandle(JSONL_DESCRIPTOR, JSON_DESCRIPTOR)).toBe(false);
  });

  it('JSONL_FORMAT descriptor has correct fields', () => {
    expect(JSONL_FORMAT.ext).toBe('jsonl');
    expect(JSONL_FORMAT.mime).toBe('application/jsonl');
    expect(JSONL_FORMAT.category).toBe('data');
    expect(JSONL_FORMAT.description).toBe('JSON Lines');
  });
});

// ---------------------------------------------------------------------------
// TC16: parseDataText(..., 'jsonl') returns { kind: 'jsonl' } branch
// ---------------------------------------------------------------------------

describe('TC16: parseDataText dispatch for jsonl', () => {
  it('returns { kind: "jsonl" } when format is "jsonl"', () => {
    const result = parseDataText('{"a":1}\n{"b":2}\n', 'jsonl');
    expect(result.kind).toBe('jsonl');
  });

  it('returned file has correct records', () => {
    const result = parseDataText('{"x":10}\n{"y":20}\n', 'jsonl');
    if (result.kind !== 'jsonl') throw new Error('wrong kind');
    expect(result.file.records).toHaveLength(2);
    expect(result.file.records[0]).toEqual({ x: 10 });
    expect(result.file.records[1]).toEqual({ y: 20 });
  });

  it('works with Uint8Array input via parseDataText', () => {
    const result = parseDataText(utf8('null\ntrue\n'), 'jsonl');
    expect(result.kind).toBe('jsonl');
    if (result.kind !== 'jsonl') throw new Error('wrong kind');
    expect(result.file.records).toEqual([null, true]);
  });
});

// ---------------------------------------------------------------------------
// Additional edge-case tests for better branch coverage
// ---------------------------------------------------------------------------

describe('parseJsonl additional edge cases', () => {
  it('single newline only → zero records, trailingNewline=true', () => {
    const result = parseJsonl('\n');
    expect(result.records).toHaveLength(0);
    expect(result.trailingNewline).toBe(true);
  });

  it('nested objects within records are parsed', () => {
    const result = parseJsonl('{"nested":{"a":{"b":1}}}\n');
    expect(result.records[0]).toEqual({ nested: { a: { b: 1 } } });
  });

  it('strings with escaped characters are handled', () => {
    const result = parseJsonl('"line\\nwith\\ttabs"\n');
    expect(result.records[0]).toBe('line\nwith\ttabs');
  });

  it('large but valid file parses all records', () => {
    const count = 1000;
    const lines = `${Array.from({ length: count }, (_, i) => `{"i":${i}}`).join('\n')}\n`;
    const result = parseJsonl(lines);
    expect(result.records).toHaveLength(count);
    expect(result.records[0]).toEqual({ i: 0 });
    expect(result.records[count - 1]).toEqual({ i: count - 1 });
  });
});

describe('serializeJsonl additional edge cases', () => {
  it('single record serialized correctly', () => {
    const file = { records: [{ x: 1 }], hadBom: false, trailingNewline: true };
    expect(serializeJsonl(file)).toBe('{"x":1}\n');
  });

  it('newlines inside string values are JSON-escaped (not raw newlines)', () => {
    const file = {
      records: [{ msg: 'line1\nline2' }],
      hadBom: false,
      trailingNewline: true,
    };
    const out = serializeJsonl(file);
    // JSON.stringify encodes the newline as \n escape, so output should contain \\n
    expect(out).toBe('{"msg":"line1\\nline2"}\n');
    // Verify no raw newline appears within a record line (only the terminating \n)
    const lines = out.split('\n');
    expect(lines).toHaveLength(2); // one record line + trailing empty
  });

  it('null records serialize correctly', () => {
    const file = { records: [null], hadBom: false, trailingNewline: true };
    expect(serializeJsonl(file)).toBe('null\n');
  });

  it('numeric and boolean records serialize correctly', () => {
    const file = { records: [42, true, false], hadBom: false, trailingNewline: true };
    expect(serializeJsonl(file)).toBe('42\ntrue\nfalse\n');
  });
});
