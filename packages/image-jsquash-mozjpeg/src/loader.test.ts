/**
 * Tests for loader.ts — uses vi.mock('@jsquash/jpeg') to avoid real wasm IO.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockDecode,
  mockEncode,
  resetMockJsquash,
  setupMockJsquash,
} from './_test-helpers/mock-jsquash.ts';
import { MozjpegLoadError } from './errors.ts';

vi.mock('@jsquash/jpeg', () => setupMockJsquash());

import { disposeMozjpeg, ensureLoaded, getCachedModule, preloadMozjpeg } from './loader.ts';

beforeEach(() => {
  disposeMozjpeg();
  resetMockJsquash();
  vi.clearAllMocks();
});

describe('ensureLoaded — basic load', () => {
  it('returns a non-null module with decode and encode functions', async () => {
    const mod = await ensureLoaded();
    expect(typeof mod.decode).toBe('function');
    expect(typeof mod.encode).toBe('function');
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

  it('loading does not invoke decode or encode', async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureLoaded()));
    expect(mockDecode).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('disposeMozjpeg', () => {
  it('clears the cached module so the next call cold-reloads', async () => {
    await ensureLoaded();
    expect(getCachedModule()).not.toBeNull();
    disposeMozjpeg();
    expect(getCachedModule()).toBeNull();
    expect(await ensureLoaded()).not.toBeNull();
  });

  it('is idempotent', () => {
    disposeMozjpeg();
    expect(() => disposeMozjpeg()).not.toThrow();
  });

  it('MozjpegLoadError is importable (shape guard exists in doLoad)', () => {
    expect(MozjpegLoadError).toBeDefined();
  });
});

describe('disposeMozjpeg — dispose during in-flight load', () => {
  it('does not leave a stale _module', async () => {
    disposeMozjpeg();
    const loadPromise = ensureLoaded();
    disposeMozjpeg();
    expect(getCachedModule()).toBeNull();
    const mod = await loadPromise;
    expect(typeof mod.decode).toBe('function');
    expect(getCachedModule()).toBeNull();
  });
});

describe('preloadMozjpeg', () => {
  it('loads the module without decode/encode', async () => {
    await preloadMozjpeg();
    expect(getCachedModule()).not.toBeNull();
    expect(mockDecode).not.toHaveBeenCalled();
  });
});

describe('zero side-effects on barrel import', () => {
  it('importing the barrel does not auto-load wasm', async () => {
    disposeMozjpeg();
    const barrel = await import('./index.ts');
    expect(getCachedModule()).toBeNull();
    expect(typeof barrel.decodeMozjpeg).toBe('function');
    expect(typeof barrel.registerMozjpegBackend).toBe('function');
  });
});
