import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  CodecOperationError,
  UnsupportedCodecError,
  WebCodecsNotSupportedError,
} from './errors.ts';

describe('WebCodecsNotSupportedError', () => {
  it('is an instance of WebcvtError', () => {
    const err = new WebCodecsNotSupportedError();
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has code WEBCODECS_NOT_SUPPORTED', () => {
    const err = new WebCodecsNotSupportedError();
    expect(err.code).toBe('WEBCODECS_NOT_SUPPORTED');
  });

  it('has name WebCodecsNotSupportedError', () => {
    const err = new WebCodecsNotSupportedError();
    expect(err.name).toBe('WebCodecsNotSupportedError');
  });

  it('includes helpful message text', () => {
    const err = new WebCodecsNotSupportedError();
    expect(err.message).toContain('WebCodecs');
  });

  it('accepts ErrorOptions for cause chaining', () => {
    const cause = new Error('original');
    const err = new WebCodecsNotSupportedError({ cause });
    expect(err.cause).toBe(cause);
  });
});

describe('UnsupportedCodecError', () => {
  it('is an instance of WebcvtError', () => {
    const err = new UnsupportedCodecError('h264');
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has code UNSUPPORTED_CODEC', () => {
    const err = new UnsupportedCodecError('h264');
    expect(err.code).toBe('UNSUPPORTED_CODEC');
  });

  it('exposes the codec name', () => {
    const err = new UnsupportedCodecError('vp9');
    expect(err.codec).toBe('vp9');
  });

  it('has name UnsupportedCodecError', () => {
    const err = new UnsupportedCodecError('av1');
    expect(err.name).toBe('UnsupportedCodecError');
  });

  it('includes codec name in message', () => {
    const err = new UnsupportedCodecError('hevc');
    expect(err.message).toContain('hevc');
  });

  it('includes optional detail in message', () => {
    const err = new UnsupportedCodecError('av1', 'requires Chrome 101+');
    expect(err.message).toContain('requires Chrome 101+');
  });
});

describe('CodecOperationError', () => {
  it('is an instance of WebcvtError', () => {
    const err = new CodecOperationError('encode', 'GPU hang');
    expect(err).toBeInstanceOf(WebcvtError);
  });

  it('has code CODEC_OPERATION_ERROR', () => {
    const err = new CodecOperationError('decode', 'corrupt frame');
    expect(err.code).toBe('CODEC_OPERATION_ERROR');
  });

  it('has name CodecOperationError', () => {
    const err = new CodecOperationError('flush', 'timeout');
    expect(err.name).toBe('CodecOperationError');
  });

  it('includes operation and detail in message', () => {
    const err = new CodecOperationError('video encode', 'Driver crash');
    expect(err.message).toContain('video encode');
    expect(err.message).toContain('Driver crash');
  });
});
