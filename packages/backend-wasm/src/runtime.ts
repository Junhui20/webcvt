/**
 * Runtime environment detection for @catlabtech/webcvt-backend-wasm.
 *
 * Determines:
 * 1. Whether we are running in a browser or Node.js context.
 * 2. Whether multi-thread FFmpeg core is available (requires SharedArrayBuffer
 *    AND crossOriginIsolated, per Trap #5).
 *
 * Keeping this in its own file makes it easy to mock in tests.
 */

// ---------------------------------------------------------------------------
// Runtime kind
// ---------------------------------------------------------------------------

export type RuntimeKind = 'browser' | 'node' | 'worker' | 'unknown';

/**
 * Detects the current runtime environment.
 *
 * Heuristic order:
 * 1. `process?.versions?.node` → Node.js
 * 2. `WorkerGlobalScope` → Web Worker
 * 3. `window` / `globalThis.document` → Browser main thread
 * 4. Otherwise → unknown
 */
export function detectRuntimeKind(): RuntimeKind {
  // Node.js
  if (
    typeof process !== 'undefined' &&
    process.versions !== undefined &&
    process.versions !== null &&
    typeof process.versions.node === 'string'
  ) {
    return 'node';
  }

  // Web Worker (ServiceWorker / DedicatedWorker / SharedWorker)
  if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    return 'worker';
  }

  // Browser main thread
  if (
    typeof window !== 'undefined' &&
    typeof (globalThis as Record<string, unknown>).document !== 'undefined'
  ) {
    return 'browser';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Multi-thread capability (Trap #5)
// ---------------------------------------------------------------------------

/**
 * Returns true when the multi-thread FFmpeg core can be used.
 *
 * Requirements (both must be true):
 * - `SharedArrayBuffer` is available (typeof check, not constructor check)
 * - `crossOriginIsolated === true` (set by COOP + COEP response headers)
 *
 * In Node.js, SharedArrayBuffer is always available and there is no
 * crossOriginIsolated concept, so we return true.
 */
export function canUseMultiThread(): boolean {
  const kind = detectRuntimeKind();

  if (kind === 'node') {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis as Record<string, unknown>).crossOriginIsolated === true
  );
}

// ---------------------------------------------------------------------------
// Composite result
// ---------------------------------------------------------------------------

export interface RuntimeInfo {
  readonly kind: RuntimeKind;
  readonly multiThread: boolean;
}

/**
 * Returns a snapshot of the current runtime capabilities.
 * Pure function — call once and cache for the lifecycle of the backend.
 */
export function detectRuntime(): RuntimeInfo {
  return {
    kind: detectRuntimeKind(),
    multiThread: canUseMultiThread(),
  };
}
