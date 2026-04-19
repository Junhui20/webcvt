/**
 * Tests for parser.ts — top-level parseDataText dispatch.
 * TC23 (partial): parseDataText dispatches correctly for all five formats.
 */

import { describe, expect, it } from 'vitest';
import { parseDataText } from './parser.ts';

describe('parseDataText', () => {
  it('dispatches json format correctly', () => {
    const result = parseDataText('{"a":1}', 'json');
    expect(result.kind).toBe('json');
    if (result.kind === 'json') {
      expect(result.file.value).toEqual({ a: 1 });
    }
  });

  it('dispatches csv format correctly', () => {
    const result = parseDataText('a,b\n1,2\n', 'csv');
    expect(result.kind).toBe('csv');
    if (result.kind === 'csv') {
      expect(result.file.delimiter).toBe(',');
    }
  });

  it('dispatches tsv format correctly', () => {
    const result = parseDataText('a\tb\n1\t2\n', 'tsv');
    expect(result.kind).toBe('tsv');
    if (result.kind === 'tsv') {
      expect(result.file.delimiter).toBe('\t');
    }
  });

  it('dispatches ini format correctly', () => {
    const result = parseDataText('[s]\nk=v\n', 'ini');
    expect(result.kind).toBe('ini');
    if (result.kind === 'ini') {
      expect(result.file.data.s?.k).toBe('v');
    }
  });

  it('dispatches env format correctly', () => {
    const result = parseDataText('FOO=bar\n', 'env');
    expect(result.kind).toBe('env');
    if (result.kind === 'env') {
      expect(result.file.data.FOO).toBe('bar');
    }
  });

  it('passes opts to csv parser (header: true)', () => {
    const result = parseDataText('col1,col2\na,b\n', 'csv', { header: true });
    expect(result.kind).toBe('csv');
    if (result.kind === 'csv') {
      expect(result.file.headers).toEqual(['col1', 'col2']);
    }
  });

  it('passes opts to tsv parser (header: true)', () => {
    const result = parseDataText('col1\tcol2\na\tb\n', 'tsv', { header: true });
    expect(result.kind).toBe('tsv');
    if (result.kind === 'tsv') {
      expect(result.file.headers).toEqual(['col1', 'col2']);
    }
  });
});
