/**
 * @catlabtech/webcvt-container-mp3
 *
 * MPEG-1/2 Layer III (MP3) container parser and serializer for webcvt.
 *
 * Implementation references:
 * This package is implemented from ISO/IEC 11172-3 (MPEG-1 Audio) and the
 * ID3v2.4 structure and frames documents published by id3.org. The Xing
 * VBR header and LAME extension are covered by unofficial but
 * well-documented community references. No code was copied from other
 * implementations. Test fixtures derived from FFmpeg samples (LGPL-2.1)
 * live under `tests/fixtures/audio/` and are not redistributed in npm.
 */

// Types
export type { Mp3FrameHeader, Mp3Frame } from './frame-header.ts';
export type { Id3v2Tag, Id3v2Frame } from './id3v2.ts';
export type { Id3v1Tag } from './id3v1.ts';
export type { XingHeader, LameExtension } from './xing.ts';
export type { Mp3File } from './parser.ts';

// Errors
export {
  Mp3FreeFormatError,
  Mp3Mpeg25EncodeNotSupportedError,
  Mp3InvalidFrameError,
  Mp3UnsynchronisationError,
  Mp3EncodeNotImplementedError,
} from './errors.ts';

// Core parsing / serialization
export { parseMp3 } from './parser.ts';
export { serializeMp3 } from './serializer.ts';

// Low-level primitives (useful for consumers)
export { parseMp3FrameHeader, sideInfoSize } from './frame-header.ts';
export { parseId3v2, serializeId3v2 } from './id3v2.ts';
export { parseId3v1, serializeId3v1 } from './id3v1.ts';
export { parseXingHeader } from './xing.ts';

// Backend
export { Mp3Backend, MP3_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// registerMp3Backend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { Mp3Backend } from './backend.ts';

/**
 * Construct a Mp3Backend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('container-mp3')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerMp3Backend } from '@catlabtech/webcvt-container-mp3';
 * registerMp3Backend(); // registers into core's defaultRegistry
 * ```
 */
export function registerMp3Backend(registry: BackendRegistry = defaultRegistry): Mp3Backend {
  const backend = new Mp3Backend();
  registry.register(backend);
  return backend;
}
