import { parseMkv } from '@catlabtech/webcvt-container-mkv';
import { decodeOpusHead } from '@catlabtech/webcvt-container-ogg';
import { parseWebm } from '@catlabtech/webcvt-container-webm';
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockAudioData,
  MockEncodedAudioChunk,
  MockEncodedVideoChunk,
  makeAudioDecoderClass,
  makeAudioEncoderClass,
  makeVideoDecoderClass,
  makeVideoEncoderClass,
} from './_test-helpers/webcodecs.ts';
import { ProbeCache } from './probe-cache.ts';
import { transcodeVideo } from './video.ts';

// ---------------------------------------------------------------------------
// Stub harness
// ---------------------------------------------------------------------------

type VideoSupport = 'all' | 'vp8-only';

interface StubOptions {
  /** Which video codecs the encoder claims to support. */
  video?: VideoSupport;
  /** Include working AudioDecoder/AudioEncoder globals (else audio → video-only). */
  audio?: boolean;
  /** Report hardware acceleration for video encode. */
  hardware?: boolean;
}

function videoConfigSupported(support: VideoSupport, hardware: boolean) {
  return vi.fn(async (config: VideoEncoderConfig | VideoDecoderConfig) => {
    const codec = config.codec;
    const supported = support === 'all' || !codec.startsWith('vp09');
    return {
      supported,
      config: {
        ...config,
        hardwareAcceleration: hardware ? 'prefer-hardware' : 'no-preference',
      },
    };
  });
}

function stub(opts: StubOptions = {}): {
  videoDecoder: ReturnType<typeof makeVideoDecoderClass>;
  videoEncoder: ReturnType<typeof makeVideoEncoderClass>;
} {
  const support = opts.video ?? 'all';
  const hardware = opts.hardware ?? false;

  const videoDecoder = makeVideoDecoderClass();
  const videoEncoder = makeVideoEncoderClass();
  (videoDecoder.DecoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported =
    videoConfigSupported('all', false);
  (videoEncoder.EncoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported =
    videoConfigSupported(support, hardware);

  vi.stubGlobal('VideoDecoder', videoDecoder.DecoderClass);
  vi.stubGlobal('VideoEncoder', videoEncoder.EncoderClass);
  vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk);

  if (opts.audio ?? true) {
    const audioDecoder = makeAudioDecoderClass();
    const audioEncoder = makeAudioEncoderClass();
    (audioDecoder.DecoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = vi
      .fn()
      .mockResolvedValue({ supported: true, config: {} });
    (audioEncoder.EncoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported = vi
      .fn()
      .mockResolvedValue({ supported: true, config: {} });
    vi.stubGlobal('AudioDecoder', audioDecoder.DecoderClass);
    vi.stubGlobal('AudioEncoder', audioEncoder.EncoderClass);
    vi.stubGlobal('EncodedAudioChunk', MockEncodedAudioChunk);
    vi.stubGlobal('AudioData', MockAudioData);
  } else {
    vi.stubGlobal('AudioDecoder', undefined);
    vi.stubGlobal('AudioEncoder', undefined);
  }

  return { videoDecoder, videoEncoder };
}

describe('transcodeVideo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mp4 (h264 + aac) → webm: V_VP9 + A_OPUS tracks, sane timestamps', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const { videoEncoder } = stub({ audio: true });

    const result = await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), { quality: 0.7 });
    expect(result.audioIncluded).toBe(true);

    const parsed = parseWebm(result.bytes);
    const video = parsed.tracks.find((t) => t.trackType === 1);
    const audio = parsed.tracks.find((t) => t.trackType === 2);
    expect(video?.codecId).toBe('V_VP9');
    expect(audio?.codecId).toBe('A_OPUS');
    expect((video as { pixelWidth: number }).pixelWidth).toBe(160);
    expect((video as { pixelHeight: number }).pixelHeight).toBe(120);

    // Opus head is valid.
    const head = decodeOpusHead((audio as { codecPrivate: Uint8Array }).codecPrivate);
    expect(head.channelCount).toBe(1);

    // Clusters carry blocks with monotone non-decreasing timestamps.
    expect(parsed.clusters.length).toBeGreaterThan(0);
    const all = parsed.clusters.flatMap((c) => c.blocks);
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.timestampNs).toBeGreaterThanOrEqual(all[i - 1]!.timestampNs);
    }
    // The VP9 encoder was configured with a positive bitrate + framerate.
    const cfg = videoEncoder.controls.instances[0]?.config;
    expect(cfg?.codec).toBe('vp09.00.10.08');
    expect(cfg?.bitrate).toBeGreaterThan(0);
    expect(cfg?.framerate).toBeGreaterThan(0);
    // First encoded frame requested as a keyframe.
    expect(videoEncoder.controls.instances[0]?.keyFrames[0]).toBe(true);
  });

  it('mp4 → mkv: V_VP9 + A_OPUS in a Matroska container', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    stub({ audio: true });
    const result = await transcodeVideo('mp4', 'mkv', bytes, new ProbeCache(), { quality: 0.7 });

    const parsed = parseMkv(result.bytes);
    expect(parsed.tracks.find((t) => t.trackType === 1)?.codecId).toBe('V_VP9');
    expect(parsed.tracks.find((t) => t.trackType === 2)?.codecId).toBe('A_OPUS');
    expect(result.audioIncluded).toBe(true);
  });

  it('video-only when the audio codecs are unavailable (Safari-style)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub({ audio: false });

    const result = await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), { quality: 0.7 });
    expect(result.audioIncluded).toBe(false);

    const parsed = parseWebm(result.bytes);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.trackType).toBe(1);
    expect(parsed.tracks[0]?.codecId).toBe('V_VP9');
    warn.mockRestore();
  });

  it('webm (vp8 + vorbis) → webm re-encode: VP9 video, video-only (Vorbis undecodable)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    stub({ audio: true }); // audio globals present, but source is Vorbis → dropped at demux

    const result = await transcodeVideo('webm', 'webm', bytes, new ProbeCache(), { quality: 0.7 });
    expect(result.audioIncluded).toBe(false);
    const parsed = parseWebm(result.bytes);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.codecId).toBe('V_VP9');
  });

  it('falls back to VP8 when VP9 encode is unsupported', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const { videoEncoder } = stub({ video: 'vp8-only', audio: false });

    const result = await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), { quality: 0.7 });
    const parsed = parseWebm(result.bytes);
    expect(parsed.tracks.find((t) => t.trackType === 1)?.codecId).toBe('V_VP8');
    expect(videoEncoder.controls.instances[0]?.config?.codec).toBe('vp8');
  });

  it('reports hardware acceleration from the encoder probe', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    stub({ hardware: true, audio: false });
    const result = await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), { quality: 0.7 });
    expect(result.hardwareAccelerated).toBe(true);
  });

  it('closes every decoded VideoFrame (no GPU surface leak)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const { videoDecoder } = stub({ audio: false });

    await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), { quality: 0.7 });

    expect(videoDecoder.controls.frames.length).toBeGreaterThan(0);
    expect(videoDecoder.controls.frames.every((f) => f.closed)).toBe(true);
    // Decoder + encoder closed.
    expect(videoDecoder.controls.instances[0]?.closed).toBe(true);
  });

  it('emits monotone progress ending at done:100', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    stub({ audio: true });
    const events: Array<{ percent: number; phase: string }> = [];

    await transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), {
      quality: 0.7,
      onProgress: (percent, phase) => events.push({ percent, phase }),
    });

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('demux');
    expect(phases).toContain('encode');
    expect(phases.at(-1)).toBe('done');
    expect(events.at(-1)?.percent).toBe(100);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.percent).toBeGreaterThanOrEqual(events[i - 1]!.percent);
    }
  });

  it('aborts mid-video and closes the codecs', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const controller = new AbortController();

    const videoDecoder = makeVideoDecoderClass({
      onDecode: (i) => {
        if (i === 0) controller.abort();
      },
    });
    const videoEncoder = makeVideoEncoderClass();
    (videoDecoder.DecoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported =
      videoConfigSupported('all', false);
    (videoEncoder.EncoderClass as unknown as { isConfigSupported: unknown }).isConfigSupported =
      videoConfigSupported('all', false);
    vi.stubGlobal('VideoDecoder', videoDecoder.DecoderClass);
    vi.stubGlobal('VideoEncoder', videoEncoder.EncoderClass);
    vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk);
    vi.stubGlobal('AudioDecoder', undefined);
    vi.stubGlobal('AudioEncoder', undefined);

    await expect(
      transcodeVideo('mp4', 'webm', bytes, new ProbeCache(), {
        quality: 0.7,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(videoDecoder.controls.instances[0]?.closed).toBe(true);
    expect(videoEncoder.controls.instances[0]?.closed).toBe(true);
  });
});
