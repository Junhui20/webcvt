/**
 * MP3-specific error classes extending WebcvtError.
 *
 * All error codes are uppercase snake_case strings for programmatic matching.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown when a frame header reports bitrate_index == 0 (free-format).
 *
 * Free-format frames have no derivable frame length from the header — the
 * length must be detected by scanning forward for the next sync word.
 * Phase 1 scope: throw; Phase 2 will add optional forward-scan support.
 * Spec: ISO/IEC 11172-3 §2.4.2.3.
 */
export class Mp3FreeFormatError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number) {
    super(
      'MP3_FREE_FORMAT',
      `Free-format MP3 frame at offset ${offset} is not supported in Phase 1. Free-format frames require forward-scanning to determine frame length (Phase 2).`,
    );
    this.name = 'Mp3FreeFormatError';
    this.offset = offset;
  }
}

/**
 * Thrown by the serializer when asked to write MPEG 2.5 frames.
 *
 * MPEG 2.5 (version bits 00) is an unofficial Fraunhofer extension; the
 * parser accepts it read-only. The serializer refuses to emit it to avoid
 * producing non-standard output.
 */
export class Mp3Mpeg25EncodeNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'MP3_MPEG25_ENCODE_NOT_SUPPORTED',
      'Serializing MPEG 2.5 frames is not supported. MPEG 2.5 is an unofficial extension ' +
        'that the parser reads but the serializer will not emit. ' +
        'Re-encode the audio at a standard MPEG-1 or MPEG-2 sample rate.',
    );
    this.name = 'Mp3Mpeg25EncodeNotSupportedError';
  }
}

/**
 * Thrown when a frame header fails basic validity checks.
 *
 * Covers: invalid layer, reserved version, reserved sampling_frequency,
 * bitrate_index == 15 (bad), truncated input, or sync word absent where
 * required.
 */
export class Mp3InvalidFrameError extends WebcvtError {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super('MP3_INVALID_FRAME', `Invalid MP3 frame at offset ${offset}: ${message}`);
    this.name = 'Mp3InvalidFrameError';
    this.offset = offset;
  }
}

/**
 * Thrown when ID3v2 unsynchronisation decoding fails (malformed byte stream).
 */
export class Mp3UnsynchronisationError extends WebcvtError {
  constructor(message: string) {
    super('MP3_UNSYNCHRONISATION_ERROR', `ID3v2 unsynchronisation error: ${message}`);
    this.name = 'Mp3UnsynchronisationError';
  }
}

/**
 * Thrown by the backend when MP3 encode is requested.
 *
 * WebCodecsAudioEncoder does not support mp3 output in current browsers.
 * Phase 1 is decode-only; encoding is deferred to a future lamejs-based phase.
 */
export class Mp3EncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'MP3_ENCODE_NOT_IMPLEMENTED',
      'MP3 encoding is not implemented in Phase 1. ' +
        'WebCodecs AudioEncoder does not support mp3 output in current browsers. ' +
        'A lamejs-based encode path is planned for a future phase.',
    );
    this.name = 'Mp3EncodeNotImplementedError';
  }
}
