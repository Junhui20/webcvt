/**
 * TS-specific error classes extending WebcvtError.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from container-ts — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the input exceeds the 200 MiB size cap. */
export class TsInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'TS_INPUT_TOO_LARGE',
      `TS input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'TsInputTooLargeError';
  }
}

/** Thrown when sync byte 0x47 cannot be found within MAX_SYNC_SCAN_BYTES. */
export class TsNoSyncByteError extends WebcvtError {
  constructor(scanned: number) {
    super(
      'TS_NO_SYNC_BYTE',
      `MPEG-TS sync byte 0x47 not found within ${scanned} bytes. Not a valid MPEG-TS stream.`,
    );
    this.name = 'TsNoSyncByteError';
  }
}

/** Thrown when transport_scrambling_control != 0. */
export class TsScrambledNotSupportedError extends WebcvtError {
  constructor(pid: number, scramblingControl: number, packetOffset: number) {
    super(
      'TS_SCRAMBLED_NOT_SUPPORTED',
      `Scrambled packet at offset ${packetOffset} (PID 0x${pid.toString(16)}, scrambling_control=${scramblingControl}). Scrambled streams are not supported.`,
    );
    this.name = 'TsScrambledNotSupportedError';
  }
}

/** Thrown when adaptation_field_control == 0b00 (reserved). */
export class TsReservedAdaptationControlError extends WebcvtError {
  constructor(packetOffset: number) {
    super(
      'TS_RESERVED_ADAPTATION_CONTROL',
      `Packet at offset ${packetOffset} has adaptation_field_control=0b00 which is reserved/illegal.`,
    );
    this.name = 'TsReservedAdaptationControlError';
  }
}

/** Thrown when a PAT with more than one non-zero program is encountered. */
export class TsMultiProgramNotSupportedError extends WebcvtError {
  constructor(count: number) {
    super(
      'TS_MULTI_PROGRAM_NOT_SUPPORTED',
      `PAT contains ${count} programs; only single-program TS is supported in first pass.`,
    );
    this.name = 'TsMultiProgramNotSupportedError';
  }
}

/** Thrown when no PAT section is ever seen in the stream. */
export class TsMissingPatError extends WebcvtError {
  constructor() {
    super('TS_MISSING_PAT', 'No PAT (Program Association Table) found in the TS stream.');
    this.name = 'TsMissingPatError';
  }
}

/** Thrown when a PAT is seen but PMT is not found within MAX_PSI_WAIT_PACKETS. */
export class TsMissingPmtError extends WebcvtError {
  constructor(pmtPid: number, waitedPackets: number) {
    super(
      'TS_MISSING_PMT',
      `PMT at PID 0x${pmtPid.toString(16)} not seen within ${waitedPackets} packets after PAT.`,
    );
    this.name = 'TsMissingPmtError';
  }
}

/** Thrown when a non-empty TS input parses to zero PES packets. */
export class TsCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('TS_CORRUPT_STREAM', `TS stream is corrupt: ${reason}`);
    this.name = 'TsCorruptStreamError';
  }
}

/** Thrown when PSI CRC-32 validation fails. */
export class TsPsiCrcError extends WebcvtError {
  constructor(tableId: number, pid: number, expected: number, got: number) {
    super(
      'TS_PSI_CRC_ERROR',
      `PSI CRC-32 mismatch for table_id=0x${tableId.toString(16)} at PID 0x${pid.toString(16)}: expected 0x${expected.toString(16)}, got 0x${got.toString(16)}.`,
    );
    this.name = 'TsPsiCrcError';
  }
}

/** Thrown when packet count exceeds MAX_PACKETS. */
export class TsTooManyPacketsError extends WebcvtError {
  constructor(max: number) {
    super(
      'TS_TOO_MANY_PACKETS',
      `Packet count exceeds maximum of ${max}. The input may be corrupt or adversarially crafted.`,
    );
    this.name = 'TsTooManyPacketsError';
  }
}

/** Thrown when encode is requested for a path not supported by this backend. */
export class TsEncodeNotImplementedError extends WebcvtError {
  constructor(reason: string) {
    super(
      'TS_ENCODE_NOT_IMPLEMENTED',
      `TS encode not implemented: ${reason}. Install @catlabtech/webcvt-backend-wasm for transcode support.`,
    );
    this.name = 'TsEncodeNotImplementedError';
  }
}

/** Thrown when a PES packet exceeds the MAX_PES_BYTES size cap. */
export class TsPesTooLargeError extends WebcvtError {
  constructor(accumulated: number, max: number) {
    super(
      'TS_PES_TOO_LARGE',
      `PES packet exceeds maximum size: accumulated ${accumulated} bytes, cap is ${max} bytes.`,
    );
    this.name = 'TsPesTooLargeError';
  }
}

/** Thrown when adaptation_field_length is > 183 (illegal per ISO/IEC 13818-1). */
export class TsInvalidAdaptationLengthError extends WebcvtError {
  constructor(afLength: number, packetOffset: number) {
    super(
      'TS_INVALID_ADAPTATION_LENGTH',
      `Packet at offset ${packetOffset} has adaptation_field_length=${afLength} which exceeds the maximum of 183.`,
    );
    this.name = 'TsInvalidAdaptationLengthError';
  }
}
