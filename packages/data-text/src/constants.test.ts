import { describe, expect, it } from 'vitest';
import {
  MAX_CSV_COLS,
  MAX_CSV_ROWS,
  MAX_ENV_KEYS,
  MAX_INI_KEYS,
  MAX_INI_SECTIONS,
  MAX_INPUT_BYTES,
  MAX_INPUT_CHARS,
  MAX_JSON_DEPTH,
} from './constants.ts';

describe('constants', () => {
  it('MAX_INPUT_BYTES is 10 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(10 * 1024 * 1024);
  });

  it('MAX_INPUT_CHARS is 10_485_760', () => {
    expect(MAX_INPUT_CHARS).toBe(10_485_760);
  });

  it('MAX_JSON_DEPTH is 256', () => {
    expect(MAX_JSON_DEPTH).toBe(256);
  });

  it('MAX_CSV_ROWS is 1_000_000', () => {
    expect(MAX_CSV_ROWS).toBe(1_000_000);
  });

  it('MAX_CSV_COLS is 1024', () => {
    expect(MAX_CSV_COLS).toBe(1024);
  });

  it('MAX_INI_SECTIONS is 1024', () => {
    expect(MAX_INI_SECTIONS).toBe(1024);
  });

  it('MAX_INI_KEYS is 100_000', () => {
    expect(MAX_INI_KEYS).toBe(100_000);
  });

  it('MAX_ENV_KEYS is 100_000', () => {
    expect(MAX_ENV_KEYS).toBe(100_000);
  });
});
