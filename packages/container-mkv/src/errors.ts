/**
 * MKV-specific error classes extending WebcvtError.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from container-mkv — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@webcvt/core';

/** Thrown when the input exceeds the 200 MiB size cap. */
export class MkvInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'MKV_INPUT_TOO_LARGE',
      `MKV input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'MkvInputTooLargeError';
  }
}

/** Thrown when the EBML DocType is not "matroska". Trap §19. */
export class MkvDocTypeNotSupportedError extends WebcvtError {
  constructor(docType: string) {
    super(
      'MKV_DOCTYPE_NOT_SUPPORTED',
      `EBML DocType "${docType}" is not supported by container-mkv. Only DocType "matroska" is accepted. WebM support is in @webcvt/container-webm.`,
    );
    this.name = 'MkvDocTypeNotSupportedError';
  }
}

/** Thrown when EBMLVersion or EBMLReadVersion is not 1. */
export class MkvEbmlVersionError extends WebcvtError {
  constructor(field: string, value: number) {
    super('MKV_EBML_VERSION_ERROR', `${field} is ${value}; only value 1 is supported.`);
    this.name = 'MkvEbmlVersionError';
  }
}

/** Thrown when EBMLMaxIDLength > 4 or EBMLMaxSizeLength > 8. */
export class MkvEbmlLimitError extends WebcvtError {
  constructor(field: string, value: number, max: number) {
    super('MKV_EBML_LIMIT_ERROR', `${field} is ${value}; maximum supported is ${max}.`);
    this.name = 'MkvEbmlLimitError';
  }
}

/** Thrown when a required EBML element is missing. */
export class MkvMissingElementError extends WebcvtError {
  constructor(elementName: string, parent: string) {
    super('MKV_MISSING_ELEMENT', `Required element "${elementName}" not found inside "${parent}".`);
    this.name = 'MkvMissingElementError';
  }
}

/** Thrown when CodecID is not in the MKV allowlist. Trap §7. */
export class MkvUnsupportedCodecError extends WebcvtError {
  constructor(codecId: string) {
    super(
      'MKV_UNSUPPORTED_CODEC',
      `Codec "${codecId}" is not supported in first pass. Allowed codecs: V_MPEG4/ISO/AVC, V_MPEGH/ISO/HEVC, V_VP8, V_VP9, A_AAC, A_MPEG/L3, A_FLAC, A_VORBIS, A_OPUS.`,
    );
    this.name = 'MkvUnsupportedCodecError';
  }
}

/** Thrown when block lacing mode 10 (fixed-size) or 11 (EBML) is encountered. Trap §6. */
export class MkvLacingNotSupportedError extends WebcvtError {
  constructor(lacingMode: number) {
    super(
      'MKV_LACING_NOT_SUPPORTED',
      `SimpleBlock lacing mode ${lacingMode} (${lacingMode === 2 ? 'fixed-size' : 'EBML'}) is not supported. Only unlaced (0) and Xiph lacing (1) are supported in first pass.`,
    );
    this.name = 'MkvLacingNotSupportedError';
  }
}

/** Thrown when more than 1 video track or more than 1 audio track is found. */
export class MkvMultiTrackNotSupportedError extends WebcvtError {
  constructor(trackType: 'video' | 'audio', count: number) {
    super(
      'MKV_MULTI_TRACK_NOT_SUPPORTED',
      `Found ${count} ${trackType} tracks; only one ${trackType} track is supported in first pass.`,
    );
    this.name = 'MkvMultiTrackNotSupportedError';
  }
}

/** Thrown when a TrackType value other than 1 (video) or 2 (audio) is encountered. */
export class MkvUnsupportedTrackTypeError extends WebcvtError {
  constructor(trackType: number) {
    super(
      'MKV_UNSUPPORTED_TRACK_TYPE',
      `TrackType ${trackType} is not supported. Only 1 (video) and 2 (audio) are supported in first pass.`,
    );
    this.name = 'MkvUnsupportedTrackTypeError';
  }
}

/** Thrown when a Cluster is missing its required Timecode element. */
export class MkvMissingTimecodeError extends WebcvtError {
  constructor(clusterOffset: number) {
    super(
      'MKV_MISSING_TIMECODE',
      `Cluster at file offset ${clusterOffset} is missing the required Timecode element.`,
    );
    this.name = 'MkvMissingTimecodeError';
  }
}

/** Thrown when a CodecPrivate payload exceeds MAX_CODEC_PRIVATE_BYTES (1 MiB). */
export class MkvCodecPrivateTooLargeError extends WebcvtError {
  constructor(size: bigint, max: number) {
    super(
      'MKV_CODEC_PRIVATE_TOO_LARGE',
      `CodecPrivate payload is ${size} bytes; maximum is ${max} bytes (1 MiB).`,
    );
    this.name = 'MkvCodecPrivateTooLargeError';
  }
}

/** Thrown when the per-track block count exceeds MAX_BLOCKS_PER_TRACK. */
export class MkvTooManyBlocksError extends WebcvtError {
  constructor(trackNumber: number, max: number) {
    super(
      'MKV_TOO_MANY_BLOCKS',
      `Track ${trackNumber} exceeds the maximum of ${max} blocks per track.`,
    );
    this.name = 'MkvTooManyBlocksError';
  }
}

/** Thrown when a non-empty MKV input parses to zero tracks. */
export class MkvCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('MKV_CORRUPT_STREAM', `MKV stream is corrupt: ${reason}`);
    this.name = 'MkvCorruptStreamError';
  }
}

/** Thrown when the Segment element is missing from the file. */
export class MkvMissingSegmentError extends WebcvtError {
  constructor() {
    super(
      'MKV_MISSING_SEGMENT',
      'No Segment element found after EBML header. Not a valid Matroska file.',
    );
    this.name = 'MkvMissingSegmentError';
  }
}

/** Thrown when the Cues element contains more than MAX_CUE_POINTS entries. */
export class MkvTooManyCuePointsError extends WebcvtError {
  constructor(max: number) {
    super(
      'MKV_TOO_MANY_CUE_POINTS',
      `Cues element contains more than ${max} CuePoint entries. Input may be crafted.`,
    );
    this.name = 'MkvTooManyCuePointsError';
  }
}

/** Thrown when encode is requested for a path not supported by this backend. */
export class MkvEncodeNotImplementedError extends WebcvtError {
  constructor(reason: string) {
    super(
      'MKV_ENCODE_NOT_IMPLEMENTED',
      `MKV encode not implemented: ${reason}. Install @webcvt/backend-wasm for transcode support.`,
    );
    this.name = 'MkvEncodeNotImplementedError';
  }
}

/** Thrown when a ContentEncoding (encrypted track) is encountered. */
export class MkvEncryptionNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'MKV_ENCRYPTION_NOT_SUPPORTED',
      'ContentEncoding (encryption) is not supported in first pass.',
    );
    this.name = 'MkvEncryptionNotSupportedError';
  }
}

/** Thrown when CodecPrivate is malformed for a given codec. */
export class MkvInvalidCodecPrivateError extends WebcvtError {
  constructor(codecId: string, reason: string) {
    super('MKV_INVALID_CODEC_PRIVATE', `CodecPrivate for ${codecId} is invalid: ${reason}`);
    this.name = 'MkvInvalidCodecPrivateError';
  }
}
