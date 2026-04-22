/**
 * Ogg-specific error classes extending WebcvtError.
 *
 * All error codes are uppercase snake_case strings for programmatic matching.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the input exceeds the 200 MiB size cap. */
export class OggInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'OGG_INPUT_TOO_LARGE',
      `Ogg input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'OggInputTooLargeError';
  }
}

/** Thrown when no "OggS" capture pattern is found at the start of the input. */
export class OggCaptureMissingError extends WebcvtError {
  constructor() {
    super(
      'OGG_CAPTURE_MISSING',
      'No "OggS" capture pattern found. The input does not appear to be an Ogg file.',
    );
    this.name = 'OggCaptureMissingError';
  }
}

/** Thrown when stream_structure_version is non-zero. */
export class OggInvalidVersionError extends WebcvtError {
  constructor(version: number, offset: number) {
    super(
      'OGG_INVALID_VERSION',
      `Ogg page at offset ${offset} has stream_structure_version=${version}; only version 0 is valid.`,
    );
    this.name = 'OggInvalidVersionError';
  }
}

/** Thrown when a page sequence number gap is detected (lost pages = lost audio). */
export class OggSequenceGapError extends WebcvtError {
  readonly expected: number;
  readonly actual: number;

  constructor(serialNumber: number, expected: number, actual: number) {
    super(
      'OGG_SEQUENCE_GAP',
      `Ogg sequence gap on stream 0x${serialNumber.toString(16)}: expected page ${expected}, got ${actual}. Lost pages imply lost audio.`,
    );
    this.name = 'OggSequenceGapError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** Thrown when the stream is so corrupt that parsing failed completely. */
export class OggCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('OGG_CORRUPT_STREAM', `Ogg stream is corrupt: ${reason}`);
    this.name = 'OggCorruptStreamError';
  }
}

/** Thrown when multiplexed streams (concurrent serial numbers) are detected. */
export class OggMultiplexNotSupportedError extends WebcvtError {
  constructor(serialNumbers: number[]) {
    super(
      'OGG_MULTIPLEX_NOT_SUPPORTED',
      `Multiplexed Ogg streams are not supported in Phase 2. Found concurrent serial numbers: ${serialNumbers.map((n) => `0x${n.toString(16)}`).join(', ')}.`,
    );
    this.name = 'OggMultiplexNotSupportedError';
  }
}

/** Thrown when a reassembled packet exceeds the 16 MiB per-packet cap. */
export class OggPacketTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'OGG_PACKET_TOO_LARGE',
      `Ogg packet exceeds maximum size: ${size} bytes > ${max} bytes (16 MiB cap).`,
    );
    this.name = 'OggPacketTooLargeError';
  }
}

/** Thrown when a stream produces more packets than the per-stream cap. */
export class OggTooManyPacketsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'OGG_TOO_MANY_PACKETS',
      `Ogg stream produced ${count} packets; maximum is ${max} per stream.`,
    );
    this.name = 'OggTooManyPacketsError';
  }
}

/** Thrown when the page count exceeds the 2 million page cap. */
export class OggTooManyPagesError extends WebcvtError {
  constructor(max: number) {
    super(
      'OGG_TOO_MANY_PAGES',
      `Ogg file exceeds maximum of ${max} pages. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'OggTooManyPagesError';
  }
}

/** Thrown when an unsupported codec identification header is encountered. */
export class OggUnsupportedCodecError extends WebcvtError {
  constructor(hint: string) {
    super(
      'OGG_UNSUPPORTED_CODEC',
      `Ogg logical stream uses an unsupported codec: ${hint}. Supported codecs are Vorbis and Opus.`,
    );
    this.name = 'OggUnsupportedCodecError';
  }
}

/** Thrown when a Vorbis identification packet is malformed. */
export class OggVorbisHeaderError extends WebcvtError {
  constructor(reason: string) {
    super('OGG_VORBIS_HEADER_ERROR', `Vorbis identification header is invalid: ${reason}`);
    this.name = 'OggVorbisHeaderError';
  }
}

/** Thrown when an Opus identification packet is malformed. */
export class OggOpusHeaderError extends WebcvtError {
  constructor(reason: string) {
    super('OGG_OPUS_HEADER_ERROR', `Opus identification header (OpusHead) is invalid: ${reason}`);
    this.name = 'OggOpusHeaderError';
  }
}

/** Thrown when a non-identity Ogg encode conversion is requested (Phase 1). */
export class OggEncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'OGG_ENCODE_NOT_IMPLEMENTED',
      'Encoding to Ogg from non-Ogg input is not implemented in container-ogg Phase 1. ' +
        'Install @catlabtech/webcvt-backend-wasm to enable transcode via ffmpeg.wasm.',
    );
    this.name = 'OggEncodeNotImplementedError';
  }
}

/** Thrown when a Vorbis-comment framing bit is missing (Vorbis spec §5.2.1). */
export class OggVorbisCommentError extends WebcvtError {
  constructor(reason: string) {
    super('OGG_VORBIS_COMMENT_ERROR', `Vorbis comment packet is invalid: ${reason}`);
    this.name = 'OggVorbisCommentError';
  }
}

/** Thrown when a page body size or segment table entry sum is invalid. */
export class OggPageBodyTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'OGG_PAGE_BODY_TOO_LARGE',
      `Ogg page body is ${size} bytes; maximum is ${max} bytes (255 segments × 255 bytes).`,
    );
    this.name = 'OggPageBodyTooLargeError';
  }
}
