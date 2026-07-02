/**
 * Generic lazy-loading singleton for wasm (or any async-imported) modules.
 *
 * The `image-jsquash-*` and `image-heic` packages each lazy-load an optional
 * wasm peer dependency (`@jsquash/*`, `libheif-js`) with an identical skeleton:
 *
 * - a module-level singleton that is `null` until first use;
 * - a **double-checked Promise guard** so N concurrent first-callers all share
 *   one in-flight `import()` (Trap §2 — "10 concurrent = 1 import");
 * - a **generation counter** so that disposing while a load is in flight does
 *   not resurrect a stale module (the dispose-during-load race);
 * - `ensureLoaded` / `dispose` / `preload` / `getCached` accessors.
 *
 * This factory captures that skeleton once. It is deliberately **DOM-free**
 * (core runs in Node): it never touches `OffscreenCanvas`, `ImageData`, or any
 * browser global. The *what to import* and *how to validate it* are injected by
 * the caller so the wasm peer's specifier stays in the consuming package (the
 * `import()` call site must live there for bundlers to keep it external and for
 * `vi.mock` to intercept it in tests).
 *
 * @module
 */

/** Configuration for {@link createLazyWasmLoader}. */
export interface LazyWasmLoaderConfig<T> {
  /**
   * Dynamic-import thunk that fetches the raw module. MUST use `import()` (never
   * a static import) so the wasm payload only loads on first use and the bundler
   * keeps the peer dependency external.
   *
   * @example () => import('@jsquash/avif')
   */
  readonly load: () => Promise<unknown>;
  /**
   * Narrows the freshly imported value to `T`. Throw here (e.g. `TypeError`)
   * when the expected exports are missing; the throw is caught and re-wrapped by
   * {@link LazyWasmLoaderConfig.LoadError}. May also unwrap a CJS default
   * (`imported.default ?? imported`).
   */
  readonly validate: (imported: unknown) => T;
  /**
   * The consuming package's typed load-error constructor. Any failure from
   * {@link LazyWasmLoaderConfig.load} or {@link LazyWasmLoaderConfig.validate} is
   * wrapped as `new LoadError(loadErrorMessage, { cause })` so the original
   * failure is preserved on `error.cause`.
   */
  readonly LoadError: new (
    message: string,
    options?: ErrorOptions,
  ) => Error;
  /** Message passed to {@link LazyWasmLoaderConfig.LoadError} on any load failure. */
  readonly loadErrorMessage: string;
}

/** The public surface returned by {@link createLazyWasmLoader}. */
export interface LazyWasmLoader<T> {
  /**
   * Ensures the module is loaded and returns it. Double-checked Promise guard:
   * repeat/concurrent callers share a single in-flight `import()`.
   *
   * @throws the configured `LoadError` (with `.cause`) if loading/validation fails.
   */
  ensureLoaded(): Promise<T>;
  /**
   * Clears the cached module and any in-flight load. The next `ensureLoaded()`
   * cold-reloads. Race-safe: a load already in flight still resolves for its
   * callers but will NOT populate the cache (the generation counter is bumped).
   */
  dispose(): void;
  /** Warms the module without using it (just awaits `ensureLoaded`). */
  preload(): Promise<void>;
  /** Returns the cached module, or `null` when not loaded. */
  getCached(): T | null;
}

/**
 * Creates a lazy, single-flight loader for an async-imported module.
 *
 * @typeParam T - The validated module shape.
 * @param config - Import thunk, validator, and typed load-error constructor.
 * @returns A {@link LazyWasmLoader} exposing ensure/dispose/preload/getCached.
 */
export function createLazyWasmLoader<T>(config: LazyWasmLoaderConfig<T>): LazyWasmLoader<T> {
  const { load, validate, LoadError, loadErrorMessage } = config;

  // Module-level singletons for this loader instance.
  let _module: T | null = null;
  let _loading: Promise<T> | null = null;

  /**
   * Generation counter for dispose-during-load race safety. Bumped on every
   * dispose(). If it changes between the start and end of a load, the resolved
   * module is returned to callers but is NOT written to the cache (stale load).
   */
  let _generation = 0;

  async function doLoad(): Promise<T> {
    // The import + validation both run inside the load-error boundary so any
    // failure surfaces as the package's typed LoadError with `.cause` set.
    try {
      const imported = await load();
      return validate(imported);
    } catch (err) {
      throw new LoadError(loadErrorMessage, { cause: err });
    }
  }

  async function ensureLoaded(): Promise<T> {
    // Check 1: already loaded — return immediately.
    if (_module !== null) {
      return _module;
    }
    // Check 2: a load is already in progress — join it.
    if (_loading !== null) {
      return _loading;
    }

    // Start a new load; capture the generation so dispose-during-load is safe.
    const myGen = ++_generation;
    _loading = doLoad().then((mod) => {
      if (myGen === _generation) {
        _module = mod;
      }
      return mod;
    });

    _loading.catch(() => {
      // Reset _loading on failure so callers can retry after a failed load —
      // but only if no dispose() has since superseded this load.
      if (myGen === _generation) {
        _loading = null;
      }
    });

    return _loading;
  }

  function dispose(): void {
    _module = null;
    _loading = null;
    _generation++;
  }

  async function preload(): Promise<void> {
    await ensureLoaded();
  }

  function getCached(): T | null {
    return _module;
  }

  return { ensureLoaded, dispose, preload, getCached };
}
