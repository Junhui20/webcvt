/**
 * Tests for loader.ts — uses vi.mock('@jsquash/oxipng') to avoid real wasm IO.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockOptimise, resetMockJsquash, setupMockJsquash } from './_test-helpers/mock-jsquash.ts';
import { OxipngLoadError } from './errors.ts';

vi.mock('@jsquash/oxipng', () => setupMockJsquash());

import { disposeOxipng, ensureLoaded, getCachedModule, preloadOxipng } from './loader.ts';

beforeEach(() => {
  disposeOxipng();
  resetMockJsquash();
  vi.clearAllMocks();
});

describe('ensureLoaded — basic load', () => {
  it('returns a non-null module with an optimise function', async () => {
    const mod = await ensureLoaded();
    expect(typeof mod.optimise).toBe('function');
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
    for (const mod of results) {
      expect(mod).toBe(first);
    }
  });

  it('loading does not invoke optimise', async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureLoaded()));
    expect(mockOptimise).not.toHaveBeenCalled();
  });
});

describe('disposeOxipng', () => {
  it('clears the cached module so the next call cold-reloads', async () => {
    await ensureLoaded();
    expect(getCachedModule()).not.toBeNull();
    disposeOxipng();
    expect(getCachedModule()).toBeNull();
    expect(await ensureLoaded()).not.toBeNull();
  });

  it('is idempotent', () => {
    disposeOxipng();
    expect(() => disposeOxipng()).not.toThrow();
  });

  it('OxipngLoadError is importable (shape guard exists in doLoad)', () => {
    expect(OxipngLoadError).toBeDefined();
  });
});

describe('disposeOxipng — dispose during in-flight load', () => {
  it('does not leave a stale _module', async () => {
    disposeOxipng();
    const loadPromise = ensureLoaded();
    disposeOxipng();
    expect(getCachedModule()).toBeNull();
    const mod = await loadPromise;
    expect(typeof mod.optimise).toBe('function');
    expect(getCachedModule()).toBeNull();
  });
});

describe('preloadOxipng', () => {
  it('loads the module without optimising', async () => {
    await preloadOxipng();
    expect(getCachedModule()).not.toBeNull();
    expect(mockOptimise).not.toHaveBeenCalled();
  });
});

describe('zero side-effects on barrel import', () => {
  it('importing the barrel does not auto-load wasm', async () => {
    disposeOxipng();
    const barrel = await import('./index.ts');
    expect(getCachedModule()).toBeNull();
    expect(typeof barrel.optimisePng).toBe('function');
    expect(typeof barrel.registerOxipngBackend).toBe('function');
  });
});
