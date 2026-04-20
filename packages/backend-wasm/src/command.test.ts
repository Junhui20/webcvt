import { describe, expect, it } from 'vitest';
import { buildCommand } from './command.ts';
import { WasmUnsupportedError } from './errors.ts';

const MP4_FD = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };
const WEBM_FD = { ext: 'webm', mime: 'video/webm', category: 'video' as const };
const MP3_FD = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' as const };
const AAC_FD = { ext: 'aac', mime: 'audio/aac', category: 'audio' as const };
const WAV_FD = { ext: 'wav', mime: 'audio/wav', category: 'audio' as const };
const OGG_FD = { ext: 'ogg', mime: 'audio/ogg', category: 'audio' as const };

const BASE_OPTS = { format: 'mp4' };

describe('buildCommand — base structure', () => {
  it('always starts with -hide_banner -nostdin -y -i inputPath', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp4', 'video/mp4', MP4_FD, BASE_OPTS);
    expect(argv[0]).toBe('-hide_banner');
    expect(argv[1]).toBe('-nostdin');
    expect(argv[2]).toBe('-y');
    expect(argv[3]).toBe('-i');
    expect(argv[4]).toBe('/in/a.mp4');
  });

  it('always ends with outputPath', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp4', 'video/mp4', MP4_FD, BASE_OPTS);
    expect(argv[argv.length - 1]).toBe('/out/b.mp4');
  });
});

describe('buildCommand — video→video', () => {
  it('includes -c:v libx264 for MP4 output by default', () => {
    const argv = buildCommand('/in/a.webm', '/out/b.mp4', 'video/webm', MP4_FD, BASE_OPTS);
    const cvIdx = argv.indexOf('-c:v');
    expect(cvIdx).toBeGreaterThan(-1);
    expect(argv[cvIdx + 1]).toBe('libx264');
  });

  it('includes -c:v libvpx-vp9 for WebM output by default', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.webm', 'video/mp4', WEBM_FD, BASE_OPTS);
    const cvIdx = argv.indexOf('-c:v');
    expect(argv[cvIdx + 1]).toBe('libvpx-vp9');
  });

  it('does NOT include -vn for video output', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.webm', 'video/mp4', WEBM_FD, BASE_OPTS);
    expect(argv).not.toContain('-vn');
  });
});

describe('buildCommand — video→audio extraction', () => {
  it('appends -vn for audio output (Trap #4 step 4)', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp3', 'video/mp4', MP3_FD, BASE_OPTS);
    expect(argv).toContain('-vn');
  });

  it('does NOT include -c:v for audio output', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp3', 'video/mp4', MP3_FD, BASE_OPTS);
    expect(argv).not.toContain('-c:v');
  });

  it('includes -c:a libmp3lame for MP3 output', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp3', 'video/mp4', MP3_FD, BASE_OPTS);
    const caIdx = argv.indexOf('-c:a');
    expect(caIdx).toBeGreaterThan(-1);
    expect(argv[caIdx + 1]).toBe('libmp3lame');
  });
});

describe('buildCommand — codec alias mapping', () => {
  it('maps h264 → libx264 in argv', () => {
    const argv = buildCommand('/in/a.webm', '/out/b.mp4', 'video/webm', MP4_FD, {
      format: 'mp4',
      codec: 'h264',
    });
    expect(argv).toContain('libx264');
    expect(argv).not.toContain('h264');
  });

  it('throws WasmUnsupportedError for unknown codec', () => {
    expect(() =>
      buildCommand('/in/a.mp4', '/out/b.webm', 'video/mp4', WEBM_FD, {
        format: 'webm',
        codec: 'not-a-real-codec',
      }),
    ).toThrow(WasmUnsupportedError);
  });

  it('throws WasmUnsupportedError when audio codec passed for video output', () => {
    // Users passing e.g. codec='mp3' for a video/mp4 output used to be
    // silently ignored (the container default codec was used anyway).
    // That hid intent loss from callers. Now we fail loudly on the
    // video↔audio-codec mismatch.
    expect(() =>
      buildCommand('/in/a.mp4', '/out/b.mp4', 'video/mp4', MP4_FD, {
        format: 'mp4',
        codec: 'mp3',
      }),
    ).toThrow(WasmUnsupportedError);
  });
});

describe('buildCommand — quality flags', () => {
  it('includes -crf for libx264 at quality 0.5', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp4', 'video/mp4', MP4_FD, {
      format: 'mp4',
      quality: 0.5,
    });
    expect(argv).toContain('-crf');
  });

  it('includes -q:a for libmp3lame (not -crf)', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.mp3', 'video/mp4', MP3_FD, {
      format: 'mp3',
      quality: 0.5,
    });
    expect(argv).toContain('-q:a');
    expect(argv).not.toContain('-crf');
  });

  it('includes -b:a for aac output', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.aac', 'video/mp4', AAC_FD, {
      format: 'aac',
      quality: 0.9,
    });
    expect(argv).toContain('-b:a');
  });

  it('includes no quality flags for wav (lossless pcm_s16le)', () => {
    const argv = buildCommand('/in/a.mp4', '/out/b.wav', 'video/mp4', WAV_FD, {
      format: 'wav',
      quality: 0.5,
    });
    expect(argv).not.toContain('-crf');
    expect(argv).not.toContain('-q:a');
    // b:a is also empty for lossless
  });
});
