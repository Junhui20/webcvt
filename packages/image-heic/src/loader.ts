/**
 * Lazy libheif-js loader for @catlabtech/webcvt-image-heic.
 *
 * Critical constraints:
 * - NEVER static-import libheif-js (Trap §1: tree-shaking / side-effects).
 * - Double-checked Promise guard (Trap §2): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - After disposeHeic(), both _module AND _loading are nulled out.
 *
 * We import the `libheif-js/wasm-bundle` entry point, which inlines the wasm as
 * base64 — so there is no separate .wasm fetch (works in the browser under CSP and
 * in Node alike). It needs `script-src 'wasm-unsafe-eval'` to instantiate the wasm.
 */

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

let _module: LibheifModule | null = null;
let _loading: Promise<LibheifModule> | null = null;
let _generation = 0;

/** Returns the cached libheif module if already loaded, null otherwise. */
export function getCachedModule(): LibheifModule | null {
  return _module;
}

/**
 * Ensures libheif-js is loaded and ready (double-checked Promise guard).
 *
 * @throws {HeicLoadError} if import() fails or the HeifDecoder export is missing.
 */
export async function ensureLoaded(): Promise<LibheifModule> {
  if (_module !== null) return _module;
  if (_loading !== null) return _loading;

  const myGen = ++_generation;
  _loading = doLoad().then((mod) => {
    if (myGen === _generation) _module = mod;
    return mod;
  });
  _loading.catch(() => {
    if (myGen === _generation) _loading = null;
  });
  return _loading;
}

/** Clears all loader state; the next ensureLoaded() cold-reloads the wasm. */
export function disposeHeic(): void {
  _module = null;
  _loading = null;
  _generation++;
}

/** Proactively loads libheif-js without decoding. */
export async function preloadHeic(): Promise<void> {
  await ensureLoaded();
}

async function doLoad(): Promise<LibheifModule> {
  let lib: LibheifModule;
  try {
    const imported = (await import('libheif-js/wasm-bundle')) as unknown as {
      default?: LibheifModule;
    } & LibheifModule;
    const candidate = imported.default ?? imported;
    if (typeof candidate.HeifDecoder !== 'function') {
      throw new TypeError(
        'libheif-js did not export the expected HeifDecoder. ' +
          'Check that libheif-js ^1.19.0 is installed.',
      );
    }
    lib = candidate;
  } catch (err) {
    throw new HeicLoadError('Failed to import libheif-js — see error.cause for details.', {
      cause: err,
    });
  }
  return lib;
}
