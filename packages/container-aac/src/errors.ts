/**
 * AAC/ADTS-specific error classes extending WebcvtError.
 *
 * All error codes are uppercase snake_case strings for programmatic matching.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the input is larger than the 200 MiB cap. */
export class AdtsInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'ADTS_INPUT_TOO_LARGE',
      `ADTS input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'AdtsInputTooLargeError';
  }
}

/** Thrown when a frame header declares aac_frame_length past EOF. */
export class AdtsTruncatedFrameError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number, frameBytes: number, available: number) {
    super(
      'ADTS_TRUNCATED_FRAME',
      `ADTS frame at offset ${offset} claims ${frameBytes} bytes but only ${available} bytes remain.`,
    );
    this.name = 'AdtsTruncatedFrameError';
    this.offset = offset;
  }
}

/** Thrown when the stream is so corrupt that no valid frames were found. */
export class AdtsCorruptStreamError extends WebcvtError {
  constructor(candidates: number) {
    super(
      'ADTS_CORRUPT_STREAM',
      `ADTS stream appears corrupt: ${candidates} sync candidates found but all rejected. No valid frames decoded.`,
    );
    this.name = 'AdtsCorruptStreamError';
  }
}

/**
 * Thrown when channel_configuration == 0 (PCE-defined channels).
 * Phase 1 does not decode Program Config Elements.
 */
export class AdtsPceRequiredError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number) {
    super(
      'ADTS_PCE_REQUIRED',
      `ADTS frame at offset ${offset} uses channel_configuration=0 (PCE-defined channels). PCE decoding is not supported in Phase 1.`,
    );
    this.name = 'AdtsPceRequiredError';
    this.offset = offset;
  }
}

/** Thrown when sampling_frequency_index is 13 (reserved), 14 (reserved), or 15 (explicit rate). */
export class AdtsReservedSampleRateError extends WebcvtError {
  readonly offset: number;
  readonly index: number;

  constructor(offset: number, index: number) {
    const reason =
      index === 15
        ? 'explicit 24-bit rate (index 15) is not seen in practice — please file a bug'
        : `index ${index} is reserved`;
    super(
      'ADTS_RESERVED_SAMPLE_RATE',
      `ADTS frame at offset ${offset} has unsupported sampling_frequency_index ${index}: ${reason}.`,
    );
    this.name = 'AdtsReservedSampleRateError';
    this.offset = offset;
    this.index = index;
  }
}

/** Thrown when the ADTS layer field is non-zero (must always be 00). */
export class AdtsInvalidLayerError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number, layer: number) {
    super(
      'ADTS_INVALID_LAYER',
      `ADTS frame at offset ${offset} has layer=${layer}; ADTS layer must always be 0.`,
    );
    this.name = 'AdtsInvalidLayerError';
    this.offset = offset;
  }
}

/** Thrown when rawBlocks > 0 (multiple raw_data_blocks per ADTS frame — Phase 1 unsupported). */
export class AdtsMultipleRawBlocksUnsupportedError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number, rawBlocks: number) {
    super(
      'ADTS_MULTIPLE_RAW_BLOCKS_UNSUPPORTED',
      `ADTS frame at offset ${offset} contains ${rawBlocks + 1} raw_data_blocks per frame. Only single-block frames (rawBlocks=0) are supported in Phase 1.`,
    );
    this.name = 'AdtsMultipleRawBlocksUnsupportedError';
    this.offset = offset;
  }
}

/** Thrown when the ADTS profile is unsupported for AudioSpecificConfig building. */
export class AdtsInvalidProfileError extends WebcvtError {
  constructor(profile: number) {
    super(
      'ADTS_INVALID_PROFILE',
      `ADTS profile ${profile} is not supported for AudioSpecificConfig generation. Supported profiles: 0 (MAIN), 1 (LC), 2 (SSR), 3 (LTP).`,
    );
    this.name = 'AdtsInvalidProfileError';
  }
}

/**
 * Reserved for Phase 2: fresh CRC generation for ADTS frames.
 *
 * @deprecated Reserved for Phase 2; not currently thrown. In Phase 1 the serializer
 *   preserves CRC bytes verbatim from the parsed frame. This class is exported so
 *   consumers can reference the error code; removing it in Phase 2 requires deliberate
 *   test deletion to avoid silent breakage.
 */
export class AdtsCrcUnsupportedError extends WebcvtError {
  constructor() {
    super(
      'ADTS_CRC_UNSUPPORTED',
      'Generating a fresh ADTS CRC is not supported in Phase 1. CRCs from parsed frames are preserved verbatim on round-trip.',
    );
    this.name = 'AdtsCrcUnsupportedError';
  }
}

/** Thrown when a non-identity ADTS conversion is requested (Phase 1 decode-only). */
export class AdtsEncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'ADTS_ENCODE_NOT_IMPLEMENTED',
      'ADTS encoding from non-AAC input is not implemented in container-aac Phase 1. Install @catlabtech/webcvt-backend-wasm to enable transcode via ffmpeg.wasm.',
    );
    this.name = 'AdtsEncodeNotImplementedError';
  }
}
