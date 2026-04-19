/**
 * Tests for backend.ts — DataTextBackend.
 */

import { describe, expect, it } from 'vitest';
import {
  CSV_FORMAT,
  DataTextBackend,
  ENV_FORMAT,
  INI_FORMAT,
  JSON_FORMAT,
  TSV_FORMAT,
} from './backend.ts';

const backend = new DataTextBackend();

describe('DataTextBackend.canHandle', () => {
  it('accepts JSON → JSON (identity)', async () => {
    expect(await backend.canHandle(JSON_FORMAT, JSON_FORMAT)).toBe(true);
  });

  it('accepts CSV → CSV (identity)', async () => {
    expect(await backend.canHandle(CSV_FORMAT, CSV_FORMAT)).toBe(true);
  });

  it('accepts TSV → TSV (identity)', async () => {
    expect(await backend.canHandle(TSV_FORMAT, TSV_FORMAT)).toBe(true);
  });

  it('accepts INI → INI (identity)', async () => {
    expect(await backend.canHandle(INI_FORMAT, INI_FORMAT)).toBe(true);
  });

  it('accepts ENV → ENV (identity)', async () => {
    expect(await backend.canHandle(ENV_FORMAT, ENV_FORMAT)).toBe(true);
  });

  it('rejects JSON → CSV (cross-format)', async () => {
    expect(await backend.canHandle(JSON_FORMAT, CSV_FORMAT)).toBe(false);
  });

  it('rejects CSV → JSON (cross-format)', async () => {
    expect(await backend.canHandle(CSV_FORMAT, JSON_FORMAT)).toBe(false);
  });

  it('rejects unknown MIME type', async () => {
    const unknown = { ext: 'xyz', mime: 'application/x-unknown', category: 'data' as const };
    expect(await backend.canHandle(unknown, unknown)).toBe(false);
  });

  it('has name data-text', () => {
    expect(backend.name).toBe('data-text');
  });
});

describe('DataTextBackend format descriptors', () => {
  it('JSON_FORMAT has correct MIME and ext', () => {
    expect(JSON_FORMAT.mime).toBe('application/json');
    expect(JSON_FORMAT.ext).toBe('json');
  });

  it('CSV_FORMAT has correct MIME and ext', () => {
    expect(CSV_FORMAT.mime).toBe('text/csv');
    expect(CSV_FORMAT.ext).toBe('csv');
  });

  it('TSV_FORMAT has correct MIME and ext', () => {
    expect(TSV_FORMAT.mime).toBe('text/tab-separated-values');
    expect(TSV_FORMAT.ext).toBe('tsv');
  });

  it('INI_FORMAT has correct MIME and ext', () => {
    expect(INI_FORMAT.ext).toBe('ini');
  });

  it('ENV_FORMAT has correct ext', () => {
    expect(ENV_FORMAT.ext).toBe('env');
  });
});
