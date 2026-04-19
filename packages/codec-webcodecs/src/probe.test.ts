import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedCodecError, WebCodecsNotSupportedError } from './errors.ts';
import { probeAudioCodec, probeVideoCodec } from './probe.ts';

// ---------------------------------------------------------------------------
// Helpers to build mock isConfigSupported responses
// ---------------------------------------------------------------------------

function makeVideoSupported(codec: string): { supported: boolean; config: VideoEncoderConfig } {
  return {
    supported: true,
    config: {
      codec,
      width: 1280,
      height: 720,
      bitrate: 2_000_000,
      framerate: 30,
      hardwareAcceleration: 'no-preference',
    } as VideoEncoderConfig,
  };
}

function makeVideoUnsupported(): { supported: boolean; config: undefined } {
  return { supported: false, config: undefined };
}

function makeAudioSupported(codec: string): { supported: boolean; config: AudioEncoderConfig } {
  return {
    supported: true,
    config: {
      codec,
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 128_000,
    } as AudioEncoderConfig,
  };
}

function makeAudioUnsupported(): { supported: boolean; config: undefined } {
  return { supported: false, config: undefined };
}

// ---------------------------------------------------------------------------
// probeVideoCodec
// ---------------------------------------------------------------------------

describe('probeVideoCodec', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns supported=true for h264 when browser accepts config', async () => {
    const codecString = 'avc1.42001E';
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(
      makeVideoSupported(codecString),
    );

    const result = await probeVideoCodec({ codec: 'h264' });

    expect(result.supported).toBe(true);
    expect(result.codecString).toBe(codecString);
    expect(result.supportedConfig).toBeDefined();
  });

  it('returns supported=true for vp9 when browser accepts config', async () => {
    const codecString = 'vp09.00.10.08';
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(
      makeVideoSupported(codecString),
    );

    const result = await probeVideoCodec({ codec: 'vp9' });

    expect(result.supported).toBe(true);
    expect(result.codecString).toBe(codecString);
  });

  it('returns supported=true for av1 when browser accepts config', async () => {
    const codecString = 'av01.0.04M.08';
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(
      makeVideoSupported(codecString),
    );

    const result = await probeVideoCodec({ codec: 'av1' });

    expect(result.supported).toBe(true);
    expect(result.codecString).toBe(codecString);
  });

  it('returns supported=false when browser rejects config', async () => {
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(makeVideoUnsupported());

    const result = await probeVideoCodec({ codec: 'hevc' });

    expect(result.supported).toBe(false);
    expect(result.supportedConfig).toBeUndefined();
  });

  it('uses custom codecString when provided', async () => {
    const custom = 'avc1.640028';
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(
      makeVideoSupported(custom),
    );

    const result = await probeVideoCodec({ codec: 'h264', codecString: custom });

    expect(result.codecString).toBe(custom);
    const call = vi.mocked(globalThis.VideoEncoder.isConfigSupported).mock.calls[0];
    expect(call?.[0].codec).toBe(custom);
  });

  it('forwards width/height/bitrate/framerate when provided', async () => {
    vi.mocked(globalThis.VideoEncoder.isConfigSupported).mockResolvedValue(
      makeVideoSupported('avc1.42001E'),
    );

    await probeVideoCodec({
      codec: 'h264',
      width: 1920,
      height: 1080,
      bitrate: 8_000_000,
      framerate: 60,
    });

    const call = vi.mocked(globalThis.VideoEncoder.isConfigSupported).mock.calls[0];
    expect(call?.[0].width).toBe(1920);
    expect(call?.[0].height).toBe(1080);
    expect(call?.[0].bitrate).toBe(8_000_000);
    expect(call?.[0].framerate).toBe(60);
  });

  it('throws WebCodecsNotSupportedError when VideoEncoder is absent', async () => {
    vi.unstubAllGlobals();
    // Explicitly remove the global
    vi.stubGlobal('VideoEncoder', undefined);

    await expect(probeVideoCodec({ codec: 'h264' })).rejects.toThrow(WebCodecsNotSupportedError);
  });
});

// ---------------------------------------------------------------------------
// probeAudioCodec
// ---------------------------------------------------------------------------

describe('probeAudioCodec', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioEncoder', {
      isConfigSupported: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns supported=true for aac when browser accepts config', async () => {
    const codecString = 'mp4a.40.2';
    vi.mocked(globalThis.AudioEncoder.isConfigSupported).mockResolvedValue(
      makeAudioSupported(codecString),
    );

    const result = await probeAudioCodec({ codec: 'aac' });

    expect(result.supported).toBe(true);
    expect(result.codecString).toBe(codecString);
    expect(result.supportedConfig).toBeDefined();
  });

  it('returns supported=true for opus when browser accepts config', async () => {
    vi.mocked(globalThis.AudioEncoder.isConfigSupported).mockResolvedValue(
      makeAudioSupported('opus'),
    );

    const result = await probeAudioCodec({ codec: 'opus' });

    expect(result.supported).toBe(true);
    expect(result.hardwareAccelerated).toBe(false);
  });

  it('returns supported=false when browser rejects config', async () => {
    vi.mocked(globalThis.AudioEncoder.isConfigSupported).mockResolvedValue(makeAudioUnsupported());

    const result = await probeAudioCodec({ codec: 'vorbis' });

    expect(result.supported).toBe(false);
    expect(result.supportedConfig).toBeUndefined();
  });

  it('throws WebCodecsNotSupportedError when AudioEncoder is absent', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('AudioEncoder', undefined);

    await expect(probeAudioCodec({ codec: 'aac' })).rejects.toThrow(WebCodecsNotSupportedError);
  });

  it('uses custom codecString when provided', async () => {
    const custom = 'mp4a.40.5'; // AAC-HE
    vi.mocked(globalThis.AudioEncoder.isConfigSupported).mockResolvedValue(
      makeAudioSupported(custom),
    );

    const result = await probeAudioCodec({ codec: 'aac', codecString: custom });

    expect(result.codecString).toBe(custom);
  });

  it('forwards sampleRate/numberOfChannels/bitrate when provided', async () => {
    vi.mocked(globalThis.AudioEncoder.isConfigSupported).mockResolvedValue(
      makeAudioSupported('opus'),
    );

    await probeAudioCodec({
      codec: 'opus',
      sampleRate: 44_100,
      numberOfChannels: 1,
      bitrate: 64_000,
    });

    const call = vi.mocked(globalThis.AudioEncoder.isConfigSupported).mock.calls[0];
    expect(call?.[0].sampleRate).toBe(44_100);
    expect(call?.[0].numberOfChannels).toBe(1);
    expect(call?.[0].bitrate).toBe(64_000);
  });
});
