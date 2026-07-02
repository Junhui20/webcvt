/**
 * convertBatch — a mixed batch (a binary item that auto-detects by magic bytes
 * plus a text item routed by its `name`) completes with index-aligned results,
 * and a failure on one item is isolated to that item.
 */

import { parseWav } from '@catlabtech/webcvt-container-wav';
import { type BatchItem, convertBatch } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';

import { blobBytes, makeRegistry, makeWavBlob } from './_helpers.ts';

describe('convertBatch across backends', () => {
  it('completes a mixed binary + text batch with index-aligned results', async () => {
    const registry = makeRegistry();
    const source = { name: 'webcvt', version: 2 };
    const items: BatchItem[] = [
      // Binary: typed WAV, auto-detected by RIFF/WAVE magic bytes (no inputFormat).
      { input: makeWavBlob(), options: { format: 'wav' }, name: 'clip.wav' },
      // Text: typeless JSON, routed via the item `name` extension fallback.
      { input: new Blob([JSON.stringify(source)]), options: { format: 'yaml' }, name: 'data.json' },
    ];

    const results = await convertBatch(items, {}, { registry });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.index)).toEqual([0, 1]);
    expect(results.map((r) => r.name)).toEqual(['clip.wav', 'data.json']);
    expect(results.every((r) => r.error === null && r.result !== null)).toBe(true);

    const wavResult = results[0]?.result;
    expect(wavResult?.backend).toBe('container-wav');
    if (wavResult) {
      expect(parseWav(await blobBytes(wavResult.blob)).format.sampleRate).toBe(8000);
    }

    const yamlResult = results[1]?.result;
    expect(yamlResult?.backend).toBe('data-text');
    expect(await yamlResult?.blob.text()).toContain('name');
  });

  it('isolates a failing item without aborting its successful siblings', async () => {
    const registry = makeRegistry();
    const items: BatchItem[] = [
      { input: makeWavBlob(), options: { format: 'wav', inputFormat: 'wav' }, name: 'ok.wav' },
      // No backend converts wav → png in this registry → this item fails.
      { input: makeWavBlob(), options: { format: 'png', inputFormat: 'wav' }, name: 'bad.png' },
    ];

    const results = await convertBatch(items, {}, { registry });

    expect(results[0]?.result?.backend).toBe('container-wav');
    expect(results[0]?.error).toBeNull();
    expect(results[1]?.result).toBeNull();
    expect(results[1]?.error).toBeInstanceOf(Error);
  });
});
