/**
 * Lazy @jsquash/oxipng loader for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/oxipng (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeOxipng(), both _module AND _loading are nulled out
 *   so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 */

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

let _module: OxipngModule | null = null;
let _loading: Promise<OxipngModule> | null = null;
let _generation = 0;

/** Returns the cached OxipngModule if already loaded, null otherwise. */
export function getCachedModule(): OxipngModule | null {
  return _module;
}

/**
 * Ensures the @jsquash/oxipng module is loaded and ready (double-checked Promise
 * guard). If disposeOxipng() runs while a load is in flight, the generation
 * counter ensures the stale result is NOT written to _module.
 *
 * @throws {OxipngLoadError} if import() fails or exports are missing.
 */
export async function ensureLoaded(): Promise<OxipngModule> {
  if (_module !== null) {
    return _module;
  }
  if (_loading !== null) {
    return _loading;
  }

  const myGen = ++_generation;
  _loading = doLoad().then((mod) => {
    if (myGen === _generation) {
      _module = mod;
    }
    return mod;
  });

  _loading.catch(() => {
    if (myGen === _generation) {
      _loading = null;
    }
  });

  return _loading;
}

/**
 * Clears all loader state. After this call, the next ensureLoaded() performs a
 * full cold reload. @jsquash/oxipng provides no explicit teardown; GC reclaims
 * the wasm heap once the module object is unreferenced.
 */
export function disposeOxipng(): void {
  _module = null;
  _loading = null;
  _generation++;
}

/** Proactively loads the @jsquash/oxipng wasm module without optimising. */
export async function preloadOxipng(): Promise<void> {
  await ensureLoaded();
}

async function doLoad(): Promise<OxipngModule> {
  let mod: OxipngModule;
  try {
    const imported = await import('@jsquash/oxipng');
    const candidate = imported as unknown as OxipngModule;
    if (typeof candidate.optimise !== 'function') {
      throw new TypeError(
        '@jsquash/oxipng did not export the expected optimise function. ' +
          'Check that @jsquash/oxipng ^2.3.0 is installed.',
      );
    }
    mod = candidate;
  } catch (err) {
    throw new OxipngLoadError('Failed to import @jsquash/oxipng — see error.cause for details.', {
      cause: err,
    });
  }

  return mod;
}
