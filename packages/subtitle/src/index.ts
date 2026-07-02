// Intermediate representation
export type { Cue, CueStyle, SubtitleTrack } from './cue.ts';

// SRT
export { parseSrt, serializeSrt, SubtitleParseError } from './srt.ts';

// VTT
export { parseVtt, serializeVtt } from './vtt.ts';
export type { VttCueSettings } from './vtt.ts';

// ASS
export { parseAss, serializeAss } from './ass.ts';
export type { AssParseOptions } from './ass.ts';

// SSA
export { parseSsa, serializeSsa } from './ssa.ts';

// MicroDVD
export { parseSub, serializeSub, VobSubError, DEFAULT_FPS } from './sub.ts';

// MPL2
export { parseMpl, serializeMpl } from './mpl.ts';

// Backend
export { SubtitleBackend, detectSubtitleFormat } from './subtitle-backend.ts';

// ---------------------------------------------------------------------------
// registerSubtitleBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { SubtitleBackend } from './subtitle-backend.ts';

/**
 * Construct a SubtitleBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('subtitle')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerSubtitleBackend } from '@catlabtech/webcvt-subtitle';
 * registerSubtitleBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerSubtitleBackend(
  registry: BackendRegistry = defaultRegistry,
): SubtitleBackend {
  const backend = new SubtitleBackend();
  registry.register(backend);
  return backend;
}
