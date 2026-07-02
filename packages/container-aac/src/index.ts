/**
 * @catlabtech/webcvt-container-aac — ADTS-AAC container demuxer and muxer.
 *
 * Public API surface:
 * - parseAdts / serializeAdts — low-level ADTS frame I/O
 * - buildAudioSpecificConfig — ASC builder for WebCodecs / MP4 esds
 * - AacBackend / AAC_FORMAT — webcvt Backend integration
 * - All error classes for programmatic error handling
 * - AdtsHeader / AdtsFrame / AdtsFile types
 *
 * Implemented from ISO/IEC 14496-3:2019 §1.A.2 (ADTS frame format),
 * §1.6.2.1 (AudioSpecificConfig), and §1.6.3.3 (sampling_frequency_index table).
 */

// Types
export type { AdtsHeader, AdtsFrame, AdtsFile, AdtsProfile } from './header.ts';

// Core parsing / serialization
export { parseAdts } from './parser.ts';
export { serializeAdts } from './serializer.ts';

// AudioSpecificConfig builder
export { buildAudioSpecificConfig } from './asc.ts';

// Backend integration
export { AacBackend, AAC_FORMAT } from './backend.ts';

// Errors
export {
  AdtsInputTooLargeError,
  AdtsTruncatedFrameError,
  AdtsCorruptStreamError,
  AdtsPceRequiredError,
  AdtsReservedSampleRateError,
  AdtsInvalidLayerError,
  AdtsMultipleRawBlocksUnsupportedError,
  AdtsInvalidProfileError,
  AdtsCrcUnsupportedError,
  AdtsEncodeNotImplementedError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// registerAacBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { AacBackend } from './backend.ts';

/**
 * Construct an AacBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('container-aac')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerAacBackend } from '@catlabtech/webcvt-container-aac';
 * registerAacBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerAacBackend(registry: BackendRegistry = defaultRegistry): AacBackend {
  const backend = new AacBackend();
  registry.register(backend);
  return backend;
}
