import { describe, expect, it } from 'vitest';
import {
  CONTAINER_AUDIO_CODEC,
  CONTAINER_INPUTS,
  CONTAINER_VIDEO_CODEC,
  VIDEO_TARGETS,
  containerFamilyFor,
  inputCodecFor,
  resolveVideoBitrate,
  videoTargetFor,
} from './matrix.ts';

describe('container/video matrix', () => {
  it('maps container input MIMEs to families (mp4/webm/mkv + m4a)', () => {
    expect(containerFamilyFor('video/mp4')).toBe('mp4');
    expect(containerFamilyFor('audio/mp4')).toBe('mp4'); // m4a
    expect(containerFamilyFor('video/webm')).toBe('webm');
    expect(containerFamilyFor('audio/webm')).toBe('webm');
    expect(containerFamilyFor('video/x-matroska')).toBe('mkv');
    expect(containerFamilyFor('audio/wav')).toBeUndefined();
  });

  it('keeps container MIMEs OUT of the frozen audio INPUT_CODECS', () => {
    // Regression guard: the audio matrix must not learn about containers.
    expect(inputCodecFor('video/mp4')).toBeUndefined();
    expect(inputCodecFor('video/webm')).toBeUndefined();
  });

  it('maps video output MIMEs to a container', () => {
    expect(videoTargetFor('video/webm')).toEqual({ container: 'webm' });
    expect(videoTargetFor('video/x-matroska')).toEqual({ container: 'mkv' });
    expect(videoTargetFor('video/mp4')).toBeUndefined(); // no mp4 muxer yet
  });

  it('assumes AAC audio for mp4, Opus for webm/mkv; h264/vp9 video', () => {
    expect(CONTAINER_AUDIO_CODEC.mp4).toBe('aac');
    expect(CONTAINER_AUDIO_CODEC.webm).toBe('opus');
    expect(CONTAINER_VIDEO_CODEC.mp4).toBe('h264');
    expect(CONTAINER_VIDEO_CODEC.webm).toBe('vp9');
  });

  it('freezes the container lookup tables', () => {
    expect(Object.isFrozen(CONTAINER_INPUTS)).toBe(true);
    expect(Object.isFrozen(VIDEO_TARGETS)).toBe(true);
    expect(Object.isFrozen(CONTAINER_AUDIO_CODEC)).toBe(true);
  });
});

describe('resolveVideoBitrate (resolution + quality ladder)', () => {
  it('VP9 720p at default quality lands ≈3 Mbps', () => {
    expect(resolveVideoBitrate(1280, 720, 0.7, 'vp9')).toBe(3_000_000);
  });

  it('scales down with resolution', () => {
    const p720 = resolveVideoBitrate(1280, 720, 0.7, 'vp9');
    const p360 = resolveVideoBitrate(640, 360, 0.7, 'vp9');
    expect(p360).toBeLessThan(p720);
    expect(p360).toBe(Math.round(3_000_000 / 4)); // quarter the pixels
  });

  it('scales ±40% across the quality range', () => {
    expect(resolveVideoBitrate(1280, 720, 0, 'vp9')).toBe(Math.round(3_000_000 * 0.6));
    expect(resolveVideoBitrate(1280, 720, 1, 'vp9')).toBe(Math.round(3_000_000 * 1.4));
  });

  it('VP8 is ≈1.3× VP9', () => {
    expect(resolveVideoBitrate(1280, 720, 0.7, 'vp8')).toBe(Math.round(3_000_000 * 1.3));
  });

  it('applies a positive floor for tiny clips', () => {
    expect(resolveVideoBitrate(160, 120, 0.7, 'vp9')).toBeGreaterThanOrEqual(100_000);
  });
});
