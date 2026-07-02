/**
 * Lazy @jsquash/jxl loader for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/jxl (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeJxl(), both the cached module AND the in-flight load are
 *   cleared so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * The shared lazy-load skeleton (singleton, double-checked guard, dispose-race
 * generation counter) lives in core's createLazyWasmLoader; this file only
 * supplies the @jsquash/jxl dynamic import, the shape validator, and the
 * JxlLoadError constructor.
 *
 * @jsquash/jxl ^1.3.0 exposes decode() and encode() as default exports of
 * its decode.js / encode.js submodules, re-exported from the package root.
 */

import { createLazyWasmLoader } from '@catlabtech/webcvt-core';
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
// Lazy loader (shared skeleton from core)
// ---------------------------------------------------------------------------

const loader = createLazyWasmLoader<JxlModule>({
  // Dynamic import — NEVER static (Trap §1).
  load: () => import('@jsquash/jxl'),
  validate: (imported) => {
    // jsquash exports decode/encode as default-wrapped at root.
    const candidate = imported as JxlModule;
    if (typeof candidate.decode !== 'function' || typeof candidate.encode !== 'function') {
      throw new TypeError(
        '@jsquash/jxl did not export expected decode/encode functions. ' +
          'Check that @jsquash/jxl ^1.3.0 is installed.',
      );
    }
    return candidate;
  },
  LoadError: JxlLoadError,
  loadErrorMessage: 'Failed to import @jsquash/jxl — see error.cause for details.',
});

/** Returns the cached JxlModule if already loaded, null otherwise. */
export function getCachedModule(): JxlModule | null {
  return loader.getCached();
}

/**
 * Ensures the @jsquash/jxl module is loaded and ready (double-checked Promise
 * guard). Up to N concurrent callers share a single dynamic import(). If
 * disposeJxl() runs while a load is in flight, the stale result is NOT cached.
 *
 * @throws {JxlLoadError} if import() fails or exports are missing.
 */
export function ensureLoaded(): Promise<JxlModule> {
  return loader.ensureLoaded();
}

/**
 * Clears all loader state. After this call, the next ensureLoaded() performs a
 * full cold reload. @jsquash/jxl provides no explicit teardown; GC reclaims the
 * wasm heap once the module object is unreferenced.
 */
export function disposeJxl(): void {
  loader.dispose();
}

/** Proactively loads the @jsquash/jxl wasm module without decoding/encoding. */
export function preloadJxl(): Promise<void> {
  return loader.preload();
}
