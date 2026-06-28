/**
 * Lazy @jsquash/jxl loader for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/jxl (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeJxl(), both _module AND _loading are nulled out
 *   so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * @jsquash/jxl ^1.3.0 exposes decode() and encode() as default exports of
 * its decode.js / encode.js submodules, re-exported from the package root.
 */

import { JxlLoadError } from './errors.ts';

// ---------------------------------------------------------------------------
// @jsquash/jxl dynamic types
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for the @jsquash/jxl module.
 * Defined here so we never import the package at module scope.
 *
 * Matches @jsquash/jxl ^1.3.0 API:
 * - decode(buffer: ArrayBuffer): Promise<ImageData>
 * - encode(data: ImageData, options?: Partial<EncodeOptions>): Promise<ArrayBuffer>
 */
export interface JxlModule {
  decode(data: ArrayBuffer): Promise<ImageData>;
  encode(image: ImageData, options?: Partial<JsquashJxlEncodeOptions>): Promise<ArrayBuffer>;
}

/** jsquash @jsquash/jxl EncodeOptions (from codec/enc/jxl_enc.d.ts). */
export interface JsquashJxlEncodeOptions {
  effort: number;
  quality: number;
  progressive: boolean;
  epf: number;
  lossyPalette: boolean;
  decodingSpeedTier: number;
  photonNoiseIso: number;
  lossyModular: boolean;
  lossless: boolean;
}

// ---------------------------------------------------------------------------
// Loader state — module-level singletons (reset via disposeJxl)
// ---------------------------------------------------------------------------

let _module: JxlModule | null = null;
let _loading: Promise<JxlModule> | null = null;

/**
 * Generation counter for dispose-during-load race safety.
 * Incremented on each disposeJxl() call. If the generation changes between
 * the start and end of a doLoad(), the result is discarded (stale load).
 */
let _generation = 0;

// ---------------------------------------------------------------------------
// Public accessors (used by tests and backend for inspection)
// ---------------------------------------------------------------------------

/** Returns the cached JxlModule if already loaded, null otherwise. */
export function getCachedModule(): JxlModule | null {
  return _module;
}

// ---------------------------------------------------------------------------
// Lazy loader — double-checked Promise guard (Trap §2)
// ---------------------------------------------------------------------------

/**
 * Ensures the @jsquash/jxl module is loaded and ready.
 *
 * Pattern: double-checked Promise guard.
 * - Check 1: if module is already live, return immediately.
 * - Check 2: if a load is already in progress, join it.
 * - Otherwise: start a new load (one dynamic import() fires).
 *
 * Up to N concurrent callers all share a single Promise and a single
 * dynamic import() call.
 *
 * Race safety: if disposeJxl() is called while a load is in flight, the
 * generation counter ensures the stale result is NOT written to _module.
 *
 * @throws {JxlLoadError} if import() fails or exports are missing.
 */
export async function ensureLoaded(): Promise<JxlModule> {
  // Check 1: already loaded
  if (_module !== null) {
    return _module;
  }

  // Check 2: load already in progress — join it
  if (_loading !== null) {
    return _loading;
  }

  // Start a new load — capture generation so dispose-during-load is safe
  const myGen = ++_generation;
  _loading = doLoad().then((mod) => {
    if (myGen === _generation) {
      _module = mod;
    }
    return mod;
  });

  _loading.catch(() => {
    // Reset _loading on error so callers can retry after failure
    if (myGen === _generation) {
      _loading = null;
    }
  });

  return _loading;
}

// ---------------------------------------------------------------------------
// disposeJxl — clear singletons for GC + test isolation
// ---------------------------------------------------------------------------

/**
 * Clears all loader state. After this call, the next ensureLoaded() will
 * perform a full cold reload (new dynamic import, new wasm instantiation).
 *
 * Race safety: if a load is in-flight when disposeJxl() is called, the
 * in-flight promise will still resolve but will NOT write to _module (the
 * generation counter detects the mismatch).
 *
 * Note: @jsquash/jxl provides no explicit teardown/free API. GC handles
 * wasm linear memory reclamation when the module object is no longer referenced.
 */
export function disposeJxl(): void {
  _module = null;
  _loading = null;
  _generation++;
}

// ---------------------------------------------------------------------------
// preloadJxl — explicit warm-up
// ---------------------------------------------------------------------------

/**
 * Proactively loads the @jsquash/jxl wasm module without performing any
 * decode/encode. Useful for warming up the wasm instance before the first
 * user action.
 */
export async function preloadJxl(): Promise<void> {
  await ensureLoaded();
}

// ---------------------------------------------------------------------------
// Internal: actual load logic
// ---------------------------------------------------------------------------

async function doLoad(): Promise<JxlModule> {
  // Dynamic import — NEVER static (Trap §1)
  let mod: JxlModule;
  try {
    const imported = await import('@jsquash/jxl');
    // jsquash exports decode/encode as default-wrapped at root
    const candidate = imported as unknown as JxlModule;
    if (typeof candidate.decode !== 'function' || typeof candidate.encode !== 'function') {
      throw new TypeError(
        '@jsquash/jxl did not export expected decode/encode functions. ' +
          'Check that @jsquash/jxl ^1.3.0 is installed.',
      );
    }
    mod = candidate;
  } catch (err) {
    throw new JxlLoadError('Failed to import @jsquash/jxl — see error.cause for details.', {
      cause: err,
    });
  }

  return mod;
}
