import { describe, expect, it } from 'vitest';
import {
  CODEC_ALIAS_MAP,
  CONTAINER_DEFAULT_AUDIO_CODEC,
  CONTAINER_DEFAULT_VIDEO_CODEC,
  mapQualityFlags,
  resolveCodecAlias,
} from './codec-map.ts';

describe('CODEC_ALIAS_MAP', () => {
  it('maps h264 to libx264', () => {
    expect(CODEC_ALIAS_MAP.h264).toBe('libx264');
  });

  it('maps hevc to libx265', () => {
    expect(CODEC_ALIAS_MAP.hevc).toBe('libx265');
  });

  it('maps av1 to libaom-av1', () => {
    expect(CODEC_ALIAS_MAP.av1).toBe('libaom-av1');
  });

  it('maps vp9 to libvpx-vp9', () => {
    expect(CODEC_ALIAS_MAP.vp9).toBe('libvpx-vp9');
  });

  it('maps mp3 to libmp3lame', () => {
    expect(CODEC_ALIAS_MAP.mp3).toBe('libmp3lame');
  });
});

describe('resolveCodecAlias', () => {
  it('resolves h264 (lowercase)', () => {
    expect(resolveCodecAlias('h264')).toBe('libx264');
  });

  it('resolves H264 (uppercase) via normalisation', () => {
    expect(resolveCodecAlias('H264')).toBe('libx264');
  });

  it('resolves libx264 (passthrough)', () => {
    expect(resolveCodecAlias('libx264')).toBe('libx264');
  });

  it('returns undefined for unknown codec', () => {
    expect(resolveCodecAlias('not-a-codec')).toBeUndefined();
  });
});

describe('CONTAINER_DEFAULT_VIDEO_CODEC', () => {
  it('defaults video/mp4 to libx264', () => {
    expect(CONTAINER_DEFAULT_VIDEO_CODEC['video/mp4']).toBe('libx264');
  });

  it('defaults video/webm to libvpx-vp9', () => {
    expect(CONTAINER_DEFAULT_VIDEO_CODEC['video/webm']).toBe('libvpx-vp9');
  });
});

describe('CONTAINER_DEFAULT_AUDIO_CODEC', () => {
  it('defaults audio/mpeg to libmp3lame', () => {
    expect(CONTAINER_DEFAULT_AUDIO_CODEC['audio/mpeg']).toBe('libmp3lame');
  });

  it('defaults audio/wav to pcm_s16le', () => {
    expect(CONTAINER_DEFAULT_AUDIO_CODEC['audio/wav']).toBe('pcm_s16le');
  });
});

describe('mapQualityFlags', () => {
  it('returns CRF flags for libx264 at quality 0.5', () => {
    const flags = mapQualityFlags('libx264', 0.5);
    expect(flags[0]).toBe('-crf');
    // quality 0.5 → crf = round(0 + 0.5 * 51) = 26
    expect(flags[1]).toBe('26');
  });

  it('returns CRF=0 (best) for libx264 at quality 1.0', () => {
    const flags = mapQualityFlags('libx264', 1.0);
    expect(flags[0]).toBe('-crf');
    expect(flags[1]).toBe('0');
  });

  it('returns CRF=51 (worst) for libx264 at quality 0.0', () => {
    const flags = mapQualityFlags('libx264', 0.0);
    expect(flags[0]).toBe('-crf');
    expect(flags[1]).toBe('51');
  });

  it('returns -q:a flags for libmp3lame (not crf)', () => {
    const flags = mapQualityFlags('libmp3lame', 0.5);
    expect(flags[0]).toBe('-q:a');
    // quality 0.5 → qa = round((1-0.5)*9) = round(4.5) = 5 (or 4)
    const qa = Number(flags[1]);
    expect(qa).toBeGreaterThanOrEqual(4);
    expect(qa).toBeLessThanOrEqual(5);
  });

  it('returns -b:a flags for aac at high quality', () => {
    const flags = mapQualityFlags('aac', 0.9);
    expect(flags[0]).toBe('-b:a');
    expect(flags[1]).toBe('320k');
  });

  it('returns -b:a flags for libopus at low quality', () => {
    const flags = mapQualityFlags('libopus', 0.1);
    expect(flags[0]).toBe('-b:a');
    expect(flags[1]).toBe('32k');
  });

  it('returns empty array for lossless flac', () => {
    const flags = mapQualityFlags('flac', 0.5);
    expect(flags).toHaveLength(0);
  });

  it('uses default quality 0.7 when undefined', () => {
    const flags = mapQualityFlags('libx264', undefined);
    expect(flags[0]).toBe('-crf');
    // quality 0.7 → crf = round(0 + 0.3 * 51) = round(15.3) = 15
    const crf = Number(flags[1]);
    expect(crf).toBeGreaterThanOrEqual(14);
    expect(crf).toBeLessThanOrEqual(16);
  });

  it('returns empty array for unknown codec', () => {
    const flags = mapQualityFlags('unknown-codec', 0.5);
    expect(flags).toHaveLength(0);
  });
});
