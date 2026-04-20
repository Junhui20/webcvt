/**
 * WebM-specific error classes extending WebcvtError.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from container-webm — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@webcvt/core';

/** Thrown when the input exceeds the 200 MiB size cap. */
export class WebmInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'WEBM_INPUT_TOO_LARGE',
      `WebM input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'WebmInputTooLargeError';
  }
}

/** Thrown when the EBML DocType is not "webm" (e.g. "matroska" → deferred to container-mkv). */
export class WebmDocTypeNotSupportedError extends WebcvtError {
  constructor(docType: string) {
    super(
      'WEBM_DOCTYPE_NOT_SUPPORTED',
      `EBML DocType "${docType}" is not supported by container-webm. Only DocType "webm" is accepted. Generic Matroska support is in the separate @webcvt/container-mkv package (Phase 3).`,
    );
    this.name = 'WebmDocTypeNotSupportedError';
  }
}

/** Thrown when EBMLVersion or EBMLReadVersion is not 1. */
export class WebmEbmlVersionError extends WebcvtError {
  constructor(field: string, value: number) {
    super('WEBM_EBML_VERSION_ERROR', `${field} is ${value}; only value 1 is supported.`);
    this.name = 'WebmEbmlVersionError';
  }
}

/** Thrown when EBMLMaxIDLength > 4 or EBMLMaxSizeLength > 8. */
export class WebmEbmlLimitError extends WebcvtError {
  constructor(field: string, value: number, max: number) {
    super('WEBM_EBML_LIMIT_ERROR', `${field} is ${value}; maximum supported is ${max}.`);
    this.name = 'WebmEbmlLimitError';
  }
}

/** Thrown when a required EBML element is missing. */
export class WebmMissingElementError extends WebcvtError {
  constructor(elementName: string, parent: string) {
    super(
      'WEBM_MISSING_ELEMENT',
      `Required element "${elementName}" not found inside "${parent}".`,
    );
    this.name = 'WebmMissingElementError';
  }
}

/** Thrown when CodecID is not in the allowlist {V_VP8, V_VP9, A_VORBIS, A_OPUS}. */
export class WebmUnsupportedCodecError extends WebcvtError {
  constructor(codecId: string) {
    super(
      'WEBM_UNSUPPORTED_CODEC',
      `Codec "${codecId}" is not supported. Allowed codecs: V_VP8, V_VP9, A_VORBIS, A_OPUS. AV1, AAC, subtitle tracks, and other codecs are deferred.`,
    );
    this.name = 'WebmUnsupportedCodecError';
  }
}

/** Thrown when lacing mode 10 (fixed-size) or 11 (EBML) is encountered. */
export class WebmLacingNotSupportedError extends WebcvtError {
  constructor(lacingMode: number) {
    super(
      'WEBM_LACING_NOT_SUPPORTED',
      `SimpleBlock lacing mode ${lacingMode} (${lacingMode === 2 ? 'fixed-size' : 'EBML'}) is not supported. Only unlaced (0) and Xiph lacing (1) are supported in first pass.`,
    );
    this.name = 'WebmLacingNotSupportedError';
  }
}

/** Thrown when more than 1 video track or more than 1 audio track is found. */
export class WebmMultiTrackNotSupportedError extends WebcvtError {
  constructor(trackType: 'video' | 'audio', count: number) {
    super(
      'WEBM_MULTI_TRACK_NOT_SUPPORTED',
      `Found ${count} ${trackType} tracks; only one ${trackType} track is supported in first pass. Multiple track support is deferred.`,
    );
    this.name = 'WebmMultiTrackNotSupportedError';
  }
}

/** Thrown when a TrackType value other than 1 (video) or 2 (audio) is encountered. */
export class WebmUnsupportedTrackTypeError extends WebcvtError {
  constructor(trackType: number) {
    super(
      'WEBM_UNSUPPORTED_TRACK_TYPE',
      `TrackType ${trackType} is not supported. Only 1 (video) and 2 (audio) are supported in first pass.`,
    );
    this.name = 'WebmUnsupportedTrackTypeError';
  }
}

/** Thrown when a Cluster is missing its required Timecode element. */
export class WebmMissingTimecodeError extends WebcvtError {
  constructor(clusterOffset: number) {
    super(
      'WEBM_MISSING_TIMECODE',
      `Cluster at file offset ${clusterOffset} is missing the required Timecode element. All Clusters in WebM must have a Timecode.`,
    );
    this.name = 'WebmMissingTimecodeError';
  }
}

/** Thrown when a CodecPrivate payload exceeds MAX_CODEC_PRIVATE_BYTES (1 MiB). */
export class WebmCodecPrivateTooLargeError extends WebcvtError {
  constructor(size: bigint, max: number) {
    super(
      'WEBM_CODEC_PRIVATE_TOO_LARGE',
      `CodecPrivate payload is ${size} bytes; maximum is ${max} bytes (1 MiB).`,
    );
    this.name = 'WebmCodecPrivateTooLargeError';
  }
}

/** Thrown when the per-track block count exceeds MAX_BLOCKS_PER_TRACK. */
export class WebmTooManyBlocksError extends WebcvtError {
  constructor(trackNumber: number, max: number) {
    super(
      'WEBM_TOO_MANY_BLOCKS',
      `Track ${trackNumber} exceeds the maximum of ${max} blocks per track.`,
    );
    this.name = 'WebmTooManyBlocksError';
  }
}

/**
 * Thrown when a non-empty WebM input parses to zero tracks.
 * This is the FLAC M-1 / MP4 pattern — indicates top-level structural corruption.
 */
export class WebmCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('WEBM_CORRUPT_STREAM', `WebM stream is corrupt: ${reason}`);
    this.name = 'WebmCorruptStreamError';
  }
}

/** Thrown when the Segment element is missing from the file. */
export class WebmMissingSegmentError extends WebcvtError {
  constructor() {
    super(
      'WEBM_MISSING_SEGMENT',
      'No Segment element found after EBML header. Not a valid WebM file.',
    );
    this.name = 'WebmMissingSegmentError';
  }
}

/** Thrown when the Cues element contains more than MAX_CUE_POINTS entries. */
export class WebmTooManyCuePointsError extends WebcvtError {
  constructor(max: number) {
    super(
      'WEBM_TOO_MANY_CUE_POINTS',
      `Cues element contains more than ${max} CuePoint entries. Input may be crafted.`,
    );
    this.name = 'WebmTooManyCuePointsError';
  }
}

/** Thrown when encode is requested for a path not supported by this backend. */
export class WebmEncodeNotImplementedError extends WebcvtError {
  constructor(reason: string) {
    super(
      'WEBM_ENCODE_NOT_IMPLEMENTED',
      `WebM encode not implemented: ${reason}. Install @webcvt/backend-wasm for transcode support.`,
    );
    this.name = 'WebmEncodeNotImplementedError';
  }
}
