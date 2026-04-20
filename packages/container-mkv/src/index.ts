/**
 * @webcvt/container-mkv — Matroska container muxer and demuxer.
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
  MkvVideoCodecId,
  MkvAudioCodecId,
} from './elements/tracks.ts';
export type { MkvCluster, MkvSimpleBlock } from './elements/cluster.ts';
export type { MkvCuePoint } from './elements/cues.ts';
export type { MkvSeekHead, MkvSeekEntry } from './elements/seek-head.ts';

// Block iterators.
export {
  iterateVideoChunks,
  iterateAudioChunks,
  type VideoChunk,
  type AudioChunk,
} from './block-iterator.ts';

// Backend registration.
export { MkvBackend, MKV_FORMAT } from './backend.ts';

// EBML generic error classes (re-exported from @webcvt/ebml for consumer convenience).
export {
  EbmlVintError,
  EbmlElementTooLargeError,
  EbmlTooManyElementsError,
  EbmlDepthExceededError,
  EbmlTruncatedError,
  EbmlUnknownSizeError,
} from '@webcvt/ebml';

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
  MkvUnsupportedTrackTypeError,
  MkvMissingTimecodeError,
  MkvCodecPrivateTooLargeError,
  MkvTooManyBlocksError,
  MkvCorruptStreamError,
  MkvMissingSegmentError,
  MkvTooManyCuePointsError,
  MkvEncodeNotImplementedError,
  MkvEncryptionNotSupportedError,
  MkvInvalidCodecPrivateError,
} from './errors.ts';
