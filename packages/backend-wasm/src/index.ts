/**
 * @catlabtech/webcvt-backend-wasm — public barrel exports.
 *
 * IMPORTANT: importing this module does NOT auto-register the backend.
 * Call registerWasmBackend() explicitly to opt-in (Trap #2: no auto-register).
 *
 * Tree-shaking note: sideEffects: false is set in package.json. This file
 * contains no top-level side-effectful code so bundlers can dead-code-eliminate
 * unused exports safely.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { WasmBackendOptions } from './backend.ts';
export type { WasmLoadOptions } from './loader.ts';
export type { RuntimeInfo, RuntimeKind } from './runtime.ts';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export { WasmExecutionError, WasmLoadError, WasmUnsupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// WasmBackend class
// ---------------------------------------------------------------------------

export { WasmBackend } from './backend.ts';

// ---------------------------------------------------------------------------
// Allowlist data
// ---------------------------------------------------------------------------

export {
  SUBTITLE_PAIRS,
  WASM_SUPPORTED_FORMATS,
  WASM_SUPPORTED_PAIRS,
  enableSubtitlePairs,
  isAllowlisted,
} from './allowlist.ts';

// ---------------------------------------------------------------------------
// registerWasmBackend — explicit opt-in (Trap #2)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { enableSubtitlePairs } from './allowlist.ts';
import { WasmBackend } from './backend.ts';
import type { WasmBackendOptions } from './backend.ts';

export interface RegisterWasmBackendOptions extends WasmBackendOptions {
  /**
   * When true, subtitle conversion pairs (SRT/ASS/SSA/VTT) are added to
   * the runtime allowlist. Default: false.
   */
  readonly enableSubtitleFallback?: boolean;
}

/**
 * Registers a WasmBackend instance with the given registry (or the
 * defaultRegistry when omitted).
 *
 * Must be called explicitly by the application — no auto-registration
 * happens on import (Trap #2: preserves tree-shaking).
 *
 * @example
 * ```ts
 * import { registerWasmBackend } from '@catlabtech/webcvt-backend-wasm';
 * registerWasmBackend();
 * ```
 *
 * @param registry - Target registry. Defaults to core's defaultRegistry.
 * @param options  - Backend and load options.
 */
export function registerWasmBackend(
  registry: BackendRegistry = defaultRegistry,
  options?: RegisterWasmBackendOptions,
): void {
  if (options?.enableSubtitleFallback === true) {
    enableSubtitlePairs();
  }

  const backend = new WasmBackend(options);
  registry.register(backend);
}
