/**
 * Lazy @jsquash/avif loader for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/avif (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeAvif(), both the cached module AND the in-flight load are
 *   cleared so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * The shared lazy-load skeleton (singleton, double-checked guard, dispose-race
 * generation counter) lives in core's createLazyWasmLoader; this file only
 * supplies the @jsquash/avif dynamic import, the shape validator, and the
 * AvifLoadError constructor.
 *
 * SELF-HOSTING WASM (deferred to v0.3):
 * TODO: AvifLoadOptions (moduleURL / pre-compiled WebAssembly.Module) is deferred.
 * jsquash 1.3.0 does not expose init() at the root level — implementing custom wasm
 * URLs requires sub-module API inspection. See issue tracker for v0.3 tracking.
 */

import { createLazyWasmLoader } from '@catlabtech/webcvt-core';
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
// Lazy loader (shared skeleton from core)
// ---------------------------------------------------------------------------

const loader = createLazyWasmLoader<AvifModule>({
  // Dynamic import — NEVER static (Trap §1). @jsquash/avif ^1.3.0 has no init()
  // at the root module level; the root index.js auto-initialises on first use.
  load: () => import('@jsquash/avif'),
  validate: (imported) => {
    // jsquash exports decode/encode as default-wrapped at root.
    const candidate = imported as AvifModule;
    if (typeof candidate.decode !== 'function' || typeof candidate.encode !== 'function') {
      throw new TypeError(
        '@jsquash/avif did not export expected decode/encode functions. ' +
          'Check that @jsquash/avif ^1.3.0 is installed.',
      );
    }
    return candidate;
  },
  LoadError: AvifLoadError,
  loadErrorMessage: 'Failed to import @jsquash/avif — see error.cause for details.',
});

/** Returns the cached AvifModule if already loaded, null otherwise. */
export function getCachedModule(): AvifModule | null {
  return loader.getCached();
}

/**
 * Ensures the @jsquash/avif module is loaded and ready (double-checked Promise
 * guard). Up to N concurrent callers share a single dynamic import(). If
 * disposeAvif() runs while a load is in flight, the stale result is NOT cached.
 *
 * @throws {AvifLoadError} if import() fails or the expected exports are missing.
 */
export function ensureLoaded(): Promise<AvifModule> {
  return loader.ensureLoaded();
}

/**
 * Clears all loader state. After this call, the next ensureLoaded() performs a
 * full cold reload. @jsquash/avif provides no explicit teardown; GC reclaims the
 * wasm heap once the module object is unreferenced. Use in tests to reset
 * singletons; use in production to free ~3–5 MiB wasm heap when done.
 */
export function disposeAvif(): void {
  loader.dispose();
}

/**
 * Proactively loads the @jsquash/avif wasm module without performing any
 * decode/encode. Useful for warming up the wasm instance before the first
 * user action.
 */
export function preloadAvif(): Promise<void> {
  return loader.preload();
}
