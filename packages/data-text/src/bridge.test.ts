/**
 * Tests for bridge.ts — the cross-format value bridge.
 *
 * Each per-format rule in the design note is a named test here. Round-trip
 * tests go through the real serialize/parse cycle where practical so the bridge
 * is exercised end-to-end, not just as an in-memory tree transform.
 */

import { describe, expect, it } from 'vitest';
import { bridge, canBridge, fromPlain, toPlain } from './bridge.ts';
import { serializeDelimited } from './csv.ts';
import {
  CrossFormatNotSupportedError,
  CrossFormatShapeError,
  CrossFormatValueError,
} from './errors.ts';
import { parseJson, serializeJson } from './json.ts';
import type { DataTextFile, DataTextFormat } from './parser.ts';
import type { TomlValue } from './toml.ts';
import { parseYaml, serializeYaml } from './yaml.ts';
import type { YamlValue } from './yaml.ts';

// The eight formats that participate in the value bridge.
const BRIDGEABLE: DataTextFormat[] = ['json', 'yaml', 'toml', 'csv', 'tsv', 'jsonl', 'ini', 'env'];
const EXCLUDED: DataTextFormat[] = ['xml', 'fwf'];

/** Build a YAML-backed DataTextFile (fills the directive-marker metadata). */
function yamlFile(value: YamlValue): DataTextFile {
  return {
    kind: 'yaml',
    file: { value, hadBom: false, hadDirectivesEndMarker: false, hadYamlDirective: false },
  };
}

// ---------------------------------------------------------------------------
// canBridge truth table
// ---------------------------------------------------------------------------

describe('canBridge', () => {
  it('returns true for every bridgeable pair (both directions, incl. identity)', () => {
    for (const from of BRIDGEABLE) {
      for (const to of BRIDGEABLE) {
        expect(canBridge(from, to)).toBe(true);
      }
    }
  });

  it('returns false whenever xml is on either side', () => {
    for (const other of [...BRIDGEABLE, ...EXCLUDED]) {
      expect(canBridge('xml', other)).toBe(false);
      expect(canBridge(other, 'xml')).toBe(false);
    }
  });

  it('returns false whenever fwf is on either side', () => {
    for (const other of [...BRIDGEABLE, ...EXCLUDED]) {
      expect(canBridge('fwf', other)).toBe(false);
      expect(canBridge(other, 'fwf')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// json ↔ yaml semantic round-trip
// ---------------------------------------------------------------------------

describe('json → yaml → json semantic round-trip', () => {
  it('preserves a mixed object through real serialize/parse', () => {
    const original = {
      name: 'webcvt',
      count: 3,
      enabled: true,
      missing: null,
      nested: { a: [1, 2, 3], b: 'x' },
    };
    const jsonFile: DataTextFile = { kind: 'json', file: { value: original, hadBom: false } };

    // json -> yaml, serialize, reparse
    const yamlFile = bridge(jsonFile, 'yaml');
    if (yamlFile.kind !== 'yaml') throw new Error('unreachable');
    const reparsedYaml = parseYaml(serializeYaml(yamlFile.file));

    // yaml -> json, serialize, reparse
    const backToJson = bridge({ kind: 'yaml', file: reparsedYaml }, 'json');
    if (backToJson.kind !== 'json') throw new Error('unreachable');
    const finalValue = parseJson(serializeJson(backToJson.file)).value;

    // YAML parses integers as bigint; json import narrowed them back to number.
    expect(finalValue).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// csv ↔ json semantic round-trip + delimiter flip
// ---------------------------------------------------------------------------

describe('csv → json → csv semantic round-trip', () => {
  it('round-trips a header table exactly', () => {
    const csv: DataTextFile = {
      kind: 'csv',
      file: {
        delimiter: ',',
        headers: ['a', 'b'],
        rows: [
          { a: '1', b: '2' },
          { a: '3', b: '4' },
        ],
        hadBom: false,
      },
    };

    const json = bridge(csv, 'json');
    expect(toPlain(json)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);

    const back = bridge(json, 'csv');
    expect(back.kind).toBe('csv');
    if (back.kind !== 'csv') throw new Error('unreachable');
    expect(back.file.headers).toEqual(['a', 'b']);
    expect(back.file.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('csv ↔ tsv is a pure delimiter flip and round-trips byte-identically', () => {
    const csv: DataTextFile = {
      kind: 'csv',
      file: {
        delimiter: ',',
        headers: ['x', 'y'],
        rows: [{ x: 'a', y: 'b' }],
        hadBom: false,
      },
    };
    const tsv = bridge(csv, 'tsv');
    expect(tsv.kind).toBe('tsv');
    if (tsv.kind !== 'tsv') throw new Error('unreachable');
    expect(tsv.file.delimiter).toBe('\t');
    expect(tsv.file.headers).toEqual(['x', 'y']);

    const backToCsv = bridge(tsv, 'csv');
    if (backToCsv.kind !== 'csv') throw new Error('unreachable');
    expect(backToCsv.file.delimiter).toBe(',');
    // Serialized output matches the original csv serialization exactly.
    expect(serializeDelimited(backToCsv.file)).toBe(serializeDelimited(csv.file));
  });

  it('unions record keys and fills missing cells with the empty string', () => {
    const json: DataTextFile = {
      kind: 'json',
      file: {
        value: [
          { a: '1', b: '2' },
          { a: '3', c: '4' },
        ],
        hadBom: false,
      },
    };
    const csv = bridge(json, 'csv');
    if (csv.kind !== 'csv') throw new Error('unreachable');
    expect(csv.file.headers).toEqual(['a', 'b', 'c']);
    expect(csv.file.rows).toEqual([
      { a: '1', b: '2', c: '' },
      { a: '3', b: '', c: '4' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// csv without headers → arrays
// ---------------------------------------------------------------------------

describe('csv without headers', () => {
  it('exports as an array of scalar-string rows', () => {
    const csv: DataTextFile = {
      kind: 'csv',
      file: {
        delimiter: ',',
        headers: null,
        rows: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        hadBom: false,
      },
    };
    expect(toPlain(csv)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('imports an array of arrays as a header-less table with scalars stringified', () => {
    const file = fromPlain('csv', [
      ['a', 1, true],
      ['b', 2, false],
    ]);
    if (file.kind !== 'csv') throw new Error('unreachable');
    expect(file.file.headers).toBeNull();
    expect(file.file.rows).toEqual([
      ['a', '1', 'true'],
      ['b', '2', 'false'],
    ]);
  });

  it('imports an empty array as an empty header-less table', () => {
    const file = fromPlain('csv', []);
    if (file.kind !== 'csv') throw new Error('unreachable');
    expect(file.file.headers).toBeNull();
    expect(file.file.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nested-in-csv rejection (shape errors)
// ---------------------------------------------------------------------------

describe('csv shape rejection', () => {
  it('rejects a nested object inside a header-mode cell', () => {
    expect(() => fromPlain('csv', [{ a: '1', b: { nested: true } }])).toThrow(
      CrossFormatShapeError,
    );
  });

  it('rejects a nested array inside a header-less cell', () => {
    expect(() => fromPlain('csv', [['ok', ['nested']]])).toThrow(CrossFormatShapeError);
  });

  it('rejects a non-array root', () => {
    expect(() => fromPlain('csv', { a: 1 })).toThrow(CrossFormatShapeError);
  });

  it('rejects scalar rows (neither object nor array)', () => {
    expect(() => fromPlain('csv', ['not-a-row'])).toThrow(CrossFormatShapeError);
  });

  it('rejects a mixed array whose first row is an object but later row is an array', () => {
    expect(() => fromPlain('csv', [{ a: '1' }, ['b']])).toThrow(CrossFormatShapeError);
  });
});

// ---------------------------------------------------------------------------
// bigint safe-integer boundary (2^53 ± 1), both source formats
// ---------------------------------------------------------------------------

describe('bigint → json safe-integer boundary', () => {
  const safe = 9007199254740991n; // 2^53 - 1 === Number.MAX_SAFE_INTEGER
  const unsafe = 9007199254740993n; // 2^53 + 1

  it('yaml bigint at 2^53-1 narrows to a number', () => {
    const yaml = yamlFile({ id: safe });
    const json = bridge(yaml, 'json');
    expect(toPlain(json)).toEqual({ id: Number(safe) });
  });

  it('yaml bigint at 2^53+1 is refused (no silent precision loss)', () => {
    const yaml = yamlFile({ id: unsafe });
    expect(() => bridge(yaml, 'json')).toThrow(CrossFormatValueError);
  });

  it('toml bigint at 2^53-1 narrows to a number', () => {
    const toml: DataTextFile = { kind: 'toml', file: { value: { id: safe }, hadBom: false } };
    const json = bridge(toml, 'json');
    expect(toPlain(json)).toEqual({ id: Number(safe) });
  });

  it('toml bigint at 2^53+1 is refused', () => {
    const toml: DataTextFile = { kind: 'toml', file: { value: { id: unsafe }, hadBom: false } };
    expect(() => bridge(toml, 'json')).toThrow(CrossFormatValueError);
  });

  it('negative bigint below -(2^53-1) is refused', () => {
    const yaml = yamlFile({ id: -unsafe });
    expect(() => bridge(yaml, 'json')).toThrow(CrossFormatValueError);
  });

  it('bigint survives yaml → toml losslessly (no narrowing)', () => {
    const yaml = yamlFile({ id: unsafe });
    const toml = bridge(yaml, 'toml');
    if (toml.kind !== 'toml') throw new Error('unreachable');
    expect(toml.file.value.id).toBe(unsafe);
  });
});

// ---------------------------------------------------------------------------
// NaN / Infinity rejection for JSON targets
// ---------------------------------------------------------------------------

describe('NaN / Infinity → json rejection', () => {
  it('rejects NaN', () => {
    const yaml = yamlFile({ n: Number.NaN });
    expect(() => bridge(yaml, 'json')).toThrow(CrossFormatValueError);
  });

  it('rejects +Infinity', () => {
    const yaml = yamlFile({ n: Number.POSITIVE_INFINITY });
    expect(() => bridge(yaml, 'json')).toThrow(CrossFormatValueError);
  });

  it('rejects -Infinity', () => {
    const yaml = yamlFile({ n: Number.NEGATIVE_INFINITY });
    expect(() => bridge(yaml, 'json')).toThrow(CrossFormatValueError);
  });

  it('also rejects NaN when targeting jsonl (per-record json rules)', () => {
    const yaml = yamlFile([Number.NaN]);
    expect(() => bridge(yaml, 'jsonl')).toThrow(CrossFormatValueError);
  });
});

// ---------------------------------------------------------------------------
// TOML datetime → ISO string; TOML import rules
// ---------------------------------------------------------------------------

describe('toml temporal export → ISO 8601 strings', () => {
  it('date → YYYY-MM-DD', () => {
    const toml: DataTextFile = {
      kind: 'toml',
      file: { value: { d: { kind: 'date', year: 2020, month: 12, day: 31 } }, hadBom: false },
    };
    expect(toPlain(toml)).toEqual({ d: '2020-12-31' });
  });

  it('time → HH:MM:SS(.fraction)', () => {
    const toml: DataTextFile = {
      kind: 'toml',
      file: {
        value: { t: { kind: 'time', hour: 9, minute: 8, second: 7, fraction: '123' } },
        hadBom: false,
      },
    };
    expect(toPlain(toml)).toEqual({ t: '09:08:07.123' });
  });

  it('datetime with Z offset → ...T...Z', () => {
    const toml: DataTextFile = {
      kind: 'toml',
      file: {
        value: {
          dt: {
            kind: 'datetime',
            year: 2020,
            month: 1,
            day: 2,
            hour: 3,
            minute: 4,
            second: 5,
            fraction: null,
            offsetMinutes: 0,
          },
        },
        hadBom: false,
      },
    };
    expect(toPlain(toml)).toEqual({ dt: '2020-01-02T03:04:05Z' });
  });

  it('datetime with +05:30 offset and local (null offset)', () => {
    const mk = (offsetMinutes: number | null): TomlValue => ({
      kind: 'datetime',
      year: 2020,
      month: 1,
      day: 2,
      hour: 3,
      minute: 4,
      second: 5,
      fraction: null,
      offsetMinutes,
    });
    const toml: DataTextFile = {
      kind: 'toml',
      file: { value: { off: mk(330), local: mk(null) }, hadBom: false },
    };
    expect(toPlain(toml)).toEqual({
      off: '2020-01-02T03:04:05+05:30',
      local: '2020-01-02T03:04:05',
    });
  });
});

describe('toml import rules', () => {
  it('refuses a null value (TOML has no null type)', () => {
    expect(() => fromPlain('toml', { a: null })).toThrow(CrossFormatValueError);
  });

  it('refuses a non-object root', () => {
    expect(() => fromPlain('toml', [1, 2, 3])).toThrow(CrossFormatShapeError);
  });

  it('passes bigint / number / bool / string / arrays / nested tables', () => {
    const file = fromPlain('toml', {
      big: 12345678901234567890n,
      num: 1.5,
      flag: true,
      str: 'hi',
      list: [1, 2, 3],
      table: { nested: 'ok' },
    });
    if (file.kind !== 'toml') throw new Error('unreachable');
    expect(file.file.value.big).toBe(12345678901234567890n);
    expect(file.file.value.table).toEqual({ nested: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// INI: 2-level object + __default__ flatten
// ---------------------------------------------------------------------------

describe('ini bridge', () => {
  it('exports __default__ keys to the root and sections as nested objects', () => {
    const ini: DataTextFile = {
      kind: 'ini',
      file: {
        sections: ['__default__', 'server'],
        data: {
          __default__: { title: 'demo' },
          server: { host: 'localhost', port: '8080' },
        },
        warnings: [],
      },
    };
    expect(toPlain(ini)).toEqual({
      title: 'demo',
      server: { host: 'localhost', port: '8080' },
    });
  });

  it('imports root scalars into __default__ and objects as sections', () => {
    const file = fromPlain('ini', {
      title: 'demo',
      server: { host: 'localhost', port: 8080 },
    });
    if (file.kind !== 'ini') throw new Error('unreachable');
    expect(file.file.sections).toEqual(['__default__', 'server']);
    expect(file.file.data.__default__).toEqual({ title: 'demo' });
    expect(file.file.data.server).toEqual({ host: 'localhost', port: '8080' });
  });

  it('omits __default__ from the section list when there are no bare keys', () => {
    const file = fromPlain('ini', { server: { host: 'localhost' } });
    if (file.kind !== 'ini') throw new Error('unreachable');
    expect(file.file.sections).toEqual(['server']);
  });

  it('rejects deeper-than-2-level nesting', () => {
    expect(() => fromPlain('ini', { server: { deep: { x: 1 } } })).toThrow(CrossFormatShapeError);
  });

  it('rejects an array at the root', () => {
    expect(() => fromPlain('ini', { list: [1, 2] })).toThrow(CrossFormatShapeError);
  });

  it('rejects a non-object root', () => {
    expect(() => fromPlain('ini', 'scalar')).toThrow(CrossFormatShapeError);
  });
});

// ---------------------------------------------------------------------------
// ENV: flat map
// ---------------------------------------------------------------------------

describe('env bridge', () => {
  it('exports a flat key/value map', () => {
    const env: DataTextFile = {
      kind: 'env',
      file: { keys: ['A', 'B'], data: { A: '1', B: '2' }, warnings: [] },
    };
    expect(toPlain(env)).toEqual({ A: '1', B: '2' });
  });

  it('imports a flat object with scalars stringified', () => {
    const file = fromPlain('env', { A: 1, B: true, C: 'x' });
    if (file.kind !== 'env') throw new Error('unreachable');
    expect(file.file.keys).toEqual(['A', 'B', 'C']);
    expect(file.file.data).toEqual({ A: '1', B: 'true', C: 'x' });
  });

  it('rejects a nested value', () => {
    expect(() => fromPlain('env', { A: { nested: 1 } })).toThrow(CrossFormatShapeError);
  });

  it('rejects a non-object root', () => {
    expect(() => fromPlain('env', [1, 2])).toThrow(CrossFormatShapeError);
  });
});

// ---------------------------------------------------------------------------
// JSONL: records array vs single record
// ---------------------------------------------------------------------------

describe('jsonl bridge', () => {
  it('exports records as an array', () => {
    const jsonl: DataTextFile = {
      kind: 'jsonl',
      file: { records: [{ a: 1 }, { b: 2 }], hadBom: false, trailingNewline: true },
    };
    expect(toPlain(jsonl)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('imports an array as one record per element', () => {
    const file = fromPlain('jsonl', [{ a: 1 }, { b: 2 }]);
    if (file.kind !== 'jsonl') throw new Error('unreachable');
    expect(file.file.records).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('imports a non-array as a single record', () => {
    const file = fromPlain('jsonl', { a: 1 });
    if (file.kind !== 'jsonl') throw new Error('unreachable');
    expect(file.file.records).toEqual([{ a: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// BOM never propagates across a bridge
// ---------------------------------------------------------------------------

describe('hadBom never propagates', () => {
  it('json (hadBom:true) → yaml resets hadBom to false', () => {
    const json: DataTextFile = { kind: 'json', file: { value: { a: 1 }, hadBom: true } };
    const yaml = bridge(json, 'yaml');
    if (yaml.kind !== 'yaml') throw new Error('unreachable');
    expect(yaml.file.hadBom).toBe(false);
  });

  it('csv (hadBom:true) → json resets hadBom to false', () => {
    const csv: DataTextFile = {
      kind: 'csv',
      file: { delimiter: ',', headers: ['a'], rows: [{ a: '1' }], hadBom: true },
    };
    const json = bridge(csv, 'json');
    if (json.kind !== 'json') throw new Error('unreachable');
    expect(json.file.hadBom).toBe(false);
  });

  it('jsonl import always sets hadBom false', () => {
    const file = fromPlain('jsonl', [{ a: 1 }]);
    if (file.kind !== 'jsonl') throw new Error('unreachable');
    expect(file.file.hadBom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// xml / fwf are excluded from bridging
// ---------------------------------------------------------------------------

describe('xml / fwf exclusion', () => {
  it('toPlain throws for xml', () => {
    const xml: DataTextFile = {
      kind: 'xml',
      file: {
        root: { name: 'r', attributes: [], children: [], text: '' },
        declaredEncoding: null,
        declaredStandalone: null,
        hadBom: false,
      },
    };
    expect(() => toPlain(xml)).toThrow(CrossFormatNotSupportedError);
  });

  it('toPlain throws for fwf', () => {
    const fwf: DataTextFile = {
      kind: 'fwf',
      file: { columns: [], records: [], hadBom: false },
    };
    expect(() => toPlain(fwf)).toThrow(CrossFormatNotSupportedError);
  });

  it('fromPlain throws for xml and fwf targets', () => {
    expect(() => fromPlain('xml', { a: 1 })).toThrow(CrossFormatNotSupportedError);
    expect(() => fromPlain('fwf', { a: 1 })).toThrow(CrossFormatNotSupportedError);
  });

  it('bridge throws CrossFormatNotSupportedError when a side is xml', () => {
    const json: DataTextFile = { kind: 'json', file: { value: { a: 1 }, hadBom: false } };
    expect(() => bridge(json, 'xml')).toThrow(CrossFormatNotSupportedError);
  });
});
