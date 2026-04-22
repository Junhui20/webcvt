/**
 * @catlabtech/webcvt-container-webm — WebM container muxer and demuxer.
 *
 * Public API surface (minimal per Lesson #6 — do not re-export internal helpers).
 */

// Parser / serializer entry points.
export { parseWebm } from './parser.ts';
export type { WebmFile } from './parser.ts';

export { serializeWebm } from './serializer.ts';

// Element types.
export type { WebmEbmlHeader } from './elements/header.ts';
export type { WebmInfo } from './elements/segment-info.ts';
export type {
  WebmTrack,
  WebmVideoTrack,
  WebmAudioTrack,
  WebmCodecId,
} from './elements/tracks.ts';
export type { WebmCluster, WebmSimpleBlock } from './elements/cluster.ts';
export type { WebmCuePoint } from './elements/cues.ts';
export type { WebmSeekHead, WebmSeekEntry } from './elements/seek-head.ts';

// Block iterators.
export {
  iterateVideoChunks,
  iterateAudioChunks,
  type VideoChunk,
  type AudioChunk,
} from './block-iterator.ts';

// Backend registration.
export { WebmBackend, WEBM_FORMAT } from './backend.ts';

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
  WebmInputTooLargeError,
  WebmDocTypeNotSupportedError,
  WebmEbmlVersionError,
  WebmEbmlLimitError,
  WebmMissingElementError,
  WebmUnsupportedCodecError,
  WebmLacingNotSupportedError,
  WebmMultiTrackNotSupportedError,
  WebmUnsupportedTrackTypeError,
  WebmMissingTimecodeError,
  WebmCodecPrivateTooLargeError,
  WebmTooManyBlocksError,
  WebmCorruptStreamError,
  WebmMissingSegmentError,
  WebmTooManyCuePointsError,
  WebmEncodeNotImplementedError,
} from './errors.ts';
