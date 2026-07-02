/**
 * Tests for backend.ts — DataTextBackend.
 */

import { BackendRegistry } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  CSV_FORMAT,
  DataTextBackend,
  ENV_FORMAT,
  INI_FORMAT,
  JSON_FORMAT,
  TSV_FORMAT,
  YAML_FORMAT,
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

  it('accepts JSON → CSV (cross-format, bridgeable)', async () => {
    expect(await backend.canHandle(JSON_FORMAT, CSV_FORMAT)).toBe(true);
  });

  it('accepts CSV → JSON (cross-format, bridgeable)', async () => {
    expect(await backend.canHandle(CSV_FORMAT, JSON_FORMAT)).toBe(true);
  });

  it('accepts JSON → YAML (cross-format, bridgeable)', async () => {
    expect(await backend.canHandle(JSON_FORMAT, YAML_FORMAT)).toBe(true);
  });

  it('rejects unknown MIME type', async () => {
    const unknown = { ext: 'xyz', mime: 'application/x-unknown', category: 'data' as const };
    expect(await backend.canHandle(unknown, unknown)).toBe(false);
  });

  it('has name data-text', () => {
    expect(backend.name).toBe('data-text');
  });
});

describe('DataTextBackend.canHandle — cross-format XML/FWF exclusion', () => {
  const XML_FORMAT = { ext: 'xml', mime: 'application/xml', category: 'data' as const };

  it('rejects XML → JSON (xml is excluded from bridging)', async () => {
    expect(await backend.canHandle(XML_FORMAT, JSON_FORMAT)).toBe(false);
  });

  it('rejects JSON → XML (xml is excluded from bridging)', async () => {
    expect(await backend.canHandle(JSON_FORMAT, XML_FORMAT)).toBe(false);
  });

  it('still accepts XML → XML (identity)', async () => {
    expect(await backend.canHandle(XML_FORMAT, XML_FORMAT)).toBe(true);
  });
});

describe('DataTextBackend.canHandle — text/plain (ENV) hazard gating', () => {
  // A generic text/plain descriptor that is NOT declared as env.
  const PLAIN_TEXT = { ext: 'txt', mime: 'text/plain', category: 'data' as const };

  it('accepts ENV → JSON only when the ENV side declares ext="env"', async () => {
    expect(await backend.canHandle(ENV_FORMAT, JSON_FORMAT)).toBe(true);
  });

  it('rejects text/plain (ext≠env) → JSON for cross-format', async () => {
    expect(await backend.canHandle(PLAIN_TEXT, JSON_FORMAT)).toBe(false);
  });

  it('rejects JSON → text/plain (ext≠env) for cross-format', async () => {
    expect(await backend.canHandle(JSON_FORMAT, PLAIN_TEXT)).toBe(false);
  });

  it('accepts JSON → ENV when the ENV side declares ext="env"', async () => {
    expect(await backend.canHandle(JSON_FORMAT, ENV_FORMAT)).toBe(true);
  });

  it('still accepts text/plain → text/plain identity regardless of ext', async () => {
    expect(await backend.canHandle(PLAIN_TEXT, PLAIN_TEXT)).toBe(true);
  });
});

describe('DataTextBackend.convert — cross-format', () => {
  it('bridges JSON → YAML end-to-end and emits a bridge progress phase', async () => {
    const phases: string[] = [];
    const blob = new Blob([JSON.stringify({ name: 'webcvt', count: 3 })], {
      type: 'application/json',
    });

    const result = await backend.convert(blob, YAML_FORMAT, {
      format: YAML_FORMAT,
      onProgress: (p) => {
        if (p.phase !== undefined) phases.push(p.phase);
      },
    });

    expect(result.backend).toBe('data-text');
    expect(result.format).toBe(YAML_FORMAT);
    expect(phases).toContain('bridge');

    const yamlText = await result.blob.text();
    expect(yamlText).toContain('name: webcvt');
    expect(yamlText).toContain('count: 3');
  });

  it('identity JSON → JSON does NOT emit a bridge phase (byte path unchanged)', async () => {
    const phases: string[] = [];
    const blob = new Blob(['{"a":1}'], { type: 'application/json' });

    await backend.convert(blob, JSON_FORMAT, {
      format: JSON_FORMAT,
      onProgress: (p) => {
        if (p.phase !== undefined) phases.push(p.phase);
      },
    });

    expect(phases).not.toContain('bridge');
  });
});

describe('DataTextBackend registry integration', () => {
  it('findFor resolves the backend for a cross-format pair and convert() bridges', async () => {
    // Fresh registry for isolation (no reliance on the default process registry).
    const registry = new BackendRegistry();
    registry.register(new DataTextBackend());

    const found = await registry.findFor(JSON_FORMAT, YAML_FORMAT);
    expect(found?.name).toBe('data-text');

    const blob = new Blob([JSON.stringify({ hello: 'world' })], { type: 'application/json' });
    const result = await found?.convert(blob, YAML_FORMAT, { format: YAML_FORMAT });
    expect(result).toBeDefined();
    expect(await result?.blob.text()).toContain('hello: world');
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
