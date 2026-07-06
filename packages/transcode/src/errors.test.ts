import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  TranscodeCodecError,
  TranscodeDemuxError,
  TranscodeInputTooLargeError,
  TranscodeMuxError,
  TranscodeUnsupportedError,
} from './errors.ts';

describe('transcode error classes', () => {
  it('TranscodeUnsupportedError carries the from → to pair and code', () => {
    const err = new TranscodeUnsupportedError('mp3', 'flac');
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.name).toBe('TranscodeUnsupportedError');
    expect(err.code).toBe('TRANSCODE_UNSUPPORTED');
    expect(err.message).toContain('mp3 → flac');
  });

  it('TranscodeInputTooLargeError reports size and max', () => {
    const err = new TranscodeInputTooLargeError(1234, 1000);
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.name).toBe('TranscodeInputTooLargeError');
    expect(err.code).toBe('TRANSCODE_INPUT_TOO_LARGE');
    expect(err.message).toContain('1234');
    expect(err.message).toContain('1000');
  });

  it('TranscodeDemuxError wraps a message and preserves cause', () => {
    const cause = new Error('root');
    const err = new TranscodeDemuxError('bad container', { cause });
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.name).toBe('TranscodeDemuxError');
    expect(err.code).toBe('TRANSCODE_DEMUX_FAILED');
    expect(err.message).toContain('bad container');
    expect(err.cause).toBe(cause);
  });

  it('TranscodeDemuxError works without options', () => {
    const err = new TranscodeDemuxError('no options');
    expect(err.code).toBe('TRANSCODE_DEMUX_FAILED');
    expect(err.cause).toBeUndefined();
  });

  it('TranscodeCodecError wraps a message and preserves cause', () => {
    const cause = new Error('decode blew up');
    const err = new TranscodeCodecError('decode: boom', { cause });
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.name).toBe('TranscodeCodecError');
    expect(err.code).toBe('TRANSCODE_CODEC_ERROR');
    expect(err.message).toContain('decode: boom');
    expect(err.cause).toBe(cause);
  });

  it('TranscodeMuxError wraps a message and preserves cause', () => {
    const cause = new Error('mux blew up');
    const err = new TranscodeMuxError('bad mux', { cause });
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err.name).toBe('TranscodeMuxError');
    expect(err.code).toBe('TRANSCODE_MUX_FAILED');
    expect(err.message).toContain('bad mux');
    expect(err.cause).toBe(cause);
  });
});
