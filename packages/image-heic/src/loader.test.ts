/**
 * Tests for loader.ts — uses vi.mock('libheif-js/wasm-bundle') to avoid real wasm IO.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockLibheif, setupMockLibheif } from './_test-helpers/mock-libheif.ts';
import { HeicLoadError } from './errors.ts';

vi.mock('libheif-js/wasm-bundle', () => setupMockLibheif());

import { disposeHeic, ensureLoaded, getCachedModule, preloadHeic } from './loader.ts';

beforeEach(() => {
  disposeHeic();
  resetMockLibheif();
  vi.clearAllMocks();
});

describe('ensureLoaded — basic load', () => {
  it('returns a module exposing HeifDecoder', async () => {
    const mod = await ensureLoaded();
    expect(typeof mod.HeifDecoder).toBe('function');
  });

  it('caches the module — repeated calls return the same object', async () => {
    const a = await ensureLoaded();
    const b = await ensureLoaded();
    expect(a).toBe(b);
    expect(getCachedModule()).not.toBeNull();
  });
});

describe('ensureLoaded — lazy-load race', () => {
  it('10 concurrent calls resolve to the same module object', async () => {
    expect(getCachedModule()).toBeNull();
    const results = await Promise.all(Array.from({ length: 10 }, () => ensureLoaded()));
    const first = results[0];
    for (const mod of results) expect(mod).toBe(first);
  });
});

describe('disposeHeic', () => {
  it('clears the cached module so the next call cold-reloads', async () => {
    await ensureLoaded();
    expect(getCachedModule()).not.toBeNull();
    disposeHeic();
    expect(getCachedModule()).toBeNull();
    expect(await ensureLoaded()).not.toBeNull();
  });

  it('is idempotent', () => {
    disposeHeic();
    expect(() => disposeHeic()).not.toThrow();
  });

  it('HeicLoadError is importable (shape guard exists in doLoad)', () => {
    expect(HeicLoadError).toBeDefined();
  });
});

describe('disposeHeic — dispose during in-flight load', () => {
  it('does not leave a stale module', async () => {
    disposeHeic();
    const loadPromise = ensureLoaded();
    disposeHeic();
    expect(getCachedModule()).toBeNull();
    const mod = await loadPromise;
    expect(typeof mod.HeifDecoder).toBe('function');
    expect(getCachedModule()).toBeNull();
  });
});

describe('preloadHeic + barrel', () => {
  it('preloadHeic loads the module', async () => {
    await preloadHeic();
    expect(getCachedModule()).not.toBeNull();
  });

  it('importing the barrel does not auto-load wasm', async () => {
    disposeHeic();
    const barrel = await import('./index.ts');
    expect(getCachedModule()).toBeNull();
    expect(typeof barrel.decodeHeic).toBe('function');
    expect(typeof barrel.registerHeicBackend).toBe('function');
  });
});
