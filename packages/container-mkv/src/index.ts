/**
 * @catlabtech/webcvt-container-mkv — Matroska container muxer and demuxer.
 *
 * Public API surface (minimal — do not re-export internal helpers).
 */

// Parser / serializer entry points.
export { parseMkv } from './parser.ts';
export type { MkvFile } from './parser.ts';

export { serializeMkv } from './serializer.ts';

// Element types.
export type { MkvEbmlHeader } from './elements/header.ts';
export type { MkvInfo } from './elements/segment-info.ts';
export type {
  MkvTrack,
  MkvVideoTrack,
  MkvAudioTrack,
  MkvSubtitleTrack,
  MkvVideoCodecId,
  MkvAudioCodecId,
  MkvSubtitleCodecId,
} from './elements/tracks.ts';
export type { MkvCluster, MkvSimpleBlock } from './elements/cluster.ts';
export type { MkvCuePoint } from './elements/cues.ts';
export type { MkvSeekHead, MkvSeekEntry } from './elements/seek-head.ts';
export type { MkvChapter } from './elements/chapters.ts';
export type { MkvTag } from './elements/tags.ts';

// Block iterators.
export {
  iterateVideoChunks,
  iterateAudioChunks,
  type VideoChunk,
  type AudioChunk,
} from './block-iterator.ts';

// Backend registration.
export { MkvBackend, MKV_FORMAT } from './backend.ts';

// EBML generic error classes (re-exported from @catlabtech/webcvt-ebml for consumer convenience).
export {
  EbmlVintError,
  EbmlElementTooLargeError,
  EbmlTooManyElementsError,
  EbmlDepthExceededError,
  EbmlTruncatedError,
  EbmlUnknownSizeError,
} from '@catlabtech/webcvt-ebml';

// Typed error classes (exported so callers can catch by type).
export {
  MkvInputTooLargeError,
  MkvDocTypeNotSupportedError,
  MkvEbmlVersionError,
  MkvEbmlLimitError,
  MkvMissingElementError,
  MkvUnsupportedCodecError,
  MkvLacingNotSupportedError,
  MkvMultiTrackNotSupportedError,
  MkvTooManyTracksError,
  MkvDuplicateTrackNumberError,
  MkvUnsupportedTrackTypeError,
  MkvMissingTimecodeError,
  MkvCodecPrivateTooLargeError,
  MkvTooManyBlocksError,
  MkvCorruptStreamError,
  MkvMissingSegmentError,
  MkvTooManyCuePointsError,
  MkvTooManyChaptersError,
  MkvTooManyTagsError,
  MkvEncodeNotImplementedError,
  MkvEncryptionNotSupportedError,
  MkvInvalidCodecPrivateError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// registerMkvBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { MkvBackend } from './backend.ts';

/**
 * Construct a MkvBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('container-mkv')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerMkvBackend } from '@catlabtech/webcvt-container-mkv';
 * registerMkvBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerMkvBackend(registry: BackendRegistry = defaultRegistry): MkvBackend {
  const backend = new MkvBackend();
  registry.register(backend);
  return backend;
}
