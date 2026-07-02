import { describe, expect, it } from 'vitest';
import { type BatchItemResult, convertBatch } from './convert-batch.ts';
import { BackendRegistry } from './registry.ts';
import {
  type Backend,
  type ConvertResult,
  type FormatDescriptor,
  UnsupportedFormatError,
} from './types.ts';

function pngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
}

function unknownBlob(): Blob {
  return new Blob([new Uint8Array([0, 0, 0, 0])]);
}

function passthroughBackend(name: string): Backend {
  return {
    name,
    async canHandle() {
      return true;
    },
    async convert(_input: Blob, output: FormatDescriptor): Promise<ConvertResult> {
      return {
        blob: new Blob(['x'], { type: output.mime }),
        format: output,
        durationMs: 0,
        backend: name,
        hardwareAccelerated: false,
      };
    },
  };
}

/** Backend that tracks the maximum number of concurrent convert() calls. */
function trackingBackend(): { backend: Backend; maxActive: () => number } {
  let active = 0;
  let max = 0;
  return {
    maxActive: () => max,
    backend: {
      name: 'tracking',
      async canHandle() {
        return true;
      },
      async convert(_input: Blob, output: FormatDescriptor): Promise<ConvertResult> {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return {
          blob: new Blob(['x'], { type: output.mime }),
          format: output,
          durationMs: 0,
          backend: 'tracking',
          hardwareAccelerated: false,
        };
      },
    },
  };
}

function registryWith(backend: Backend): BackendRegistry {
  const r = new BackendRegistry();
  r.register(backend);
  return r;
}

describe('convertBatch', () => {
  it('returns an empty array for no items', async () => {
    expect(await convertBatch([])).toEqual([]);
  });

  it('converts every item and returns results aligned by index, with names', async () => {
    const registry = registryWith(passthroughBackend('b'));
    const items = [
      { input: pngBlob(), options: { format: 'webp' }, name: 'a.png' },
      { input: pngBlob(), options: { format: 'jpeg' }, name: 'b.png' },
      { input: pngBlob(), options: { format: 'bmp' }, name: 'c.png' },
    ];
    const results = await convertBatch(items, {}, { registry });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results.every((r) => r.result !== null && r.error === null)).toBe(true);
    expect(results.map((r) => r.result?.format.ext)).toEqual(['webp', 'jpeg', 'bmp']);
  });

  it('reports progress once per item with increasing completed counts', async () => {
    const registry = registryWith(passthroughBackend('b'));
    const seen: Array<{ completed: number; total: number }> = [];
    await convertBatch(
      [
        { input: pngBlob(), options: { format: 'webp' } },
        { input: pngBlob(), options: { format: 'webp' } },
      ],
      { onItemComplete: (_r, completed, total) => seen.push({ completed, total }) },
      { registry },
    );
    expect(seen).toHaveLength(2);
    expect(seen.map((s) => s.completed).sort()).toEqual([1, 2]);
    expect(seen.every((s) => s.total === 2)).toBe(true);
  });

  it('isolates per-item failures — one bad item does not abort the others', async () => {
    const registry = registryWith(passthroughBackend('b'));
    const results = await convertBatch(
      [
        { input: pngBlob(), options: { format: 'webp' }, name: 'good' },
        { input: unknownBlob(), options: { format: 'webp' }, name: 'bad' },
        { input: pngBlob(), options: { format: 'webp' }, name: 'good2' },
      ],
      {},
      { registry },
    );
    expect(results[0]?.result).not.toBeNull();
    expect(results[1]?.result).toBeNull();
    expect(results[1]?.error).toBeInstanceOf(Error);
    expect(results[2]?.result).not.toBeNull();
  });

  it('respects the concurrency limit', async () => {
    const { backend, maxActive } = trackingBackend();
    const registry = registryWith(backend);
    const items = Array.from({ length: 6 }, () => ({
      input: pngBlob(),
      options: { format: 'webp' },
    }));
    await convertBatch(items, { concurrency: 2 }, { registry });
    expect(maxActive()).toBeLessThanOrEqual(2);
    expect(maxActive()).toBeGreaterThan(0);
  });

  it('completes all items with concurrency 1', async () => {
    const registry = registryWith(passthroughBackend('b'));
    const items = Array.from({ length: 4 }, () => ({
      input: pngBlob(),
      options: { format: 'webp' },
    }));
    const results = await convertBatch(items, { concurrency: 1 }, { registry });
    expect(results.filter((r: BatchItemResult) => r.result !== null)).toHaveLength(4);
  });

  it('marks every item aborted when the batch signal is already aborted', async () => {
    const registry = registryWith(passthroughBackend('b'));
    const controller = new AbortController();
    controller.abort();
    const results = await convertBatch(
      [
        { input: pngBlob(), options: { format: 'webp' } },
        { input: pngBlob(), options: { format: 'webp' } },
      ],
      { signal: controller.signal },
      { registry },
    );
    expect(results.every((r) => r.result === null && r.error !== null)).toBe(true);
  });

  it('routes a text-format item via item.name when magic detection fails', async () => {
    // JSON has no magic bytes; without the item.name filename fallback this
    // item would fail with UnsupportedFormatError before reaching the registry.
    const registry = registryWith(passthroughBackend('data-backend'));
    const results = await convertBatch(
      [{ input: new Blob(['{"a":1}']), name: 'data.json', options: { format: 'yaml' } }],
      {},
      { registry },
    );
    expect(results[0]?.error).toBeNull();
    expect(results[0]?.result?.backend).toBe('data-backend');
  });

  it('still fails a text-format item whose name has no usable extension', async () => {
    const registry = registryWith(passthroughBackend('data-backend'));
    const results = await convertBatch(
      [{ input: new Blob(['{"a":1}']), name: 'no-extension', options: { format: 'yaml' } }],
      {},
      { registry },
    );
    expect(results[0]?.result).toBeNull();
    expect(results[0]?.error).toBeInstanceOf(UnsupportedFormatError);
  });
});
