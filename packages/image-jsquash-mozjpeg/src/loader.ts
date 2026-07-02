/**
 * Lazy @jsquash/jpeg (MozJPEG) loader for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Critical constraints:
 * - NEVER static-import @jsquash/jpeg (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeMozjpeg(), both the cached module AND the in-flight load are
 *   cleared so the next call cold-reloads.
 *
 * INVARIANT: importing this module (or the barrel index) triggers zero
 * wasm bytes fetched. The wasm payload is only fetched when ensureLoaded()
 * is first called.
 *
 * The shared lazy-load skeleton (singleton, double-checked guard, dispose-race
 * generation counter) lives in core's createLazyWasmLoader; this file only
 * supplies the @jsquash/jpeg dynamic import, the shape validator, and the
 * MozjpegLoadError constructor.
 */

import { createLazyWasmLoader } from '@catlabtech/webcvt-core';
import { MozjpegLoadError } from './errors.ts';

/**
 * Minimal structural type for the @jsquash/jpeg module.
 * Matches @jsquash/jpeg ^1.6.0 API:
 * - decode(buffer: ArrayBuffer): Promise<ImageData>
 * - encode(data: ImageData, options?: Partial<EncodeOptions>): Promise<ArrayBuffer>
 */
export interface MozjpegModule {
  decode(data: ArrayBuffer): Promise<ImageData>;
  encode(image: ImageData, options?: Partial<JsquashMozjpegEncodeOptions>): Promise<ArrayBuffer>;
}

/** jsquash @jsquash/jpeg EncodeOptions (from codec/enc/mozjpeg_enc.d.ts). */
export interface JsquashMozjpegEncodeOptions {
  quality: number;
  baseline: boolean;
  arithmetic: boolean;
  progressive: boolean;
  optimize_coding: boolean;
  smoothing: number;
  color_space: number;
  quant_table: number;
  trellis_multipass: boolean;
  trellis_opt_zero: boolean;
  trellis_opt_table: boolean;
  trellis_loops: number;
  auto_subsample: boolean;
  chroma_subsample: number;
  separate_chroma_quality: boolean;
  chroma_quality: number;
}

// ---------------------------------------------------------------------------
// Lazy loader (shared skeleton from core)
// ---------------------------------------------------------------------------

const loader = createLazyWasmLoader<MozjpegModule>({
  load: () => import('@jsquash/jpeg'),
  validate: (imported) => {
    const candidate = imported as MozjpegModule;
    if (typeof candidate.decode !== 'function' || typeof candidate.encode !== 'function') {
      throw new TypeError(
        '@jsquash/jpeg did not export expected decode/encode functions. ' +
          'Check that @jsquash/jpeg ^1.6.0 is installed.',
      );
    }
    return candidate;
  },
  LoadError: MozjpegLoadError,
  loadErrorMessage: 'Failed to import @jsquash/jpeg — see error.cause for details.',
});

/** Returns the cached MozjpegModule if already loaded, null otherwise. */
export function getCachedModule(): MozjpegModule | null {
  return loader.getCached();
}

/**
 * Ensures the @jsquash/jpeg module is loaded and ready (double-checked Promise
 * guard). Up to N concurrent callers share a single dynamic import(). If
 * disposeMozjpeg() runs while a load is in flight, the stale result is NOT cached.
 *
 * @throws {MozjpegLoadError} if import() fails or exports are missing.
 */
export function ensureLoaded(): Promise<MozjpegModule> {
  return loader.ensureLoaded();
}

/**
 * Clears all loader state. After this call, the next ensureLoaded() performs a
 * full cold reload. @jsquash/jpeg provides no explicit teardown; GC reclaims the
 * wasm heap once the module object is unreferenced.
 */
export function disposeMozjpeg(): void {
  loader.dispose();
}

/** Proactively loads the @jsquash/jpeg wasm module without decoding/encoding. */
export function preloadMozjpeg(): Promise<void> {
  return loader.preload();
}
