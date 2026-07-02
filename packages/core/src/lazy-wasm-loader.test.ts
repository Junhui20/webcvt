/**
 * Tests for createLazyWasmLoader — the shared lazy-wasm singleton skeleton.
 *
 * Uses a controllable fake "import" (a counter + a deferred) instead of a real
 * wasm module, so we can assert the double-checked guard, dispose-race
 * generation bump, and error propagation deterministically.
 */

import { describe, expect, it, vi } from 'vitest';
import { createLazyWasmLoader } from './lazy-wasm-loader.ts';

/** A minimal typed load-error used as the injected `LoadError` constructor. */
class FakeLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FakeLoadError';
  }
}

interface FakeModule {
  readonly tag: 'fake-module';
  value(): number;
}

const validModule: FakeModule = { tag: 'fake-module', value: () => 42 };

/** Builds a loader whose import is a spy so we can count invocations. */
function makeLoader(load: () => Promise<unknown>) {
  const spy = vi.fn(load);
  const loader = createLazyWasmLoader<FakeModule>({
    load: spy,
    validate: (imported) => {
      const candidate = imported as FakeModule;
      if (typeof candidate?.value !== 'function') {
        throw new TypeError('fake module missing value()');
      }
      return candidate;
    },
    LoadError: FakeLoadError,
    loadErrorMessage: 'Failed to import fake module — see error.cause for details.',
  });
  return { loader, spy };
}

describe('createLazyWasmLoader — basic load', () => {
  it('getCached is null before the first load', () => {
    const { loader } = makeLoader(async () => validModule);
    expect(loader.getCached()).toBeNull();
  });

  it('ensureLoaded resolves to the validated module', async () => {
    const { loader } = makeLoader(async () => validModule);
    const mod = await loader.ensureLoaded();
    expect(mod).toBe(validModule);
    expect(mod.value()).toBe(42);
    expect(loader.getCached()).toBe(validModule);
  });

  it('caches — a second ensureLoaded returns the same object without re-importing', async () => {
    const { loader, spy } = makeLoader(async () => validModule);
    const a = await loader.ensureLoaded();
    const b = await loader.ensureLoaded();
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preload warms the cache without returning the module', async () => {
    const { loader, spy } = makeLoader(async () => validModule);
    const result = await loader.preload();
    expect(result).toBeUndefined();
    expect(loader.getCached()).toBe(validModule);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('createLazyWasmLoader — double-load coalescing (Trap §2)', () => {
  it('10 concurrent ensureLoaded calls trigger exactly one import', async () => {
    const { loader, spy } = makeLoader(async () => validModule);
    const results = await Promise.all(Array.from({ length: 10 }, () => loader.ensureLoaded()));
    for (const mod of results) {
      expect(mod).toBe(results[0]);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('createLazyWasmLoader — dispose', () => {
  it('clears the cache so the next ensureLoaded cold-reloads (import runs again)', async () => {
    const { loader, spy } = makeLoader(async () => validModule);
    await loader.ensureLoaded();
    loader.dispose();
    expect(loader.getCached()).toBeNull();
    await loader.ensureLoaded();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is idempotent', () => {
    const { loader } = makeLoader(async () => validModule);
    loader.dispose();
    expect(() => loader.dispose()).not.toThrow();
  });
});

describe('createLazyWasmLoader — dispose-during-load race (generation bump)', () => {
  it('a dispose while a load is in flight does NOT populate the cache', async () => {
    let release!: (v: FakeModule) => void;
    const gate = new Promise<FakeModule>((resolve) => {
      release = resolve;
    });
    const { loader } = makeLoader(() => gate);

    const inFlight = loader.ensureLoaded();
    // Dispose bumps the generation before the load resolves.
    loader.dispose();
    expect(loader.getCached()).toBeNull();

    release(validModule);
    const mod = await inFlight;
    // The original caller still gets its module...
    expect(mod).toBe(validModule);
    // ...but the stale load must NOT write to the cache.
    expect(loader.getCached()).toBeNull();
  });

  it('a fresh ensureLoaded after a disposed in-flight load loads and caches normally', async () => {
    let release!: (v: FakeModule) => void;
    const gate = new Promise<FakeModule>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { loader } = makeLoader(() => {
      calls += 1;
      return calls === 1 ? gate : Promise.resolve(validModule);
    });

    const first = loader.ensureLoaded();
    loader.dispose();
    const second = loader.ensureLoaded();

    release(validModule);
    await Promise.all([first, second]);
    expect(loader.getCached()).toBe(validModule);
  });

  it('a dispose while a FAILING load is in flight leaves _loading owned by the new generation', async () => {
    let reject!: (e: unknown) => void;
    const gate = new Promise<FakeModule>((_, rej) => {
      reject = rej;
    });
    let calls = 0;
    const { loader } = makeLoader(() => {
      calls += 1;
      return calls === 1 ? gate : Promise.resolve(validModule);
    });

    const first = loader.ensureLoaded().catch(() => 'first-failed');
    loader.dispose();
    // Second load starts under the new generation and succeeds.
    const second = await loader.ensureLoaded();

    reject(new Error('boom'));
    expect(await first).toBe('first-failed');
    // The stale rejection must not clobber the cache populated by the 2nd load.
    expect(second).toBe(validModule);
    expect(loader.getCached()).toBe(validModule);
  });
});

describe('createLazyWasmLoader — error propagation', () => {
  it('wraps an import() rejection in the configured LoadError with the cause preserved', async () => {
    const cause = new Error('network down');
    const { loader } = makeLoader(async () => {
      throw cause;
    });
    await expect(loader.ensureLoaded()).rejects.toBeInstanceOf(FakeLoadError);
    await expect(loader.ensureLoaded()).rejects.toMatchObject({
      message: 'Failed to import fake module — see error.cause for details.',
      cause,
    });
  });

  it('wraps a validate() throw (bad module shape) in the configured LoadError', async () => {
    const { loader } = makeLoader(async () => ({ tag: 'fake-module' }));
    await expect(loader.ensureLoaded()).rejects.toBeInstanceOf(FakeLoadError);
    await expect(loader.ensureLoaded()).rejects.toMatchObject({
      cause: expect.any(TypeError),
    });
  });

  it('resets _loading after a failure so a later ensureLoaded retries', async () => {
    let calls = 0;
    const { loader, spy } = makeLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return validModule;
    });

    await expect(loader.ensureLoaded()).rejects.toBeInstanceOf(FakeLoadError);
    const mod = await loader.ensureLoaded();
    expect(mod).toBe(validModule);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
