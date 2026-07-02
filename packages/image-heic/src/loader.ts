/**
 * Lazy libheif-js loader for @catlabtech/webcvt-image-heic.
 *
 * Critical constraints:
 * - NEVER static-import libheif-js (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeHeic(), both the cached module AND the in-flight load are cleared.
 *
 * We import the `libheif-js/wasm-bundle` entry point, which inlines the wasm as
 * base64 — so there is no separate .wasm fetch (works in the browser under CSP and
 * in Node alike). It needs `script-src 'wasm-unsafe-eval'` to instantiate the wasm.
 *
 * The shared lazy-load skeleton (singleton, double-checked guard, dispose-race
 * generation counter) lives in core's createLazyWasmLoader; this file only
 * supplies the libheif-js dynamic import, the shape validator, and the
 * HeicLoadError constructor.
 */

import { createLazyWasmLoader } from '@catlabtech/webcvt-core';
import { HeicLoadError } from './errors.ts';

/** The mutable RGBA target libheif fills during display(). */
export interface HeifImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A single decoded image handle from libheif-js. */
export interface HeifImage {
  get_width(): number;
  get_height(): number;
  /** Renders the image into `target.data` (RGBA), then invokes the callback. */
  display(target: HeifImageDataLike, callback: (filled: HeifImageDataLike | null) => void): void;
  /** Releases the wasm-backed image memory (present on real libheif-js images). */
  free?(): void;
}

export interface HeifDecoderInstance {
  decode(data: ArrayBuffer | Uint8Array): HeifImage[];
}

/** Minimal structural type for the libheif-js module (decode-only). */
export interface LibheifModule {
  HeifDecoder: new () => HeifDecoderInstance;
}

// ---------------------------------------------------------------------------
// Lazy loader (shared skeleton from core)
// ---------------------------------------------------------------------------

const loader = createLazyWasmLoader<LibheifModule>({
  load: () => import('libheif-js/wasm-bundle'),
  validate: (imported) => {
    const raw = imported as { default?: LibheifModule } & LibheifModule;
    const candidate = raw.default ?? raw;
    if (typeof candidate.HeifDecoder !== 'function') {
      throw new TypeError(
        'libheif-js did not export the expected HeifDecoder. ' +
          'Check that libheif-js ^1.19.0 is installed.',
      );
    }
    return candidate;
  },
  LoadError: HeicLoadError,
  loadErrorMessage: 'Failed to import libheif-js — see error.cause for details.',
});

/** Returns the cached libheif module if already loaded, null otherwise. */
export function getCachedModule(): LibheifModule | null {
  return loader.getCached();
}

/**
 * Ensures libheif-js is loaded and ready (double-checked Promise guard).
 *
 * @throws {HeicLoadError} if import() fails or the HeifDecoder export is missing.
 */
export function ensureLoaded(): Promise<LibheifModule> {
  return loader.ensureLoaded();
}

/** Clears all loader state; the next ensureLoaded() cold-reloads the wasm. */
export function disposeHeic(): void {
  loader.dispose();
}

/** Proactively loads libheif-js without decoding. */
export function preloadHeic(): Promise<void> {
  return loader.preload();
}
