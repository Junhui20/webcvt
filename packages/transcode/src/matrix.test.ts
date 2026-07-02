import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  INPUT_CODECS,
  OUTPUT_TARGETS,
  TRANSCODE_MATRIX,
  inputCodecFor,
  matrixKey,
  outputTargetFor,
  resolveBitrate,
} from './matrix.ts';

describe('TRANSCODE_MATRIX', () => {
  it('includes the v1 audio targets for a decodable input', () => {
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/wav'))).toBe(true);
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/ogg'))).toBe(true);
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/webm'))).toBe(true);
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/aac'))).toBe(true);
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/flac'))).toBe(true);
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/wav', 'audio/wav'))).toBe(true);
  });

  it('excludes off-matrix outputs (mp3, mp4, ogg-vorbis have no encoder/muxer)', () => {
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/wav', 'audio/mpeg'))).toBe(false); // → mp3
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'video/mp4'))).toBe(false); // → mp4
    expect(TRANSCODE_MATRIX.has(matrixKey('audio/mpeg', 'audio/mp4'))).toBe(false); // → m4a
  });

  it('excludes non-decodable inputs', () => {
    expect(TRANSCODE_MATRIX.has(matrixKey('video/mp4', 'audio/wav'))).toBe(false);
    expect(TRANSCODE_MATRIX.has(matrixKey('image/png', 'audio/wav'))).toBe(false);
  });
});

describe('codec resolution', () => {
  it('maps input MIMEs to codecs (wav → pcm)', () => {
    expect(inputCodecFor('audio/wav')).toBe('pcm');
    expect(inputCodecFor('audio/mpeg')).toBe('mp3');
    expect(inputCodecFor('audio/aac')).toBe('aac');
    expect(inputCodecFor('audio/ogg')).toBe('opus');
    expect(inputCodecFor('audio/flac')).toBe('flac');
    expect(inputCodecFor('video/mp4')).toBeUndefined();
  });

  it('maps output MIMEs to container + encoder codec', () => {
    expect(outputTargetFor('audio/wav')).toEqual({ container: 'wav', codec: 'pcm' });
    expect(outputTargetFor('audio/ogg')).toEqual({ container: 'ogg', codec: 'opus' });
    expect(outputTargetFor('audio/opus')).toEqual({ container: 'ogg', codec: 'opus' });
    expect(outputTargetFor('audio/webm')).toEqual({ container: 'webm', codec: 'opus' });
    expect(outputTargetFor('audio/aac')).toEqual({ container: 'aac', codec: 'aac' });
    expect(outputTargetFor('audio/flac')).toEqual({ container: 'flac', codec: 'flac' });
    expect(outputTargetFor('audio/mpeg')).toBeUndefined();
  });

  it('freezes the lookup tables', () => {
    expect(Object.isFrozen(INPUT_CODECS)).toBe(true);
    expect(Object.isFrozen(OUTPUT_TARGETS)).toBe(true);
  });
});

describe('resolveBitrate (quality → bitrate ladder)', () => {
  it('opus stereo maps default quality 0.7 → 128 kbps', () => {
    expect(resolveBitrate('opus', DEFAULT_QUALITY, 2)).toBe(128_000);
  });

  it('opus stereo ladder endpoints are 64k (q0) and 256k (q1)', () => {
    expect(resolveBitrate('opus', 0, 2)).toBe(64_000);
    expect(resolveBitrate('opus', 1, 2)).toBe(256_000);
  });

  it('aac stereo maps default quality 0.7 → 128 kbps, ends 96k..256k', () => {
    expect(resolveBitrate('aac', DEFAULT_QUALITY, 2)).toBe(128_000);
    expect(resolveBitrate('aac', 0, 2)).toBe(96_000);
    expect(resolveBitrate('aac', 1, 2)).toBe(256_000);
  });

  it('scales mono to ~0.6x', () => {
    expect(resolveBitrate('opus', DEFAULT_QUALITY, 1)).toBe(Math.round(128_000 * 0.6));
  });

  it('clamps out-of-range quality and defaults NaN', () => {
    expect(resolveBitrate('opus', 5, 2)).toBe(256_000);
    expect(resolveBitrate('opus', -1, 2)).toBe(64_000);
    expect(resolveBitrate('opus', Number.NaN, 2)).toBe(128_000);
  });

  it('returns undefined for lossless / pcm codecs', () => {
    expect(resolveBitrate('flac', 0.7, 2)).toBeUndefined();
    expect(resolveBitrate('pcm', 0.7, 2)).toBeUndefined();
  });
});
