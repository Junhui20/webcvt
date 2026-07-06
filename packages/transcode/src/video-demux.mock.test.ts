/**
 * Branch-coverage tests for video-demux's codec-mapping and edge-case paths.
 *
 * The real container parsers only expose a handful of codec combinations via
 * the shared fixtures (h264/aac in mp4/mkv, vp8/vorbis in webm). To exercise
 * every codec branch (hevc/vp9/av1, opus/aac audio, malformed inputs) without
 * synthesizing a full binary container per codec, this file mocks the three
 * container packages with generator-backed stubs whose output is driven by a
 * hoisted `state` object. The real-fixture tests live in video-demux.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscodeDemuxError } from './errors.ts';

interface MockState {
  mp4: {
    throw?: unknown;
    videoTrack?: unknown;
    audioTrack?: unknown;
    audioCodec?: string;
    videoSamples?: unknown[];
    audioSamples?: unknown[];
  };
  webm: {
    tracks?: unknown[];
    videoChunks?: unknown[];
    audioChunks?: unknown[];
  };
  mkv: {
    tracks?: unknown[];
    videoChunks?: unknown[];
    audioChunks?: unknown[];
  };
}

const state = vi.hoisted(
  () =>
    ({
      mp4: {},
      webm: {},
      mkv: {},
    }) as MockState,
);

vi.mock('@catlabtech/webcvt-container-mp4', () => ({
  parseMp4: () => {
    if (state.mp4.throw) throw state.mp4.throw;
    return { fileBytes: new Uint8Array(0) };
  },
  findVideoTrack: () => state.mp4.videoTrack ?? null,
  findAudioTrack: () => state.mp4.audioTrack ?? null,
  deriveCodecString: () => state.mp4.audioCodec ?? 'mp4a.40.2',
  iterateVideoSamples: function* () {
    yield* (state.mp4.videoSamples ?? []) as never[];
  },
  iterateAudioSamplesAuto: function* () {
    yield* (state.mp4.audioSamples ?? []) as never[];
  },
}));

vi.mock('@catlabtech/webcvt-container-webm', () => ({
  parseWebm: () => ({ tracks: state.webm.tracks ?? [] }),
  iterateVideoChunks: function* () {
    yield* (state.webm.videoChunks ?? []) as never[];
  },
  iterateAudioChunks: function* () {
    yield* (state.webm.audioChunks ?? []) as never[];
  },
}));

vi.mock('@catlabtech/webcvt-container-mkv', () => ({
  parseMkv: () => ({ tracks: state.mkv.tracks ?? [] }),
  iterateVideoChunks: function* () {
    yield* (state.mkv.videoChunks ?? []) as never[];
  },
  iterateAudioChunks: function* () {
    yield* (state.mkv.audioChunks ?? []) as never[];
  },
}));

const { demuxContainerAudioTrack, demuxContainerVideo } = await import('./video-demux.ts');

const BYTES = new Uint8Array([0]);

function mp4VideoTrack(format: string): unknown {
  return {
    sampleEntry: {
      kind: 'video',
      entry: {
        codecString: 'avc1.42001f',
        codecConfig: { bytes: new Uint8Array([1, 2, 3]) },
        width: 320,
        height: 240,
        format,
      },
    },
  };
}

function mp4AudioTrack(): unknown {
  return {
    sampleEntry: {
      kind: 'audio',
      entry: {
        objectTypeIndication: 0x40,
        decoderSpecificInfo: new Uint8Array([0x12, 0x10]),
        channelCount: 2,
        sampleRate: 44100,
      },
    },
  };
}

function videoSamples(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    isKeyframe: i === 0,
    presentationTimeUs: i * 40_000,
    durationUs: 40_000,
    data: new Uint8Array([i]),
  }));
}

function audioSamples(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    timestampUs: i * 20_000,
    durationUs: 20_000,
    data: new Uint8Array([i]),
  }));
}

beforeEach(() => {
  state.mp4 = {};
  state.webm = {};
  state.mkv = {};
});

// ---------------------------------------------------------------------------
// mp4
// ---------------------------------------------------------------------------

describe('demuxContainerVideo: mp4', () => {
  it('maps each mp4 video format to its coarse codec token', () => {
    const cases: Array<[string, string]> = [
      ['avc1', 'h264'],
      ['hev1', 'hevc'],
      ['hvc1', 'hevc'],
      ['vp09', 'vp9'],
      ['av01', 'av1'],
      ['xxxx', 'h264'], // unknown → default h264
    ];
    for (const [format, expected] of cases) {
      state.mp4 = {
        videoTrack: mp4VideoTrack(format),
        audioTrack: null,
        videoSamples: videoSamples(3),
      };
      const { video, audio } = demuxContainerVideo('mp4', BYTES);
      expect(video.codec).toBe(expected);
      expect(video.frameRate).toBeGreaterThan(0);
      expect(audio).toBeNull();
    }
  });

  it('throws when the mp4 has no video track', () => {
    state.mp4 = { videoTrack: null };
    expect(() => demuxContainerVideo('mp4', BYTES)).toThrow('mp4 has no video track');
  });

  it('throws when the mp4 video track has no samples', () => {
    state.mp4 = { videoTrack: mp4VideoTrack('avc1'), videoSamples: [] };
    expect(() => demuxContainerVideo('mp4', BYTES)).toThrow('mp4 video track has no samples');
  });

  it('returns audio when an AAC track is present', () => {
    state.mp4 = {
      videoTrack: mp4VideoTrack('avc1'),
      videoSamples: videoSamples(2),
      audioTrack: mp4AudioTrack(),
      audioSamples: audioSamples(3),
    };
    const { audio } = demuxContainerVideo('mp4', BYTES);
    expect(audio).not.toBeNull();
    expect(audio?.numberOfChannels).toBe(2);
    expect(audio?.sampleRate).toBe(44100);
    expect(audio?.chunks.length).toBe(3);
  });

  it('audio is null when the audio track exists but yields no samples', () => {
    state.mp4 = {
      videoTrack: mp4VideoTrack('avc1'),
      videoSamples: videoSamples(2),
      audioTrack: mp4AudioTrack(),
      audioSamples: [],
    };
    expect(demuxContainerVideo('mp4', BYTES).audio).toBeNull();
  });

  it('audio is null when the audio sampleEntry kind is not audio', () => {
    state.mp4 = {
      videoTrack: mp4VideoTrack('avc1'),
      videoSamples: videoSamples(2),
      audioTrack: { sampleEntry: { kind: 'video', entry: {} } },
    };
    expect(demuxContainerVideo('mp4', BYTES).audio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// webm
// ---------------------------------------------------------------------------

function webmVideoTrack(codecId: string, codecPrivate?: Uint8Array): unknown {
  return {
    trackType: 1,
    trackNumber: 1,
    codecId,
    pixelWidth: 320,
    pixelHeight: 240,
    ...(codecPrivate ? { codecPrivate } : {}),
  };
}

function webmAudioTrack(codecId: string): unknown {
  return {
    trackType: 2,
    trackNumber: 2,
    codecId,
    channels: 2,
    codecPrivate: new Uint8Array([0x4f, 0x70]),
  };
}

function chunks(count: number, opts: { key?: boolean } = {}): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: (opts.key ?? true) ? (i === 0 ? 'key' : 'delta') : 'delta',
    timestampUs: i * 33_000,
    data: new Uint8Array([i]),
  }));
}

describe('demuxContainerVideo: webm', () => {
  it('maps VP9 with a synthetic codec string', () => {
    state.webm = { tracks: [webmVideoTrack('V_VP9')], videoChunks: chunks(3) };
    const { video } = demuxContainerVideo('webm', BYTES);
    expect(video.codec).toBe('vp9');
    expect(video.config.codec).toBe('vp09.00.10.08');
  });

  it('maps AV01 and attaches codecPrivate as description when present', () => {
    state.webm = {
      tracks: [webmVideoTrack('V_AV01', new Uint8Array([9, 9]))],
      videoChunks: chunks(3),
    };
    const { video } = demuxContainerVideo('webm', BYTES);
    expect(video.codec).toBe('av1');
    expect(video.config.description).toBeInstanceOf(Uint8Array);
  });

  it('maps AV01 without codecPrivate (no description)', () => {
    state.webm = { tracks: [webmVideoTrack('V_AV01')], videoChunks: chunks(3) };
    const { video } = demuxContainerVideo('webm', BYTES);
    expect(video.config.description).toBeUndefined();
  });

  it('throws when webm has no video track', () => {
    state.webm = { tracks: [webmAudioTrack('A_OPUS')] };
    expect(() => demuxContainerVideo('webm', BYTES)).toThrow('webm has no video track');
  });

  it('throws when the webm video track has no blocks', () => {
    state.webm = { tracks: [webmVideoTrack('V_VP9')], videoChunks: [] };
    expect(() => demuxContainerVideo('webm', BYTES)).toThrow('webm video track has no blocks');
  });

  it('returns Opus audio and derives per-chunk durations', () => {
    state.webm = {
      tracks: [webmVideoTrack('V_VP9'), webmAudioTrack('A_OPUS')],
      videoChunks: chunks(2),
      audioChunks: [
        { timestampUs: 0, data: new Uint8Array([1]) },
        { timestampUs: 20_000, data: new Uint8Array([2]) },
      ],
    };
    const { audio } = demuxContainerVideo('webm', BYTES);
    expect(audio?.config.codec).toBe('opus');
    expect(audio?.sampleRate).toBe(48_000);
    // Last chunk derives its duration from the previous chunk delta.
    expect(audio?.chunks[1]?.durationUs).toBe(20_000);
  });

  it('audio is null when the webm audio codec is not Opus (Vorbis)', () => {
    state.webm = {
      tracks: [webmVideoTrack('V_VP9'), webmAudioTrack('A_VORBIS')],
      videoChunks: chunks(2),
    };
    expect(demuxContainerVideo('webm', BYTES).audio).toBeNull();
  });

  it('audio is null when there is no audio track', () => {
    state.webm = { tracks: [webmVideoTrack('V_VP9')], videoChunks: chunks(2) };
    expect(demuxContainerVideo('webm', BYTES).audio).toBeNull();
  });

  it('single-chunk video: frameRate 0 and duration falls back to nominal', () => {
    state.webm = { tracks: [webmVideoTrack('V_VP9')], videoChunks: chunks(1) };
    const { video } = demuxContainerVideo('webm', BYTES);
    expect(video.frameRate).toBe(0);
    expect(video.chunks[0]?.durationUs).toBe(20_000);
  });

  it('skips falsy chunk entries and falls back to prior duration on the tail', () => {
    state.webm = {
      tracks: [webmVideoTrack('V_VP9')],
      videoChunks: [
        { type: 'key', timestampUs: 0, data: new Uint8Array([0]) },
        undefined,
        { type: 'delta', timestampUs: 33_000, data: new Uint8Array([1]) },
      ],
    };
    const { video } = demuxContainerVideo('webm', BYTES);
    expect(video.chunks).toHaveLength(2);
  });

  it('single Opus audio chunk uses the nominal frame duration', () => {
    state.webm = {
      tracks: [webmVideoTrack('V_VP9'), webmAudioTrack('A_OPUS')],
      videoChunks: chunks(2),
      audioChunks: [{ timestampUs: 0, data: new Uint8Array([1]) }],
    };
    const { audio } = demuxContainerVideo('webm', BYTES);
    expect(audio?.chunks[0]?.durationUs).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------
// mkv
// ---------------------------------------------------------------------------

function mkvVideoTrack(codecId: string, codecPrivate?: Uint8Array): unknown {
  return {
    trackType: 1,
    trackNumber: 1,
    codecId,
    webcodecsCodecString: 'avc1.42001f',
    pixelWidth: 320,
    pixelHeight: 240,
    ...(codecPrivate ? { codecPrivate } : {}),
  };
}

function mkvAudioTrack(codecId: string): unknown {
  return {
    trackType: 2,
    trackNumber: 2,
    codecId,
    channels: 2,
    samplingFrequency: 44100,
    webcodecsCodecString: 'mp4a.40.2',
    codecPrivate: new Uint8Array([0x11, 0x90]),
  };
}

describe('demuxContainerVideo: mkv', () => {
  it('maps each mkv codecId to its coarse codec token', () => {
    const cases: Array<[string, string]> = [
      ['V_MPEG4/ISO/AVC', 'h264'],
      ['V_MPEGH/ISO/HEVC', 'hevc'],
      ['V_VP8', 'vp8'],
      ['V_VP9', 'vp9'],
      ['V_AV01', 'av1'],
    ];
    for (const [codecId, expected] of cases) {
      state.mkv = {
        tracks: [mkvVideoTrack(codecId, new Uint8Array([1, 2]))],
        videoChunks: chunks(2),
      };
      expect(demuxContainerVideo('mkv', BYTES).video.codec).toBe(expected);
    }
  });

  it('attaches description only for codecs that need it', () => {
    state.mkv = {
      tracks: [mkvVideoTrack('V_MPEG4/ISO/AVC', new Uint8Array([1, 2]))],
      videoChunks: chunks(2),
    };
    expect(demuxContainerVideo('mkv', BYTES).video.config.description).toBeInstanceOf(Uint8Array);

    state.mkv = {
      tracks: [mkvVideoTrack('V_VP8', new Uint8Array([1, 2]))],
      videoChunks: chunks(2),
    };
    // VP8 does not need a description even when codecPrivate is present.
    expect(demuxContainerVideo('mkv', BYTES).video.config.description).toBeUndefined();
  });

  it('throws when mkv has no video track', () => {
    state.mkv = { tracks: [mkvAudioTrack('A_AAC')] };
    expect(() => demuxContainerVideo('mkv', BYTES)).toThrow('mkv has no video track');
  });

  it('throws when the mkv video track has no blocks', () => {
    state.mkv = { tracks: [mkvVideoTrack('V_VP9')], videoChunks: [] };
    expect(() => demuxContainerVideo('mkv', BYTES)).toThrow('mkv video track has no blocks');
  });

  it('returns Opus audio (48 kHz)', () => {
    state.mkv = {
      tracks: [mkvVideoTrack('V_VP9'), mkvAudioTrack('A_OPUS')],
      videoChunks: chunks(2),
      audioChunks: [
        { timestampUs: 0, data: new Uint8Array([1]) },
        { timestampUs: 20_000, data: new Uint8Array([2]) },
      ],
    };
    const { audio } = demuxContainerVideo('mkv', BYTES);
    expect(audio?.config.codec).toBe('opus');
    expect(audio?.sampleRate).toBe(48_000);
  });

  it('returns AAC audio at the track sampling frequency', () => {
    state.mkv = {
      tracks: [mkvVideoTrack('V_VP9'), mkvAudioTrack('A_AAC')],
      videoChunks: chunks(2),
      audioChunks: [{ timestampUs: 0, data: new Uint8Array([1]) }],
    };
    const { audio } = demuxContainerVideo('mkv', BYTES);
    expect(audio?.config.codec).toBe('mp4a.40.2');
    expect(audio?.sampleRate).toBe(44100);
  });

  it('audio is null for undecodable mkv audio codecs (Vorbis)', () => {
    state.mkv = {
      tracks: [mkvVideoTrack('V_VP9'), mkvAudioTrack('A_VORBIS')],
      videoChunks: chunks(2),
    };
    expect(demuxContainerVideo('mkv', BYTES).audio).toBeNull();
  });

  it('audio is null when the mkv AAC track yields no chunks', () => {
    state.mkv = {
      tracks: [mkvVideoTrack('V_VP9'), mkvAudioTrack('A_AAC')],
      videoChunks: chunks(2),
      audioChunks: [],
    };
    expect(demuxContainerVideo('mkv', BYTES).audio).toBeNull();
  });

  it('audio is null when there is no mkv audio track', () => {
    state.mkv = { tracks: [mkvVideoTrack('V_VP9')], videoChunks: chunks(2) };
    expect(demuxContainerVideo('mkv', BYTES).audio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// demuxContainerAudioTrack
// ---------------------------------------------------------------------------

describe('demuxContainerAudioTrack', () => {
  it('extracts the mp4 AAC track', () => {
    state.mp4 = { audioTrack: mp4AudioTrack(), audioSamples: audioSamples(2) };
    const track = demuxContainerAudioTrack('mp4', BYTES);
    expect(track.config.codec).toBe('mp4a.40.2');
  });

  it('extracts the webm Opus track', () => {
    state.webm = {
      tracks: [webmAudioTrack('A_OPUS')],
      audioChunks: [{ timestampUs: 0, data: new Uint8Array([1]) }],
    };
    const track = demuxContainerAudioTrack('webm', BYTES);
    expect(track.config.codec).toBe('opus');
  });

  it('extracts the mkv AAC track', () => {
    state.mkv = {
      tracks: [mkvAudioTrack('A_AAC')],
      audioChunks: [{ timestampUs: 0, data: new Uint8Array([1]) }],
    };
    const track = demuxContainerAudioTrack('mkv', BYTES);
    expect(track.config.codec).toBe('mp4a.40.2');
  });

  it('throws when the container has no decodable audio', () => {
    state.mkv = { tracks: [mkvVideoTrack('V_VP9')] };
    expect(() => demuxContainerAudioTrack('mkv', BYTES)).toThrow(TranscodeDemuxError);
  });
});

// ---------------------------------------------------------------------------
// wrap() error normalization
// ---------------------------------------------------------------------------

describe('wrap: error normalization', () => {
  it('re-throws a TranscodeDemuxError unchanged', () => {
    state.mp4 = { videoTrack: null };
    expect(() => demuxContainerVideo('mp4', BYTES)).toThrow(TranscodeDemuxError);
  });

  it('wraps a generic Error thrown by the parser', () => {
    state.mp4 = { throw: new Error('corrupt box') };
    try {
      demuxContainerVideo('mp4', BYTES);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TranscodeDemuxError);
      expect((err as Error).message).toContain('corrupt box');
      expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
    }
  });

  it('wraps a non-Error throw value via String()', () => {
    state.mp4 = { throw: 'plain string failure' };
    expect(() => demuxContainerVideo('mp4', BYTES)).toThrow('plain string failure');
  });
});
