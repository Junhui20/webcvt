/**
 * FLAC-specific error classes extending WebcvtError.
 *
 * All error codes are uppercase snake_case strings for programmatic matching.
 */

import { WebcvtError } from '@webcvt/core';

/** Thrown when the input is larger than the 200 MiB cap. */
export class FlacInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'FLAC_INPUT_TOO_LARGE',
      `FLAC input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'FlacInputTooLargeError';
  }
}

/** Thrown when the `fLaC` magic bytes are absent after any ID3v2 prefix. */
export class FlacInvalidMagicError extends WebcvtError {
  constructor(offset: number) {
    super(
      'FLAC_INVALID_MAGIC',
      `Expected "fLaC" magic at offset ${offset}; bytes do not match. The file may not be a FLAC file.`,
    );
    this.name = 'FlacInvalidMagicError';
  }
}

/** Thrown when a metadata block header or body is malformed. */
export class FlacInvalidMetadataError extends WebcvtError {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super('FLAC_INVALID_METADATA', `Invalid FLAC metadata at offset ${offset}: ${message}`);
    this.name = 'FlacInvalidMetadataError';
    this.offset = offset;
  }
}

/** Thrown when a frame header CRC-8 mismatch is detected. */
export class FlacCrc8MismatchError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number, expected: number, actual: number) {
    super(
      'FLAC_CRC8_MISMATCH',
      `Frame header CRC-8 mismatch at offset ${offset}: expected 0x${expected.toString(16).padStart(2, '0')}, got 0x${actual.toString(16).padStart(2, '0')}.`,
    );
    this.name = 'FlacCrc8MismatchError';
    this.offset = offset;
  }
}

/** Thrown when a full-frame CRC-16 mismatch is detected. */
export class FlacCrc16MismatchError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number, expected: number, actual: number) {
    super(
      'FLAC_CRC16_MISMATCH',
      `Frame CRC-16 mismatch at offset ${offset}: expected 0x${expected.toString(16).padStart(4, '0')}, got 0x${actual.toString(16).padStart(4, '0')}.`,
    );
    this.name = 'FlacCrc16MismatchError';
    this.offset = offset;
  }
}

/** Thrown when the UTF-8 varint in a frame header is malformed. */
export class FlacInvalidVarintError extends WebcvtError {
  readonly offset: number;

  constructor(offset: number) {
    super(
      'FLAC_INVALID_VARINT',
      `Malformed UTF-8-style variable-length integer at offset ${offset}.`,
    );
    this.name = 'FlacInvalidVarintError';
    this.offset = offset;
  }
}

/** Thrown when a frame header contains a reserved/invalid nibble value. */
export class FlacInvalidFrameError extends WebcvtError {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super('FLAC_INVALID_FRAME', `Invalid FLAC frame at offset ${offset}: ${message}`);
    this.name = 'FlacInvalidFrameError';
    this.offset = offset;
  }
}

/** Thrown by the backend when FLAC encode is requested (Phase 1 decode-only). */
export class FlacEncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'FLAC_ENCODE_NOT_IMPLEMENTED',
      'FLAC encoding is not implemented in container-flac. ' +
        'WebCodecs AudioEncoder does not support FLAC output. ' +
        'Install @webcvt/backend-wasm to enable FLAC encoding via libFLAC.',
    );
    this.name = 'FlacEncodeNotImplementedError';
  }
}
