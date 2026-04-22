/**
 * WAV-specific error classes extending WebcvtError.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown when the input begins with RF64 rather than RIFF.
 * RF64 support (EBU Tech 3306) is deferred to Phase 2.
 */
export class WavTooLargeError extends WebcvtError {
  constructor() {
    super(
      'WAV_TOO_LARGE',
      'RF64 WAV files (>4 GiB) are not supported in Phase 1. RF64 support is planned for Phase 2 (EBU Tech 3306).',
    );
    this.name = 'WavTooLargeError';
  }
}

/**
 * Thrown when a WAVEFORMATEXTENSIBLE subformat GUID is not PCM or IEEE float.
 */
export class UnsupportedSubFormatError extends WebcvtError {
  readonly guid: string;
  constructor(guid: string) {
    super(
      'WAV_UNSUPPORTED_SUBFORMAT',
      `Unsupported WAVEFORMATEXTENSIBLE subformat GUID: ${guid}. Only PCM (KSDATAFORMAT_SUBTYPE_PCM) and IEEE float are supported.`,
    );
    this.name = 'UnsupportedSubFormatError';
    this.guid = guid;
  }
}

/**
 * Thrown when required WAV chunks (fmt  or data) are missing.
 */
export class WavFormatError extends WebcvtError {
  constructor(message: string) {
    super('WAV_FORMAT_ERROR', message);
    this.name = 'WavFormatError';
  }
}
