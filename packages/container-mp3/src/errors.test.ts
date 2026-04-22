import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  Mp3EncodeNotImplementedError,
  Mp3FreeFormatError,
  Mp3InvalidFrameError,
  Mp3Mpeg25EncodeNotSupportedError,
  Mp3UnsynchronisationError,
} from './errors.ts';

describe('Mp3FreeFormatError', () => {
  it('extends WebcvtError', () => {
    const err = new Mp3FreeFormatError(100);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct code and name', () => {
    const err = new Mp3FreeFormatError(42);
    expect(err.code).toBe('MP3_FREE_FORMAT');
    expect(err.name).toBe('Mp3FreeFormatError');
  });

  it('stores the offset', () => {
    const err = new Mp3FreeFormatError(512);
    expect(err.offset).toBe(512);
  });

  it('message mentions the offset', () => {
    const err = new Mp3FreeFormatError(99);
    expect(err.message).toContain('99');
  });
});

describe('Mp3Mpeg25EncodeNotSupportedError', () => {
  it('extends WebcvtError', () => {
    const err = new Mp3Mpeg25EncodeNotSupportedError();
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has correct code and name', () => {
    const err = new Mp3Mpeg25EncodeNotSupportedError();
    expect(err.code).toBe('MP3_MPEG25_ENCODE_NOT_SUPPORTED');
    expect(err.name).toBe('Mp3Mpeg25EncodeNotSupportedError');
  });

  it('message mentions MPEG 2.5', () => {
    const err = new Mp3Mpeg25EncodeNotSupportedError();
    expect(err.message.toLowerCase()).toContain('2.5');
  });
});

describe('Mp3InvalidFrameError', () => {
  it('extends WebcvtError', () => {
    const err = new Mp3InvalidFrameError('bad layer', 0);
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has correct code and name', () => {
    const err = new Mp3InvalidFrameError('bad layer', 0);
    expect(err.code).toBe('MP3_INVALID_FRAME');
    expect(err.name).toBe('Mp3InvalidFrameError');
  });

  it('stores the offset', () => {
    const err = new Mp3InvalidFrameError('test', 256);
    expect(err.offset).toBe(256);
  });

  it('includes message detail', () => {
    const err = new Mp3InvalidFrameError('custom detail', 0);
    expect(err.message).toContain('custom detail');
  });
});

describe('Mp3UnsynchronisationError', () => {
  it('extends WebcvtError', () => {
    const err = new Mp3UnsynchronisationError('bad bytes');
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has correct code and name', () => {
    const err = new Mp3UnsynchronisationError('bad bytes');
    expect(err.code).toBe('MP3_UNSYNCHRONISATION_ERROR');
    expect(err.name).toBe('Mp3UnsynchronisationError');
  });

  it('includes message detail', () => {
    const err = new Mp3UnsynchronisationError('expected 5 got 4');
    expect(err.message).toContain('expected 5 got 4');
  });
});

describe('Mp3EncodeNotImplementedError', () => {
  it('extends WebcvtError', () => {
    const err = new Mp3EncodeNotImplementedError();
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has correct code and name', () => {
    const err = new Mp3EncodeNotImplementedError();
    expect(err.code).toBe('MP3_ENCODE_NOT_IMPLEMENTED');
    expect(err.name).toBe('Mp3EncodeNotImplementedError');
  });

  it('message mentions Phase 1', () => {
    const err = new Mp3EncodeNotImplementedError();
    expect(err.message).toContain('Phase 1');
  });
});
