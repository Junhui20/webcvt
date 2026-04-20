/**
 * Tests for fwf.ts — covers all 18 design-note test cases plus extras.
 *
 * TC1:  Decodes 3-column 3-row ASCII baseline
 * TC2:  Right-aligned column ltrims leading spaces
 * TC3:  Pads short lines to maxEnd then slices (Trap #3 parse)
 * TC4:  Accepts lines longer than maxEnd (Trap #4)
 * TC5:  Strips BOM + hadBom=true
 * TC6:  Rejects overlapping columns
 * TC7:  Rejects zero-width column
 * TC8:  Rejects malformed UTF-8
 * TC9:  Enforces MAX_FWF_LINES cap
 * TC10: Custom padChar '0' trims zeros on right-aligned (Trap #7)
 * TC11: Surrogate-pair input splits mid-pair; documents behaviour (Trap #5)
 * TC12: serializeFwf + parseFwf round-trip (semantic)
 * TC13: serializeFwf throws on field overflow (Trap #3 serialize)
 * TC14: serializeFwf with align:'right' padChar:'0' emits zero-padded numerics
 * TC15: Exactly maxEnd chars + '\n' per record; no BOM
 * TC16: parseDataText(input, 'fwf', { columns }) returns { kind: 'fwf' }
 * TC17: serializeDataText dispatches fwf
 * TC18: Rejects padChar length !== 1
 */

import { describe, expect, it } from 'vitest';
import { bom, concat, invalidUtf8, utf8 } from './_test-helpers/bytes.ts';
import { FWF_FORMAT } from './backend.ts';
import { MAX_FWF_COLUMNS, MAX_FWF_LINES } from './constants.ts';
import {
  FwfBadPadCharError,
  FwfFieldOverflowError,
  FwfInvalidColumnError,
  FwfInvalidUtf8Error,
  FwfOverlappingColumnsError,
  FwfTooManyColumnsError,
  FwfTooManyLinesError,
} from './errors.ts';
import type { FwfColumn } from './fwf.ts';
import { parseFwf, serializeFwf } from './fwf.ts';
import { parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';

// ---------------------------------------------------------------------------
// Shared schema fixtures
// ---------------------------------------------------------------------------

/**
 * Baseline 3-column schema: name [0-10), age [10-13), city [13-23).
 * Example line: "Alice     023New York "
 */
const BASELINE_COLUMNS: readonly FwfColumn[] = [
  { name: 'name', start: 0, end: 10 },
  { name: 'age', start: 10, end: 13 },
  { name: 'city', start: 13, end: 23 },
];

// ---------------------------------------------------------------------------
// TC1: Decodes 3-column 3-row ASCII baseline
// ---------------------------------------------------------------------------

describe('TC1: parseFwf 3-column 3-row ASCII baseline', () => {
  it('parses three rows correctly, left-trims trailing spaces', () => {
    const input = [
      'Alice     023New York  ',
      'Bob       045London    ',
      'Charlie   072Paris     ',
    ].join('\n');

    const result = parseFwf(input, { columns: BASELINE_COLUMNS });

    expect(result.hadBom).toBe(false);
    expect(result.records).toHaveLength(3);
    expect(result.columns).toBe(BASELINE_COLUMNS);

    const [r0, r1, r2] = result.records as [
      Record<string, string>,
      Record<string, string>,
      Record<string, string>,
    ];
    expect(r0.name).toBe('Alice');
    expect(r0.age).toBe('023');
    expect(r0.city).toBe('New York');

    expect(r1.name).toBe('Bob');
    expect(r1.age).toBe('045');
    expect(r1.city).toBe('London');

    expect(r2.name).toBe('Charlie');
    expect(r2.age).toBe('072');
    expect(r2.city).toBe('Paris');
  });

  it('skips blank lines between records', () => {
    const input = 'Alice     023New York  \n\nBob       045London    \n';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(2);
  });

  it('skips whitespace-only lines', () => {
    const input = 'Alice     023New York  \n   \nBob       045London    ';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const input = 'Alice     023New York  \r\nBob       045London    \r\n';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(2);
    const [r0] = result.records as [Record<string, string>];
    expect(r0.name).toBe('Alice');
  });

  it('empty input produces zero records', () => {
    const result = parseFwf('', { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC2: Right-aligned column ltrims leading spaces
// ---------------------------------------------------------------------------

describe('TC2: right-aligned column ltrim', () => {
  it('ltrims leading spaces from right-aligned column', () => {
    // age column [10-13) declared as right-aligned
    const cols: readonly FwfColumn[] = [
      { name: 'name', start: 0, end: 10 },
      { name: 'age', start: 10, end: 13, align: 'right' },
      { name: 'city', start: 13, end: 23 },
    ];
    // age is right-aligned: " 23" → "23" after ltrim
    const input = 'Alice      23New York  ';
    const result = parseFwf(input, { columns: cols });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.age).toBe('23');
  });

  it('default align (left) ltrims nothing from "023" (no trailing spaces)', () => {
    const input = 'Alice     023New York  ';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    const [r0] = result.records as [Record<string, string>];
    // "023" has no trailing spaces, so rtrim leaves it intact
    expect(r0.age).toBe('023');
  });

  it('left-aligned field with trailing spaces trims to empty string (Trap #8)', () => {
    // All-spaces field → '' after rtrim
    const input = 'Alice     000          ';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    const [r0] = result.records as [Record<string, string>];
    // city = "          " (10 spaces) → '' after rtrim
    expect(r0.city).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TC3: Pads short lines to maxEnd then slices (Trap #3 parse)
// ---------------------------------------------------------------------------

describe('TC3: short line padding (Trap #3 parse)', () => {
  it('pads line shorter than maxEnd before slicing', () => {
    // maxEnd = 23; provide only 12 chars — city col [13-23) would be out of bounds
    // Parser must pad to 23 first
    const input = 'Alice     023';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.name).toBe('Alice');
    expect(r0.age).toBe('023');
    // city padded with spaces, then rtrimmed to ''
    expect(r0.city).toBe('');
  });

  it('pads empty line (non-whitespace-only) scenario is skipped — whitespace only', () => {
    // A line of all spaces is whitespace-only, so it's skipped
    const input = '          ';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(0);
  });

  it('pads line that has some but not all columns covered', () => {
    // Provide exactly name + age chars (13 chars), no city chars
    const input = 'Bob       045';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.name).toBe('Bob');
    expect(r0.age).toBe('045');
    expect(r0.city).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TC4: Accepts lines longer than maxEnd (Trap #4)
// ---------------------------------------------------------------------------

describe('TC4: long lines accepted, trailing chars ignored (Trap #4)', () => {
  it('ignores chars after maxEnd', () => {
    // maxEnd=23; append extra chars that should be ignored
    const input = 'Alice     023New York  IGNORED_CHARS_BEYOND_MAXEND';
    const result = parseFwf(input, { columns: BASELINE_COLUMNS });
    expect(result.records).toHaveLength(1);
    const [r0] = result.records as [Record<string, string>];
    expect(r0.name).toBe('Alice');
    expect(r0.city).toBe('New York');
  });

  it('accepts "pad to 80" convention lines without error', () => {
    const line = `Alice     023New York  ${' '.repeat(57)}`; // total 80 chars
    const result = parseFwf(line, { columns: BASELINE_COLUMNS });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.city).toBe('New York');
  });
});

// ---------------------------------------------------------------------------
// TC5: Strips BOM + hadBom=true
// ---------------------------------------------------------------------------

describe('TC5: BOM stripped on parse (Trap #6)', () => {
  it('strips UTF-8 BOM and sets hadBom=true', () => {
    const content = 'Alice     023New York  \n';
    const inputBytes = concat(bom(), utf8(content));
    const result = parseFwf(inputBytes, { columns: BASELINE_COLUMNS });
    expect(result.hadBom).toBe(true);
    expect(result.records).toHaveLength(1);
    const [r0] = result.records as [Record<string, string>];
    // BOM stripped — name correctly parses from position 0
    expect(r0.name).toBe('Alice');
  });

  it('hadBom=false when no BOM present', () => {
    const content = 'Alice     023New York  \n';
    const result = parseFwf(utf8(content), { columns: BASELINE_COLUMNS });
    expect(result.hadBom).toBe(false);
  });

  it('serializeFwf never emits BOM even when hadBom=true', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'Alice', age: '023', city: 'New York' }] as const,
      hadBom: true,
    };
    const output = serializeFwf(file);
    // BOM is \uFEFF — must not appear at start
    expect(output.charCodeAt(0)).not.toBe(0xfeff);
    expect(output.startsWith('\uFEFF')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC6: Rejects overlapping columns
// ---------------------------------------------------------------------------

describe('TC6: overlapping columns rejected', () => {
  it('throws FwfOverlappingColumnsError when columns overlap', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 0, end: 10 },
      { name: 'b', start: 8, end: 20 }, // overlaps: a.end=10 > b.start=8
    ];
    expect(() => parseFwf('hello world!', { columns: cols })).toThrowError(
      FwfOverlappingColumnsError,
    );
  });

  it('allows adjacent (touching) columns: prev.end === next.start', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 0, end: 5 },
      { name: 'b', start: 5, end: 10 }, // adjacent: prev.end === next.start
    ];
    const result = parseFwf('helloworld', { columns: cols });
    expect(result.records).toHaveLength(1);
    const [r0] = result.records as [Record<string, string>];
    expect(r0.a).toBe('hello');
    expect(r0.b).toBe('world');
  });

  it('detects overlap regardless of declaration order', () => {
    // Declare in reverse order; schema validator sorts before checking
    const cols: readonly FwfColumn[] = [
      { name: 'b', start: 5, end: 15 },
      { name: 'a', start: 0, end: 10 }, // a.end=10 > b.start=5 after sort
    ];
    expect(() => parseFwf('hello world!', { columns: cols })).toThrowError(
      FwfOverlappingColumnsError,
    );
  });
});

// ---------------------------------------------------------------------------
// TC7: Rejects zero-width column
// ---------------------------------------------------------------------------

describe('TC7: zero-or-negative width column rejected', () => {
  it('throws FwfInvalidColumnError for end === start (zero-width)', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 5, end: 5 }, // zero-width: end === start
    ];
    expect(() => parseFwf('hello', { columns: cols })).toThrowError(FwfInvalidColumnError);
  });

  it('throws FwfInvalidColumnError for end < start (negative-width)', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 10, end: 5 }, // negative-width
    ];
    expect(() => parseFwf('hello', { columns: cols })).toThrowError(FwfInvalidColumnError);
  });

  it('throws FwfInvalidColumnError for negative start', () => {
    const cols: readonly FwfColumn[] = [{ name: 'a', start: -1, end: 5 }];
    expect(() => parseFwf('hello', { columns: cols })).toThrowError(FwfInvalidColumnError);
  });

  it('throws FwfInvalidColumnError for empty name', () => {
    const cols: readonly FwfColumn[] = [{ name: '', start: 0, end: 5 }];
    expect(() => parseFwf('hello', { columns: cols })).toThrowError(FwfInvalidColumnError);
  });

  it('throws FwfInvalidColumnError for duplicate column names', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 0, end: 5 },
      { name: 'a', start: 5, end: 10 }, // duplicate name
    ];
    expect(() => parseFwf('helloworld', { columns: cols })).toThrowError(FwfInvalidColumnError);
  });
});

// ---------------------------------------------------------------------------
// TC8: Rejects malformed UTF-8
// ---------------------------------------------------------------------------

describe('TC8: malformed UTF-8 rejected', () => {
  it('throws FwfInvalidUtf8Error for invalid UTF-8 bytes', () => {
    expect(() => parseFwf(invalidUtf8(), { columns: BASELINE_COLUMNS })).toThrowError(
      FwfInvalidUtf8Error,
    );
  });

  it('FwfInvalidUtf8Error has correct error code', () => {
    try {
      parseFwf(invalidUtf8(), { columns: BASELINE_COLUMNS });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FwfInvalidUtf8Error);
      if (err instanceof FwfInvalidUtf8Error) {
        expect(err.code).toBe('FWF_INVALID_UTF8');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TC9: Enforces MAX_FWF_LINES cap
// ---------------------------------------------------------------------------

describe('TC9: MAX_FWF_LINES cap enforcement', () => {
  it('throws FwfTooManyLinesError when raw line count exceeds cap', () => {
    // Create a string with MAX_FWF_LINES + 1 newlines
    // Each line is a single space (whitespace-only, but raw count is checked BEFORE skip)
    const manyLines = '\n'.repeat(MAX_FWF_LINES + 1);
    expect(() => parseFwf(manyLines, { columns: BASELINE_COLUMNS })).toThrowError(
      FwfTooManyLinesError,
    );
  });

  it('FwfTooManyLinesError has correct error code', () => {
    const manyLines = '\n'.repeat(MAX_FWF_LINES + 1);
    try {
      parseFwf(manyLines, { columns: BASELINE_COLUMNS });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FwfTooManyLinesError);
      if (err instanceof FwfTooManyLinesError) {
        expect(err.code).toBe('FWF_TOO_MANY_LINES');
      }
    }
  });

  it('does not throw at exactly MAX_FWF_LINES raw lines', () => {
    // MAX_FWF_LINES newlines produces MAX_FWF_LINES+1 segments,
    // but only if split produces that many. Use MAX_FWF_LINES-1 newlines
    // so rawLines.length === MAX_FWF_LINES.
    const content = '\n'.repeat(MAX_FWF_LINES - 1); // produces MAX_FWF_LINES segments
    expect(() => parseFwf(content, { columns: BASELINE_COLUMNS })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TC10: Custom padChar '0' trims zeros on right-aligned (Trap #7)
// ---------------------------------------------------------------------------

describe('TC10: custom padChar "0" with right-aligned column (Trap #7)', () => {
  it('ltrims leading zeros from right-aligned column with padChar="0"', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'id', start: 0, end: 6, align: 'right' },
      { name: 'amount', start: 6, end: 12, align: 'right' },
    ];
    // Fields padded with '0': id=000042, amount=001234
    const input = '000042001234';
    const result = parseFwf(input, { columns: cols, padChar: '0' });
    const [r0] = result.records as [Record<string, string>];
    // right-aligned + padChar='0' → ltrim leading zeros
    expect(r0.id).toBe('42');
    expect(r0.amount).toBe('1234');
  });

  it('all-zero field trims to empty string', () => {
    const cols: readonly FwfColumn[] = [{ name: 'val', start: 0, end: 5, align: 'right' }];
    const result = parseFwf('00000', { columns: cols, padChar: '0' });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.val).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TC11: Surrogate-pair input splits mid-pair; documents behaviour (Trap #5)
// ---------------------------------------------------------------------------

describe('TC11: surrogate-pair / astral character width behaviour (Trap #5)', () => {
  it('emoji (2 code units) occupies 2 column positions; schema crossing mid-pair produces garbage but does not throw', () => {
    // 🎉 = U+1F389 = two UTF-16 code units (surrogate pair: \uD83C \uDF89)
    // If we declare col [0,1) we get only the high surrogate; col [1,2) gets the low surrogate.
    // This should not throw — it produces garbled output but is documented behaviour.
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 0, end: 1 },
      { name: 'b', start: 1, end: 2 },
    ];
    const input = '🎉'; // 2 code units
    expect(() => parseFwf(input, { columns: cols })).not.toThrow();
    const result = parseFwf(input, { columns: cols });
    expect(result.records).toHaveLength(1);
    // Values may be unpaired surrogates — the important thing is no exception
  });

  it('schema that keeps emoji intact (width 2) round-trips correctly', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'emoji', start: 0, end: 2 },
      { name: 'rest', start: 2, end: 7 },
    ];
    const input = '🎉hello';
    const result = parseFwf(input, { columns: cols });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.emoji).toBe('🎉');
    expect(r0.rest).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// TC12: serializeFwf + parseFwf round-trip (semantic)
// ---------------------------------------------------------------------------

describe('TC12: serializeFwf + parseFwf semantic round-trip', () => {
  it('round-trips a 3-record file correctly', () => {
    const original: Array<Record<string, string>> = [
      { name: 'Alice', age: '023', city: 'New York' },
      { name: 'Bob', age: '045', city: 'London' },
      { name: 'Charlie', age: '072', city: 'Paris' },
    ];
    const file = { columns: BASELINE_COLUMNS, records: original, hadBom: false };

    const serialized = serializeFwf(file);
    const reparsed = parseFwf(serialized, { columns: BASELINE_COLUMNS });

    expect(reparsed.records).toHaveLength(3);
    for (let i = 0; i < original.length; i++) {
      const orig = original[i] as Record<string, string>;
      const rep = reparsed.records[i] as Record<string, string>;
      expect(rep.name).toBe(orig.name);
      expect(rep.age).toBe(orig.age);
      expect(rep.city).toBe(orig.city);
    }
  });

  it('empty string field round-trips as empty string', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: '', age: '000', city: '' }],
      hadBom: false,
    };
    const serialized = serializeFwf(file);
    const reparsed = parseFwf(serialized, { columns: BASELINE_COLUMNS });
    const [r0] = reparsed.records as [Record<string, string>];
    expect(r0.name).toBe('');
    expect(r0.age).toBe('000');
    expect(r0.city).toBe('');
  });
});

// ---------------------------------------------------------------------------
// TC13: serializeFwf throws on field overflow (Trap #3 serialize)
// ---------------------------------------------------------------------------

describe('TC13: serializeFwf throws FwfFieldOverflowError on overflow (Trap #3 serialize)', () => {
  it('throws when value length > column width', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'TooLongNameExceedsTen', age: '023', city: 'New York' }],
      hadBom: false,
    };
    expect(() => serializeFwf(file)).toThrowError(FwfFieldOverflowError);
  });

  it('FwfFieldOverflowError carries column name and lengths', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'TooLongNameExceedsTen', age: '023', city: 'New York' }],
      hadBom: false,
    };
    try {
      serializeFwf(file);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FwfFieldOverflowError);
      if (err instanceof FwfFieldOverflowError) {
        expect(err.code).toBe('FWF_FIELD_OVERFLOW');
        expect(err.column).toBe('name');
        expect(err.valueLength).toBe(21);
        expect(err.columnWidth).toBe(10);
      }
    }
  });

  it('does not throw when value length === column width (exact fit)', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'ExactlyTen', age: '023', city: 'New York  ' }],
      hadBom: false,
    };
    expect(() => serializeFwf(file)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TC14: serializeFwf with align:'right' padChar:'0' emits zero-padded numerics
// ---------------------------------------------------------------------------

describe('TC14: serializeFwf right-align + padChar="0" emits zero-padded numerics', () => {
  it('zero-pads numeric fields on the left', () => {
    const cols: readonly FwfColumn[] = [
      { name: 'id', start: 0, end: 6, align: 'right' },
      { name: 'amount', start: 6, end: 12, align: 'right' },
    ];
    const file = {
      columns: cols,
      records: [{ id: '42', amount: '1234' }],
      hadBom: false,
    };
    const output = serializeFwf(file, { padChar: '0' });
    // id=6-wide right-aligned: '000042'; amount=6-wide: '001234'
    expect(output).toBe('000042001234\n');
  });

  it('full-width value (no padding needed) emits unchanged', () => {
    const cols: readonly FwfColumn[] = [{ name: 'id', start: 0, end: 4, align: 'right' }];
    const file = { columns: cols, records: [{ id: '1234' }], hadBom: false };
    const output = serializeFwf(file, { padChar: '0' });
    expect(output).toBe('1234\n');
  });
});

// ---------------------------------------------------------------------------
// TC15: Exactly maxEnd chars + '\n' per record; no BOM
// ---------------------------------------------------------------------------

describe('TC15: serializer emits exactly maxEnd chars + LF per record', () => {
  it('each line is exactly maxEnd (23) chars plus newline', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [
        { name: 'Alice', age: '023', city: 'New York' },
        { name: 'Bob', age: '045', city: 'London' },
      ],
      hadBom: false,
    };
    const output = serializeFwf(file);
    const lines = output.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.length).toBe(23); // maxEnd
    }
  });

  it('no trailing line after last record except the newline at end of last record', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'Alice', age: '023', city: 'New York' }],
      hadBom: false,
    };
    const output = serializeFwf(file);
    // Should end with exactly one '\n' and no extra blank lines
    expect(output.endsWith('\n')).toBe(true);
    expect(output.split('\n').at(-1)).toBe('');
    // Only one '\n' in total (one record = one line)
    expect((output.match(/\n/g) ?? []).length).toBe(1);
  });

  it('empty records array returns empty string (not newline)', () => {
    const file = { columns: BASELINE_COLUMNS, records: [], hadBom: false };
    expect(serializeFwf(file)).toBe('');
  });

  it('no BOM emitted regardless of hadBom', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'Alice', age: '023', city: 'New York' }],
      hadBom: true,
    };
    const output = serializeFwf(file);
    expect(output.charCodeAt(0)).not.toBe(0xfeff);
  });
});

// ---------------------------------------------------------------------------
// TC16: parseDataText(input, 'fwf', { columns }) returns { kind: 'fwf' }
// ---------------------------------------------------------------------------

describe('TC16: parseDataText dispatches fwf format', () => {
  it("returns { kind: 'fwf', file: FwfFile } for 'fwf' format", () => {
    const input = 'Alice     023New York  \n';
    const result = parseDataText(input, 'fwf', { columns: BASELINE_COLUMNS });
    expect(result.kind).toBe('fwf');
    if (result.kind === 'fwf') {
      expect(result.file.records).toHaveLength(1);
      const [r0] = result.file.records as [Record<string, string>];
      expect(r0.name).toBe('Alice');
    }
  });

  it('FwfParseOptions.columns is required and forwarded', () => {
    const cols: readonly FwfColumn[] = [{ name: 'x', start: 0, end: 3 }];
    const result = parseDataText('abc', 'fwf', { columns: cols });
    expect(result.kind).toBe('fwf');
    if (result.kind === 'fwf') {
      const [r0] = result.file.records as [Record<string, string>];
      expect(r0.x).toBe('abc');
    }
  });
});

// ---------------------------------------------------------------------------
// TC17: serializeDataText dispatches fwf
// ---------------------------------------------------------------------------

describe('TC17: serializeDataText dispatches fwf kind', () => {
  it('calls serializeFwf for kind=fwf', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'Alice', age: '023', city: 'New York' }],
      hadBom: false,
    };
    const dtFile = { kind: 'fwf' as const, file };
    const output = serializeDataText(dtFile);
    // Each line should be exactly 23 chars + '\n'
    const lines = output.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBe(23);
  });

  it('round-trip via parseDataText + serializeDataText preserves values', () => {
    const input = 'Alice     023New York  \nBob       045London    \n';
    const parsed = parseDataText(input, 'fwf', { columns: BASELINE_COLUMNS });
    const serialized = serializeDataText(parsed);
    const reparsed = parseDataText(serialized, 'fwf', { columns: BASELINE_COLUMNS });
    if (reparsed.kind === 'fwf') {
      const [r0, r1] = reparsed.file.records as [Record<string, string>, Record<string, string>];
      expect(r0.name).toBe('Alice');
      expect(r1.name).toBe('Bob');
    }
  });
});

// ---------------------------------------------------------------------------
// TC18: Rejects padChar length !== 1
// ---------------------------------------------------------------------------

describe('TC18: padChar must be exactly 1 UTF-16 code unit (Trap #5)', () => {
  it('throws FwfBadPadCharError for empty padChar', () => {
    expect(() => parseFwf('hello', { columns: BASELINE_COLUMNS, padChar: '' })).toThrowError(
      FwfBadPadCharError,
    );
  });

  it('throws FwfBadPadCharError for multi-char padChar', () => {
    expect(() => parseFwf('hello', { columns: BASELINE_COLUMNS, padChar: '  ' })).toThrowError(
      FwfBadPadCharError,
    );
  });

  it('throws FwfBadPadCharError for 2-code-unit emoji padChar', () => {
    // '🎉' is 2 UTF-16 code units, length === 2
    expect(() => parseFwf('hello', { columns: BASELINE_COLUMNS, padChar: '🎉' })).toThrowError(
      FwfBadPadCharError,
    );
  });

  it('FwfBadPadCharError has correct error code', () => {
    try {
      parseFwf('hello', { columns: BASELINE_COLUMNS, padChar: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FwfBadPadCharError);
      if (err instanceof FwfBadPadCharError) {
        expect(err.code).toBe('FWF_BAD_PAD_CHAR');
      }
    }
  });

  it('serializer also throws FwfBadPadCharError for invalid padChar', () => {
    const file = {
      columns: BASELINE_COLUMNS,
      records: [{ name: 'Alice', age: '023', city: 'NY' }],
      hadBom: false,
    };
    expect(() => serializeFwf(file, { padChar: '' })).toThrowError(FwfBadPadCharError);
  });
});

// ---------------------------------------------------------------------------
// Additional: MAX_FWF_COLUMNS cap
// ---------------------------------------------------------------------------

describe('MAX_FWF_COLUMNS cap', () => {
  it('throws FwfTooManyColumnsError when column count exceeds cap', () => {
    const cols: FwfColumn[] = [];
    for (let i = 0; i < MAX_FWF_COLUMNS + 1; i++) {
      cols.push({ name: `col${i}`, start: i * 2, end: i * 2 + 1 });
    }
    expect(() => parseFwf('', { columns: cols })).toThrowError(FwfTooManyColumnsError);
  });

  it('FwfTooManyColumnsError has correct error code', () => {
    const cols: FwfColumn[] = [];
    for (let i = 0; i < MAX_FWF_COLUMNS + 1; i++) {
      cols.push({ name: `col${i}`, start: i * 2, end: i * 2 + 1 });
    }
    try {
      parseFwf('', { columns: cols });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FwfTooManyColumnsError);
      if (err instanceof FwfTooManyColumnsError) {
        expect(err.code).toBe('FWF_TOO_MANY_COLUMNS');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Additional: FWF_FORMAT descriptor
// ---------------------------------------------------------------------------

describe('FWF_FORMAT descriptor', () => {
  it('has ext=fwf and mime=text/plain', () => {
    expect(FWF_FORMAT.ext).toBe('fwf');
    expect(FWF_FORMAT.mime).toBe('text/plain');
    expect(FWF_FORMAT.category).toBe('data');
    expect(FWF_FORMAT.description).toBe('Fixed-Width Format');
  });
});

// ---------------------------------------------------------------------------
// Additional: gap-filling between non-adjacent columns in serializer
// ---------------------------------------------------------------------------

describe('serializer gap-filling between non-adjacent columns', () => {
  it('fills gaps between columns with padChar', () => {
    // Columns with a gap: a=[0,3), b=[5,8) — gap at [3,5)
    const cols: readonly FwfColumn[] = [
      { name: 'a', start: 0, end: 3 },
      { name: 'b', start: 5, end: 8 },
    ];
    const file = { columns: cols, records: [{ a: 'abc', b: 'xyz' }], hadBom: false };
    const output = serializeFwf(file);
    // Expected: "abc  xyz\n" (gap positions 3,4 filled with spaces)
    expect(output).toBe('abc  xyz\n');
  });
});

// ---------------------------------------------------------------------------
// Additional: rtrim/ltrim edge cases
// ---------------------------------------------------------------------------

describe('rtrim/ltrim helper semantics', () => {
  it('rtrim preserves non-pad chars at end', () => {
    // "hello   " → "hello"; "  hello" → "  hello"
    const cols: readonly FwfColumn[] = [{ name: 'v', start: 0, end: 10 }];
    const result = parseFwf('hello     ', { columns: cols });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.v).toBe('hello');
  });

  it('ltrim preserves non-pad chars at start (right-aligned)', () => {
    const cols: readonly FwfColumn[] = [{ name: 'v', start: 0, end: 10, align: 'right' }];
    const result = parseFwf('     hello', { columns: cols });
    const [r0] = result.records as [Record<string, string>];
    expect(r0.v).toBe('hello');
  });

  it('rtrim does not remove interior pad chars', () => {
    const cols: readonly FwfColumn[] = [{ name: 'v', start: 0, end: 11 }];
    const result = parseFwf('hello world', { columns: cols });
    const [r0] = result.records as [Record<string, string>];
    // No trailing spaces, so rtrim leaves "hello world" intact
    expect(r0.v).toBe('hello world');
  });
});
