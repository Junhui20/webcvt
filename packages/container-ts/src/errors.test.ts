import { WebcvtError } from '@webcvt/core';
import { describe, expect, it } from 'vitest';
import {
  TsCorruptStreamError,
  TsEncodeNotImplementedError,
  TsInputTooLargeError,
  TsMissingPatError,
  TsMissingPmtError,
  TsMultiProgramNotSupportedError,
  TsNoSyncByteError,
  TsPsiCrcError,
  TsReservedAdaptationControlError,
  TsScrambledNotSupportedError,
  TsTooManyPacketsError,
} from './errors.ts';

describe('TS error classes', () => {
  it('TsInputTooLargeError is a WebcvtError', () => {
    const e = new TsInputTooLargeError(300_000_000, 200_000_000);
    expect(e).toBeInstanceOf(WebcvtError);
    expect(e.code).toBe('TS_INPUT_TOO_LARGE');
    expect(e.name).toBe('TsInputTooLargeError');
  });

  it('TsNoSyncByteError', () => {
    const e = new TsNoSyncByteError(1024 * 1024);
    expect(e).toBeInstanceOf(WebcvtError);
    expect(e.code).toBe('TS_NO_SYNC_BYTE');
  });

  it('TsScrambledNotSupportedError', () => {
    const e = new TsScrambledNotSupportedError(0x0100, 1, 376);
    expect(e.code).toBe('TS_SCRAMBLED_NOT_SUPPORTED');
    expect(e.name).toBe('TsScrambledNotSupportedError');
  });

  it('TsReservedAdaptationControlError', () => {
    const e = new TsReservedAdaptationControlError(188);
    expect(e.code).toBe('TS_RESERVED_ADAPTATION_CONTROL');
  });

  it('TsMultiProgramNotSupportedError', () => {
    const e = new TsMultiProgramNotSupportedError(3);
    expect(e.code).toBe('TS_MULTI_PROGRAM_NOT_SUPPORTED');
    expect(e.message).toContain('3');
  });

  it('TsMissingPatError', () => {
    const e = new TsMissingPatError();
    expect(e.code).toBe('TS_MISSING_PAT');
  });

  it('TsMissingPmtError', () => {
    const e = new TsMissingPmtError(0x1000, 500);
    expect(e.code).toBe('TS_MISSING_PMT');
    expect(e.message).toContain('0x1000');
  });

  it('TsCorruptStreamError', () => {
    const e = new TsCorruptStreamError('no PES packets');
    expect(e.code).toBe('TS_CORRUPT_STREAM');
    expect(e.message).toContain('no PES packets');
  });

  it('TsPsiCrcError', () => {
    const e = new TsPsiCrcError(0x00, 0x0000, 0xdeadbeef, 0xcafebabe);
    expect(e.code).toBe('TS_PSI_CRC_ERROR');
  });

  it('TsTooManyPacketsError', () => {
    const e = new TsTooManyPacketsError(1_200_000);
    expect(e.code).toBe('TS_TOO_MANY_PACKETS');
  });

  it('TsEncodeNotImplementedError', () => {
    const e = new TsEncodeNotImplementedError('transcode not supported');
    expect(e.code).toBe('TS_ENCODE_NOT_IMPLEMENTED');
  });

  it('all errors extend WebcvtError', () => {
    const errors = [
      new TsInputTooLargeError(1, 2),
      new TsNoSyncByteError(100),
      new TsScrambledNotSupportedError(0, 1, 0),
      new TsReservedAdaptationControlError(0),
      new TsMultiProgramNotSupportedError(2),
      new TsMissingPatError(),
      new TsMissingPmtError(0, 500),
      new TsCorruptStreamError('test'),
      new TsPsiCrcError(0, 0, 0, 0),
      new TsTooManyPacketsError(100),
      new TsEncodeNotImplementedError('test'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(WebcvtError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
