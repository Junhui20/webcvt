// Types
export type { WavFormat, WavFile, ChunkHeader } from './header.ts';

// Errors
export { WavTooLargeError, UnsupportedSubFormatError, WavFormatError } from './errors.ts';

// Core parsing / serialization
export { parseWav } from './parser.ts';
export { serializeWav } from './serializer.ts';

// Low-level chunk primitives
export { readChunkHeader, writeChunkHeader } from './header.ts';

// Constants (useful for consumers building custom parsers)
export {
  WAVE_FORMAT_PCM,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_EXTENSIBLE,
  RIFF_ID,
  RF64_ID,
  WAVE_MAGIC,
  FMT_ID,
  DATA_ID,
} from './header.ts';

// Backend
export { WavBackend, WAV_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// registerWavBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { WavBackend } from './backend.ts';

/**
 * Construct a WavBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('container-wav')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerWavBackend } from '@catlabtech/webcvt-container-wav';
 * registerWavBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerWavBackend(registry: BackendRegistry = defaultRegistry): WavBackend {
  const backend = new WavBackend();
  registry.register(backend);
  return backend;
}
