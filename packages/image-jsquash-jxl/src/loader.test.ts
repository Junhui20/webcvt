/**
 * Tests for loader.ts — uses vi.mock('@jsquash/jxl') to avoid real wasm IO.
 *
 * Verifies:
 * - Double-checked Promise guard (N concurrent calls → 1 module)
 * - disposeJxl() clears singletons
 * - dispose-during-in-flight-load does not leave a stale _module
 * - Zero wasm load on barrel import (CRITICAL invariant)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockDecode,
  mockEncode,
  resetMockJsquash,
  setupMockJsquash,
} from './_test-helpers/mock-jsquash.ts';
import { JxlLoadError } from './errors.ts';

vi.mock('@jsquash/jxl', () => setupMockJsquash());

import { disposeJxl, ensureLoaded, getCachedModule, preloadJxl } from './loader.ts';

beforeEach(() => {
  disposeJxl();
  resetMockJsquash();
  vi.clearAllMocks();
});

describe('ensureLoaded — basic load', () => {
  it('returns a non-null module with decode and encode functions', async () => {
    const mod = await ensureLoaded();
    expect(mod).not.toBeNull();
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
    expect(getCachedModule()).not.toBeNull();
  });

  it('loading does not invoke decode or encode', async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureLoaded()));
    expect(mockDecode).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('ensureLoaded — error recovery', () => {
  it('allows a fresh load after dispose', async () => {
    disposeJxl();
    expect(getCachedModule()).toBeNull();
    const mod = await ensureLoaded();
    expect(mod).not.toBeNull();
  });

  it('JxlLoadError is importable (shape guard exists in doLoad)', () => {
    expect(JxlLoadError).toBeDefined();
  });
});

describe('disposeJxl', () => {
  it('clears the cached module so the next call cold-reloads', async () => {
    await ensureLoaded();
    expect(getCachedModule()).not.toBeNull();
    disposeJxl();
    expect(getCachedModule()).toBeNull();
    const mod = await ensureLoaded();
    expect(mod).not.toBeNull();
  });

  it('is idempotent', () => {
    disposeJxl();
    expect(() => disposeJxl()).not.toThrow();
  });
});

describe('disposeJxl — dispose during in-flight load', () => {
  it('does not leave a stale _module', async () => {
    disposeJxl();
    const loadPromise = ensureLoaded();
    disposeJxl();
    expect(getCachedModule()).toBeNull();
    const mod = await loadPromise;
    expect(typeof mod.decode).toBe('function');
    // KEY invariant: generation bump means the stale resolve must not write _module
    expect(getCachedModule()).toBeNull();
  });

  it('a fresh ensureLoaded() after dispose performs a clean load', async () => {
    disposeJxl();
    const firstLoad = ensureLoaded();
    disposeJxl();
    const [firstMod, secondMod] = await Promise.all([firstLoad, ensureLoaded()]);
    expect(firstMod).toBeDefined();
    expect(secondMod).toBeDefined();
    expect(getCachedModule()).not.toBeNull();
  });
});

describe('preloadJxl', () => {
  it('loads the module without decode/encode', async () => {
    await preloadJxl();
    expect(getCachedModule()).not.toBeNull();
    expect(mockDecode).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });
});

describe('zero side-effects on barrel import', () => {
  it('importing the barrel does not auto-load wasm', async () => {
    disposeJxl();
    const barrel = await import('./index.ts');
    expect(getCachedModule()).toBeNull();
    expect(typeof barrel.decodeJxl).toBe('function');
    expect(typeof barrel.registerJxlBackend).toBe('function');
  });
});
