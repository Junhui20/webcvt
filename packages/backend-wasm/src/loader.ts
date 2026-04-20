/**
 * Lazy FFmpeg.wasm loader for @webcvt/backend-wasm.
 *
 * Critical constraints:
 * - NEVER static-import @ffmpeg/ffmpeg (Trap #13 / tree-shaking).
 * - Double-checked Promise guard (Trap #1): N concurrent first-callers
 *   all receive the same Promise; only one dynamic import() executes.
 * - Runtime detection (Trap #5): chooses MT vs ST core based on
 *   SharedArrayBuffer + crossOriginIsolated.
 * - Node.js: no blob: URL for worker (Trap #15).
 * - After any terminate(), both instance AND loading are nulled out
 *   so the next call cold-reloads (Trap #12).
 */

import { WasmLoadError } from './errors.ts';
import type { RuntimeInfo } from './runtime.ts';
import { detectRuntime } from './runtime.ts';

// ---------------------------------------------------------------------------
// @ffmpeg/ffmpeg dynamic types
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the FFmpeg class we get from @ffmpeg/ffmpeg.
 * Defined structurally so we don't import the package at module scope.
 */
export interface FFmpegInstance {
  load(options?: FFmpegLoadOptions): Promise<void>;
  exec(args: string[]): Promise<number>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  readFile(name: string): Promise<Uint8Array | string>;
  deleteFile(name: string): Promise<void>;
  terminate(): void;
  on(event: 'log', handler: (data: { type: string; message: string }) => void): void;
  off(event: 'log', handler: (data: { type: string; message: string }) => void): void;
}

export interface FFmpegLoadOptions {
  readonly coreURL?: string;
  readonly wasmURL?: string;
  readonly workerURL?: string;
}

export interface WasmLoadOptions extends FFmpegLoadOptions {
  readonly preferMultiThread?: boolean;
}

// ---------------------------------------------------------------------------
// Loader state (module-level singletons, reset via nullLoader())
// ---------------------------------------------------------------------------

let _instance: FFmpegInstance | null = null;
let _loading: Promise<FFmpegInstance> | null = null;
let _runtime: RuntimeInfo | null = null;

/**
 * Resets all loader state. Used after terminate() to allow cold reload.
 * Also used in tests to reset module-level singletons between runs.
 */
export function resetLoader(): void {
  _instance = null;
  _loading = null;
  _runtime = null;
}

/** Returns the cached FFmpeg instance if already loaded, null otherwise. */
export function getCachedInstance(): FFmpegInstance | null {
  return _instance;
}

/** Sets the module-level instance (used after successful load). */
export function setCachedInstance(inst: FFmpegInstance | null): void {
  _instance = inst;
  if (inst === null) {
    _loading = null;
  }
}

// ---------------------------------------------------------------------------
// Lazy loader (double-checked Promise guard — Trap #1)
// ---------------------------------------------------------------------------

/**
 * Ensures a single FFmpeg instance is loaded and ready.
 *
 * Pattern: double-checked Promise guard.
 * - Check 1: if instance is already live, return immediately.
 * - Check 2: if a load is already in progress, join it.
 * - Otherwise: start a new load (one dynamic import() fires).
 *
 * Up to N concurrent callers all share a single Promise and a single
 * dynamic import() call.
 *
 * @param options - Optional URL overrides and thread preference.
 * @throws WasmLoadError if the import or ffmpeg.load() fails.
 */
export async function ensureLoaded(options?: WasmLoadOptions): Promise<FFmpegInstance> {
  // Check 1: already loaded
  if (_instance !== null) {
    return _instance;
  }

  // Check 2: load already in progress — join it
  if (_loading !== null) {
    return _loading;
  }

  // Start a new load
  _loading = doLoad(options);

  try {
    _instance = await _loading;
    return _instance;
  } catch (err) {
    // Reset so callers can retry after failure
    _loading = null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal: actual load logic
// ---------------------------------------------------------------------------

async function doLoad(options?: WasmLoadOptions): Promise<FFmpegInstance> {
  if (_runtime === null) {
    _runtime = detectRuntime();
  }
  const runtime = _runtime;

  // Dynamic import — NEVER static (Trap #13)
  let FFmpegClass: new () => FFmpegInstance;
  try {
    const mod = await import('@ffmpeg/ffmpeg');
    FFmpegClass = (mod as Record<string, unknown>).FFmpeg as new () => FFmpegInstance;
    if (typeof FFmpegClass !== 'function') {
      throw new TypeError('@ffmpeg/ffmpeg did not export a FFmpeg constructor');
    }
  } catch (err) {
    throw new WasmLoadError(
      `Failed to import @ffmpeg/ffmpeg: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const inst = new FFmpegClass();

  // Resolve load options based on runtime + user overrides (Trap #5, #14, #15)
  const loadOpts = resolveLoadOptions(runtime, options);

  try {
    await inst.load(loadOpts);
  } catch (err) {
    throw new WasmLoadError(
      `ffmpeg.load() failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return inst;
}

// ---------------------------------------------------------------------------
// Internal: load option resolution
// ---------------------------------------------------------------------------

function resolveLoadOptions(
  runtime: RuntimeInfo,
  options?: WasmLoadOptions,
): FFmpegLoadOptions | undefined {
  // If the caller provides explicit URLs, use them verbatim (CSP override / self-hosting)
  if (options?.coreURL !== undefined || options?.wasmURL !== undefined) {
    return {
      coreURL: options.coreURL,
      wasmURL: options.wasmURL,
      workerURL: options.workerURL,
    };
  }

  const preferMT = options?.preferMultiThread ?? true;
  const useMT = preferMT && runtime.multiThread;

  if (!useMT) {
    // Single-thread core: no coreURL override needed; @ffmpeg/ffmpeg default
    return undefined;
  }

  // Multi-thread: rely on @ffmpeg/ffmpeg defaults (it auto-selects MT when SAB is present)
  return undefined;
}
