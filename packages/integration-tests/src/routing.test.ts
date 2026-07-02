/**
 * Routing truth — every backend registered by `makeRegistry()` must resolve and
 * complete at least one real conversion driven through core `convert()`. This is
 * the gap the package exists to close: core cannot depend on backends, so this
 * is the only place `convert()` meets real backends. Each case asserts on the
 * OUTPUT CONTENT (parsed back), not merely "did not throw".
 */

import { parseZip } from '@catlabtech/webcvt-archive-zip';
import { parseWav } from '@catlabtech/webcvt-container-wav';
import { type FormatDescriptor, convert } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';

import {
  blobBytes,
  bytesToBlob,
  makeEmlBlob,
  makeRegistry,
  makeSrtBlob,
  makeTtfBlob,
  makeWavBlob,
  makeZipBlob,
} from './_helpers.ts';

// txt is not in core's curated format registry (it has no magic bytes and
// overlaps text/plain), so email/epub-style txt targets are addressed with an
// explicit descriptor rather than a string ext.
const TXT: FormatDescriptor = { ext: 'txt', mime: 'text/plain', category: 'email' };

const EXPECTED_BACKENDS = [
  'container-wav',
  'subtitle',
  'data-text',
  'archive-zip',
  'email',
  'font',
] as const;

describe('registry wiring', () => {
  it('registers exactly the Node-safe backends, each with a unique name', () => {
    const names = makeRegistry()
      .list()
      .map((b) => b.name)
      .sort();
    expect(names).toEqual([...EXPECTED_BACKENDS].sort());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('routing truth: each backend resolves + completes a conversion', () => {
  it('container-wav: wav → wav (identity re-mux) round-trips through parseWav', async () => {
    const registry = makeRegistry();
    const out = await convert(makeWavBlob(), { format: 'wav', inputFormat: 'wav' }, { registry });

    expect(out.backend).toBe('container-wav');
    expect(out.format.mime).toBe('audio/wav');
    const parsed = parseWav(await blobBytes(out.blob));
    expect(parsed.format.sampleRate).toBe(8000);
    expect(parsed.format.channels).toBe(1);
  });

  it('subtitle: srt → vtt emits a WEBVTT document preserving cue text', async () => {
    const registry = makeRegistry();
    const out = await convert(makeSrtBlob(), { format: 'vtt', inputFormat: 'srt' }, { registry });

    expect(out.backend).toBe('subtitle');
    const text = await out.blob.text();
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('Hello world');
    expect(text).toContain('Second line');
    // VTT uses '.' millisecond separators; SRT uses ','.
    expect(text).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('data-text: json → yaml routes via the value bridge (round-trips back to json)', async () => {
    const registry = makeRegistry();
    const source = { name: 'webcvt', version: 2, nested: { ok: true } };
    const jsonBlob = new Blob([JSON.stringify(source)], { type: 'application/json' });

    const yaml = await convert(jsonBlob, { format: 'yaml', inputFormat: 'json' }, { registry });
    expect(yaml.backend).toBe('data-text');
    expect(yaml.format.mime).toBe('application/yaml');

    // Parse the YAML back to JSON through the same pipeline and compare values.
    const yamlBlob = new Blob([await yaml.blob.text()], { type: 'application/yaml' });
    const json = await convert(yamlBlob, { format: 'json', inputFormat: 'yaml' }, { registry });
    expect(JSON.parse(await json.blob.text())).toEqual(source);
  });

  it('archive-zip: zip → zip (identity) round-trips through parseZip', async () => {
    const registry = makeRegistry();
    const zip = await makeZipBlob([['greeting.txt', 'hello world']]);

    const out = await convert(zip, { format: 'zip', inputFormat: 'zip' }, { registry });
    expect(out.backend).toBe('archive-zip');

    const parsed = parseZip(await blobBytes(out.blob));
    expect(parsed.entries.map((e) => e.name)).toEqual(['greeting.txt']);
    const firstEntry = parsed.entries[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry) {
      expect(new TextDecoder().decode(await firstEntry.data())).toBe('hello world');
    }
  });

  it('email: eml → txt extracts the plain-text body', async () => {
    const registry = makeRegistry();
    const out = await convert(makeEmlBlob(), { format: TXT, inputFormat: 'eml' }, { registry });

    expect(out.backend).toBe('email');
    expect(await out.blob.text()).toContain('Hello from the webcvt integration suite.');
  });

  it('email: eml → json produces a parseable structured message', async () => {
    const registry = makeRegistry();
    const out = await convert(makeEmlBlob(), { format: 'json', inputFormat: 'eml' }, { registry });

    expect(out.backend).toBe('email');
    const parsed = JSON.parse(await out.blob.text()) as { subject?: string };
    expect(parsed.subject).toBe('Integration test');
  });

  it('font: ttf → woff produces a valid WOFF 1.0 container (wOFF signature)', async () => {
    const registry = makeRegistry();
    const out = await convert(makeTtfBlob(), { format: 'woff', inputFormat: 'ttf' }, { registry });

    expect(out.backend).toBe('font');
    expect(out.format.mime).toBe('font/woff');
    const bytes = await blobBytes(out.blob);
    // WOFF 1.0 signature is the ASCII tag "wOFF".
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('wOFF');

    // And it re-imports back to an sfnt (0x00010000 TrueType magic).
    const woffBlob = bytesToBlob(bytes, 'font/woff');
    const ttf = await convert(woffBlob, { format: 'ttf', inputFormat: 'woff' }, { registry });
    const sfnt = await blobBytes(ttf.blob);
    expect([...sfnt.slice(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });
});
