/**
 * Tests for FLAC error classes.
 */

import { describe, expect, it } from 'vitest';
import {
  FlacCrc8MismatchError,
  FlacCrc16MismatchError,
  FlacEncodeNotImplementedError,
  FlacInputTooLargeError,
  FlacInvalidMagicError,
  FlacInvalidMetadataError,
  FlacInvalidVarintError,
} from './errors.ts';

describe('FlacInputTooLargeError', () => {
  it('has correct code and name', () => {
    const err = new FlacInputTooLargeError(300 * 1024 * 1024, 200 * 1024 * 1024);
    expect(err.code).toBe('FLAC_INPUT_TOO_LARGE');
    expect(err.name).toBe('FlacInputTooLargeError');
    expect(err.message).toContain('200 MiB');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('FlacInvalidMagicError', () => {
  it('has correct code and message', () => {
    const err = new FlacInvalidMagicError(0);
    expect(err.code).toBe('FLAC_INVALID_MAGIC');
    expect(err.name).toBe('FlacInvalidMagicError');
    expect(err.message).toContain('fLaC');
  });
});

describe('FlacInvalidMetadataError', () => {
  it('has correct code and offset', () => {
    const err = new FlacInvalidMetadataError('bad block', 42);
    expect(err.code).toBe('FLAC_INVALID_METADATA');
    expect(err.name).toBe('FlacInvalidMetadataError');
    expect(err.offset).toBe(42);
    expect(err.message).toContain('42');
    expect(err.message).toContain('bad block');
  });
});

describe('FlacCrc8MismatchError', () => {
  it('has correct code and hex values in message', () => {
    const err = new FlacCrc8MismatchError(100, 0xab, 0xcd);
    expect(err.code).toBe('FLAC_CRC8_MISMATCH');
    expect(err.name).toBe('FlacCrc8MismatchError');
    expect(err.offset).toBe(100);
    expect(err.message).toContain('ab');
    expect(err.message).toContain('cd');
  });
});

describe('FlacCrc16MismatchError', () => {
  it('has correct code and hex values in message', () => {
    const err = new FlacCrc16MismatchError(200, 0x1234, 0x5678);
    expect(err.code).toBe('FLAC_CRC16_MISMATCH');
    expect(err.name).toBe('FlacCrc16MismatchError');
    expect(err.offset).toBe(200);
    expect(err.message).toContain('1234');
    expect(err.message).toContain('5678');
  });
});

describe('FlacInvalidVarintError', () => {
  it('has correct code and offset', () => {
    const err = new FlacInvalidVarintError(55);
    expect(err.code).toBe('FLAC_INVALID_VARINT');
    expect(err.name).toBe('FlacInvalidVarintError');
    expect(err.offset).toBe(55);
    expect(err.message).toContain('55');
  });
});

describe('FlacEncodeNotImplementedError', () => {
  it('has correct code and mentions backend-wasm', () => {
    const err = new FlacEncodeNotImplementedError();
    expect(err.code).toBe('FLAC_ENCODE_NOT_IMPLEMENTED');
    expect(err.name).toBe('FlacEncodeNotImplementedError');
    expect(err.message).toContain('backend-wasm');
  });
});
