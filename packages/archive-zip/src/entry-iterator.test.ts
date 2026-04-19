/**
 * Tests for lazy entry iterators (ZIP and TAR).
 */

import { describe, expect, it } from 'vitest';
import { buildTar } from './_test-helpers/build-tar.ts';
import { buildZip } from './_test-helpers/build-zip.ts';
import { iterateTar, iterateTarAll, iterateZip, iterateZipAll } from './entry-iterator.ts';
import { parseTar } from './tar-parser.ts';
import { parseZip } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// ZIP iterators
// ---------------------------------------------------------------------------

describe('iterateZip', () => {
  it('yields file entries with data', async () => {
    const zip = buildZip([
      { name: 'a.txt', bytes: new TextEncoder().encode('alpha') },
      { name: 'b.txt', bytes: new TextEncoder().encode('beta') },
    ]);
    const file = parseZip(zip);
    const collected: { name: string; text: string }[] = [];
    for await (const { entry, data } of iterateZip(file)) {
      collected.push({ name: entry.name, text: new TextDecoder().decode(data) });
    }
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ name: 'a.txt', text: 'alpha' });
    expect(collected[1]).toEqual({ name: 'b.txt', text: 'beta' });
  });

  it('skips directory entries', async () => {
    const zip = buildZip([
      { name: 'dir/', isDirectory: true },
      { name: 'dir/file.txt', bytes: new TextEncoder().encode('x') },
    ]);
    const file = parseZip(zip);
    const names: string[] = [];
    for await (const { entry } of iterateZip(file)) {
      names.push(entry.name);
    }
    expect(names).toEqual(['dir/file.txt']);
  });

  it('yields nothing for empty archive', async () => {
    const file = parseZip(buildZip([]));
    const results: unknown[] = [];
    for await (const item of iterateZip(file)) {
      results.push(item);
    }
    expect(results).toHaveLength(0);
  });
});

describe('iterateZipAll', () => {
  it('yields directory entries with null data', async () => {
    const zip = buildZip([
      { name: 'dir/', isDirectory: true },
      { name: 'dir/f.txt', bytes: new TextEncoder().encode('x') },
    ]);
    const file = parseZip(zip);
    const results: { name: string; hasData: boolean }[] = [];
    for await (const { entry, data } of iterateZipAll(file)) {
      results.push({ name: entry.name, hasData: data !== null });
    }
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'dir/', hasData: false });
    expect(results[1]).toEqual({ name: 'dir/f.txt', hasData: true });
  });
});

// ---------------------------------------------------------------------------
// TAR iterators
// ---------------------------------------------------------------------------

describe('iterateTar', () => {
  it('yields file entries with data', async () => {
    const tar = buildTar([
      { name: 'x.txt', bytes: new TextEncoder().encode('hello') },
      { name: 'y.txt', bytes: new TextEncoder().encode('world') },
    ]);
    const file = parseTar(tar);
    const collected: { name: string; text: string }[] = [];
    for await (const { entry, data } of iterateTar(file)) {
      collected.push({ name: entry.name, text: new TextDecoder().decode(data) });
    }
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ name: 'x.txt', text: 'hello' });
    expect(collected[1]).toEqual({ name: 'y.txt', text: 'world' });
  });

  it('skips directory entries', async () => {
    const tar = buildTar([
      { name: 'mydir/', isDirectory: true },
      { name: 'mydir/f.txt', bytes: new TextEncoder().encode('q') },
    ]);
    const file = parseTar(tar);
    const names: string[] = [];
    for await (const { entry } of iterateTar(file)) {
      names.push(entry.name);
    }
    expect(names).toEqual(['mydir/f.txt']);
  });

  it('yields nothing for empty archive', async () => {
    const tar = new Uint8Array(1024); // two zero EOA blocks
    const file = parseTar(tar);
    const results: unknown[] = [];
    for await (const item of iterateTar(file)) {
      results.push(item);
    }
    expect(results).toHaveLength(0);
  });
});

describe('iterateTarAll', () => {
  it('yields directory entries with null data', async () => {
    const tar = buildTar([
      { name: 'subdir/', isDirectory: true },
      { name: 'subdir/g.txt', bytes: new TextEncoder().encode('z') },
    ]);
    const file = parseTar(tar);
    const results: { name: string; hasData: boolean }[] = [];
    for await (const { entry, data } of iterateTarAll(file)) {
      results.push({ name: entry.name, hasData: data !== null });
    }
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'subdir/', hasData: false });
    expect(results[1]).toEqual({ name: 'subdir/g.txt', hasData: true });
  });
});
