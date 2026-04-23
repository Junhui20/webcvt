/**
 * Lazy @jsquash/avif loader for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/avif (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeAvif(), both _module AND _loading are nulled out
 *   so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * SELF-HOSTING WASM (deferred to v0.3):
 * TODO: AvifLoadOptions (moduleURL / pre-compiled WebAssembly.Module) is deferred.
 * jsquash 1.3.0 does not expose init() at the root level — implementing custom wasm
 * URLs requires sub-module API inspection. See issue tracker for v0.3 tracking.
 */

import { AvifLoadError } from './errors.ts';

// ---------------------------------------------------------------------------
// @jsquash/avif dynamic types
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for the @jsquash/avif module.
 * Defined here so we never import the package at module scope.
 *
 * Matches @jsquash/avif ^1.3.0 API:
 * - decode(buffer: ArrayBuffer): Promise<ImageData>
 * - encode(data: ImageData, options?: Partial<EncodeOptions>): Promise<ArrayBuffer>
 *
 * Note: jsquash uses cqLevel (0-62) internally, not a 0-100 quality scale.
 * Our encode.ts maps our quality (0-100) to jsquash's cqLevel.
 * Note: there is no init() at the root module level in @jsquash/avif ^1.3.0.
 */
export interface AvifModule {
  decode(data: ArrayBuffer): Promise<ImageData>;
  encode(image: ImageData, options?: Partial<JsquashEncodeOptions>): Promise<ArrayBuffer>;
}

/** jsquash @jsquash/avif EncodeOptions (from codec/enc/avif_enc.d.ts). */
export interface JsquashEncodeOptions {
  cqLevel: number;
  denoiseLevel: number;
  cqAlphaLevel: number;
  tileRowsLog2: number;
  tileColsLog2: number;
  speed: number;
  subsample: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  tune: number;
}

// ---------------------------------------------------------------------------
// Loader state — module-level singletons (reset via disposeAvif)
// ---------------------------------------------------------------------------

let _module: AvifModule | null = null;
let _loading: Promise<AvifModule> | null = null;

/**
 * Generation counter for dispose-during-load race safety (MEDIUM-5).
 * Incremented on each disposeAvif() call. If the generation changes between
 * the start and end of a doLoad(), the result is discarded (stale load).
 */
let _generation = 0;

// ---------------------------------------------------------------------------
// Public accessors (used by tests and backend for inspection)
// ---------------------------------------------------------------------------

/** Returns the cached AvifModule if already loaded, null otherwise. */
export function getCachedModule(): AvifModule | null {
  return _module;
}

// ---------------------------------------------------------------------------
// Lazy loader — double-checked Promise guard (Trap §2)
// ---------------------------------------------------------------------------

/**
 * Ensures the @jsquash/avif module is loaded and ready.
 *
 * Pattern: double-checked Promise guard.
 * - Check 1: if module is already live, return immediately.
 * - Check 2: if a load is already in progress, join it.
 * - Otherwise: start a new load (one dynamic import() fires).
 *
 * Up to N concurrent callers all share a single Promise and a single
 * dynamic import() call. Verified by the "10 concurrent = 1 import" test.
 *
 * Race safety: if disposeAvif() is called while a load is in flight, the
 * generation counter ensures the stale result is NOT written to _module.
 *
 * @throws {AvifLoadError} if import() or init() fails.
 */
export async function ensureLoaded(): Promise<AvifModule> {
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
// disposeAvif — clear singletons for GC + test isolation
// ---------------------------------------------------------------------------

/**
 * Clears all loader state. After this call, the next ensureLoaded() will
 * perform a full cold reload (new dynamic import, new wasm instantiation).
 *
 * Race safety: if a load is in-flight when disposeAvif() is called, the
 * in-flight promise will still resolve but will NOT write to _module (the
 * generation counter detects the mismatch).
 *
 * Note: @jsquash/avif provides no explicit teardown/free API. GC handles
 * wasm linear memory reclamation when the module object is no longer referenced.
 *
 * Use in tests to reset singletons between runs.
 * Use in production to free ~3–5 MiB wasm heap when AVIF conversions are done.
 */
export function disposeAvif(): void {
  _module = null;
  _loading = null;
  _generation++;
}

// ---------------------------------------------------------------------------
// preloadAvif — explicit warm-up
// ---------------------------------------------------------------------------

/**
 * Proactively loads the @jsquash/avif wasm module without performing any
 * decode/encode. Useful for warming up the wasm instance before the first
 * user action.
 *
 * Self-hosting wasm (moduleURL / pre-compiled WebAssembly.Module) is deferred
 * to v0.3 — see module-level TODO above.
 */
export async function preloadAvif(): Promise<void> {
  await ensureLoaded();
}

// ---------------------------------------------------------------------------
// Internal: actual load logic
// ---------------------------------------------------------------------------

async function doLoad(): Promise<AvifModule> {
  // Dynamic import — NEVER static (Trap §1)
  // Note: @jsquash/avif ^1.3.0 has no init() at the root module level.
  // The sub-modules (encode.js, decode.js) each have their own init(), but
  // the root index.js auto-initialises on first use.
  let mod: AvifModule;
  try {
    const imported = await import('@jsquash/avif');
    // jsquash exports decode/encode as default-wrapped at root
    const candidate = imported as unknown as AvifModule;
    if (typeof candidate.decode !== 'function' || typeof candidate.encode !== 'function') {
      throw new TypeError(
        '@jsquash/avif did not export expected decode/encode functions. ' +
          'Check that @jsquash/avif ^1.3.0 is installed.',
      );
    }
    mod = candidate;
  } catch (err) {
    throw new AvifLoadError('Failed to import @jsquash/avif — see error.cause for details.', {
      cause: err,
    });
  }

  return mod;
}
