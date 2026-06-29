/**
 * @catlabtech/webcvt-backend-native — public barrel exports.
 *
 * ⚠️  NODE-ONLY / NOT BROWSER-SAFE.
 * This package imports node:child_process, node:fs, node:os and node:crypto and
 * spawns native CLI tools (ffmpeg / pandoc / libreoffice / ghostscript). It must
 * never be bundled into browser code. Use it only in a trusted Node ≥ 20 server
 * process. It is the server-side "escape hatch" backend for webcvt.
 *
 * IMPORTANT: importing this module does NOT auto-register the backend. Call
 * registerNativeBackend() explicitly to opt in (preserves tree-shaking and keeps
 * the Node-only dependency out of bundles that merely import the types).
 */

// ---------------------------------------------------------------------------
// Public types + class
// ---------------------------------------------------------------------------

export { NativeBackend, type NativeBackendOptions } from './backend.ts';

// ---------------------------------------------------------------------------
// Routing table (introspection / extension)
// ---------------------------------------------------------------------------

export {
  ROUTE_TABLE,
  findRoute,
  inputExtForMime,
  listRoutes,
  routeKey,
  type RouteEntry,
  type ToolName,
  type ToolRoute,
} from './tools.ts';

// ---------------------------------------------------------------------------
// Tool resolution
// ---------------------------------------------------------------------------

export { clearToolCache, findTool } from './which.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  DEFAULT_TIMEOUT_MS,
  MAX_INPUT_BYTES,
  MAX_STDERR_BYTES,
  TEMP_PREFIX,
} from './constants.ts';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export {
  NativeConversionFailedError,
  NativeInputTooLargeError,
  NativeTimeoutError,
  NativeToolNotFoundError,
  NativeUnsupportedPairError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// registerNativeBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { NativeBackend, type NativeBackendOptions } from './backend.ts';

/**
 * Construct a NativeBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('native')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerNativeBackend } from '@catlabtech/webcvt-backend-native';
 * registerNativeBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerNativeBackend(
  registry: BackendRegistry = defaultRegistry,
  options?: NativeBackendOptions,
): NativeBackend {
  const backend = new NativeBackend(options);
  registry.register(backend);
  return backend;
}
