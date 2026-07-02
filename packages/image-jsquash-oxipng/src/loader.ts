/**
 * Lazy @jsquash/oxipng loader for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/oxipng (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeOxipng(), both the cached module AND the in-flight load are
 *   cleared so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * The shared lazy-load skeleton (singleton, double-checked guard, dispose-race
 * generation counter) lives in core's createLazyWasmLoader; this file only
 * supplies the @jsquash/oxipng dynamic import, the shape validator, and the
 * OxipngLoadError constructor.
 */

import { createLazyWasmLoader } from '@catlabtech/webcvt-core';
import { OxipngLoadError } from './errors.ts';

/**
 * Minimal structural type for the @jsquash/oxipng module.
 * Matches @jsquash/oxipng ^2.3.0 API:
 * - optimise(data: ArrayBuffer | ImageData, options?): Promise<ArrayBuffer>
 */
export interface OxipngModule {
  optimise(
    data: ArrayBuffer | ImageData,
    options?: Partial<JsquashOxipngOptions>,
  ): Promise<ArrayBuffer>;
}

/** jsquash @jsquash/oxipng OptimiseOptions (from meta.d.ts). */
export interface JsquashOxipngOptions {
  level: number;
  interlace: boolean;
  optimiseAlpha: boolean;
}

// ---------------------------------------------------------------------------
// Lazy loader (shared skeleton from core)
// ---------------------------------------------------------------------------

const loader = createLazyWasmLoader<OxipngModule>({
  load: () => import('@jsquash/oxipng'),
  validate: (imported) => {
    const candidate = imported as OxipngModule;
    if (typeof candidate.optimise !== 'function') {
      throw new TypeError(
        '@jsquash/oxipng did not export the expected optimise function. ' +
          'Check that @jsquash/oxipng ^2.3.0 is installed.',
      );
    }
    return candidate;
  },
  LoadError: OxipngLoadError,
  loadErrorMessage: 'Failed to import @jsquash/oxipng — see error.cause for details.',
});

/** Returns the cached OxipngModule if already loaded, null otherwise. */
export function getCachedModule(): OxipngModule | null {
  return loader.getCached();
}

/**
 * Ensures the @jsquash/oxipng module is loaded and ready (double-checked Promise
 * guard). Up to N concurrent callers share a single dynamic import(). If
 * disposeOxipng() runs while a load is in flight, the stale result is NOT cached.
 *
 * @throws {OxipngLoadError} if import() fails or exports are missing.
 */
export function ensureLoaded(): Promise<OxipngModule> {
  return loader.ensureLoaded();
}

/**
 * Clears all loader state. After this call, the next ensureLoaded() performs a
 * full cold reload. @jsquash/oxipng provides no explicit teardown; GC reclaims
 * the wasm heap once the module object is unreferenced.
 */
export function disposeOxipng(): void {
  loader.dispose();
}

/** Proactively loads the @jsquash/oxipng wasm module without optimising. */
export function preloadOxipng(): Promise<void> {
  return loader.preload();
}
