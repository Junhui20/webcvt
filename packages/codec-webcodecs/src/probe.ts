import { UnsupportedCodecError, WebCodecsNotSupportedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Codec name literals
// ---------------------------------------------------------------------------

export type VideoCodecName = 'h264' | 'vp9' | 'vp8' | 'av1' | 'hevc';
export type AudioCodecName = 'aac' | 'opus' | 'mp3' | 'flac' | 'vorbis';
export type CodecName = VideoCodecName | AudioCodecName;

// ---------------------------------------------------------------------------
// Codec string mapping (WebCodecs codec string format)
// ---------------------------------------------------------------------------

/**
 * Maps a friendly codec name to a WebCodecs-compatible codec string.
 * These are intentionally baseline strings; container packages may supply
 * more specific strings (e.g. avc1.640028 for H.264 High Profile Level 4.0).
 */
const VIDEO_CODEC_STRINGS: Record<VideoCodecName, string> = {
  h264: 'avc1.42001E', // H.264 Baseline Profile Level 3.0
  vp9: 'vp09.00.10.08',
  vp8: 'vp8',
  av1: 'av01.0.04M.08',
  hevc: 'hev1.1.6.L93.B0',
};

const AUDIO_CODEC_STRINGS: Record<AudioCodecName, string> = {
  aac: 'mp4a.40.2', // AAC-LC
  opus: 'opus',
  mp3: 'mp3',
  flac: 'flac',
  vorbis: 'vorbis',
};

// ---------------------------------------------------------------------------
// Probe config types
// ---------------------------------------------------------------------------

export interface VideoProbeConfig {
  readonly codec: VideoCodecName;
  /** Custom WebCodecs codec string — overrides the built-in mapping. */
  readonly codecString?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bitrate?: number;
  readonly framerate?: number;
  readonly hardwareAcceleration?: HardwareAcceleration;
}

export interface AudioProbeConfig {
  readonly codec: AudioCodecName;
  /** Custom WebCodecs codec string — overrides the built-in mapping. */
  readonly codecString?: string;
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
  readonly bitrate?: number;
}

export interface ProbeResult {
  /** Whether the codec + config is supported. */
  readonly supported: boolean;
  /** The codec string that was probed. */
  readonly codecString: string;
  /** Whether hardware acceleration is available for this config. */
  readonly hardwareAccelerated: boolean;
  /**
   * The config as returned by the browser's isConfigSupported().
   * Undefined when supported is false. Encoder probes return an encoder config;
   * decoder probes return a decoder config.
   */
  readonly supportedConfig?:
    | VideoEncoderConfig
    | AudioEncoderConfig
    | VideoDecoderConfig
    | AudioDecoderConfig;
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

function assertVideoEncoderAvailable(): void {
  if (typeof globalThis.VideoEncoder === 'undefined') {
    throw new WebCodecsNotSupportedError();
  }
}

function assertAudioEncoderAvailable(): void {
  if (typeof globalThis.AudioEncoder === 'undefined') {
    throw new WebCodecsNotSupportedError();
  }
}

function assertVideoDecoderAvailable(): void {
  if (typeof globalThis.VideoDecoder === 'undefined') {
    throw new WebCodecsNotSupportedError();
  }
}

function assertAudioDecoderAvailable(): void {
  if (typeof globalThis.AudioDecoder === 'undefined') {
    throw new WebCodecsNotSupportedError();
  }
}

// ---------------------------------------------------------------------------
// Public probe functions
// ---------------------------------------------------------------------------

/**
 * Probes whether the given video codec + configuration is supported in the
 * current runtime by calling VideoEncoder.isConfigSupported().
 *
 * @throws {WebCodecsNotSupportedError} when VideoEncoder is not available.
 * @throws {UnsupportedCodecError} when the codec name has no known codec string.
 */
export async function probeVideoCodec(config: VideoProbeConfig): Promise<ProbeResult> {
  assertVideoEncoderAvailable();

  const codecString = config.codecString ?? VIDEO_CODEC_STRINGS[config.codec];
  if (!codecString) {
    throw new UnsupportedCodecError(config.codec, 'No codec string mapping found.');
  }

  const encoderConfig: VideoEncoderConfig = {
    codec: codecString,
    width: config.width ?? 1280,
    height: config.height ?? 720,
    bitrate: config.bitrate ?? 2_000_000,
    framerate: config.framerate ?? 30,
    hardwareAcceleration: config.hardwareAcceleration ?? 'no-preference',
  };

  const result = await globalThis.VideoEncoder.isConfigSupported(encoderConfig);

  return {
    supported: result.supported ?? false,
    codecString,
    hardwareAccelerated: isHardwareAccelerated(result.config?.hardwareAcceleration),
    supportedConfig: result.supported ? (result.config as VideoEncoderConfig) : undefined,
  };
}

/**
 * Probes whether the given audio codec + configuration is supported in the
 * current runtime by calling AudioEncoder.isConfigSupported().
 *
 * @throws {WebCodecsNotSupportedError} when AudioEncoder is not available.
 * @throws {UnsupportedCodecError} when the codec name has no known codec string.
 */
export async function probeAudioCodec(config: AudioProbeConfig): Promise<ProbeResult> {
  assertAudioEncoderAvailable();

  const codecString = config.codecString ?? AUDIO_CODEC_STRINGS[config.codec];
  if (!codecString) {
    throw new UnsupportedCodecError(config.codec, 'No codec string mapping found.');
  }

  const encoderConfig: AudioEncoderConfig = {
    codec: codecString,
    sampleRate: config.sampleRate ?? 48_000,
    numberOfChannels: config.numberOfChannels ?? 2,
    bitrate: config.bitrate ?? 128_000,
  };

  const result = await globalThis.AudioEncoder.isConfigSupported(encoderConfig);

  return {
    supported: result.supported ?? false,
    codecString,
    hardwareAccelerated: false, // Audio encoding is always software in current browsers
    supportedConfig: result.supported ? (result.config as AudioEncoderConfig) : undefined,
  };
}

/**
 * Probes whether the given video codec + configuration can be DECODED in the
 * current runtime by calling VideoDecoder.isConfigSupported().
 *
 * A transcode pipeline must probe both sides of a conversion (can I decode the
 * input codec? can I encode the output codec?). This is the decoder counterpart
 * to {@link probeVideoCodec}; caching and codec-string mapping are identical.
 *
 * @throws {WebCodecsNotSupportedError} when VideoDecoder is not available.
 * @throws {UnsupportedCodecError} when the codec name has no known codec string.
 */
export async function probeVideoDecoder(config: VideoProbeConfig): Promise<ProbeResult> {
  assertVideoDecoderAvailable();

  const codecString = config.codecString ?? VIDEO_CODEC_STRINGS[config.codec];
  if (!codecString) {
    throw new UnsupportedCodecError(config.codec, 'No codec string mapping found.');
  }

  const decoderConfig: VideoDecoderConfig = {
    codec: codecString,
    codedWidth: config.width ?? 1280,
    codedHeight: config.height ?? 720,
    hardwareAcceleration: config.hardwareAcceleration ?? 'no-preference',
  };

  const result = await globalThis.VideoDecoder.isConfigSupported(decoderConfig);

  return {
    supported: result.supported ?? false,
    codecString,
    hardwareAccelerated: isHardwareAccelerated(result.config?.hardwareAcceleration),
    supportedConfig: result.supported ? (result.config as VideoDecoderConfig) : undefined,
  };
}

/**
 * Probes whether the given audio codec + configuration can be DECODED in the
 * current runtime by calling AudioDecoder.isConfigSupported().
 *
 * Decoder counterpart to {@link probeAudioCodec}. On Safari < 26 (and any
 * runtime without WebCodecs audio) `AudioDecoder` is absent, so this throws
 * {@link WebCodecsNotSupportedError} — the transcode backend treats that as
 * "cannot handle" and falls through to ffmpeg-wasm.
 *
 * @throws {WebCodecsNotSupportedError} when AudioDecoder is not available.
 * @throws {UnsupportedCodecError} when the codec name has no known codec string.
 */
export async function probeAudioDecoder(config: AudioProbeConfig): Promise<ProbeResult> {
  assertAudioDecoderAvailable();

  const codecString = config.codecString ?? AUDIO_CODEC_STRINGS[config.codec];
  if (!codecString) {
    throw new UnsupportedCodecError(config.codec, 'No codec string mapping found.');
  }

  const decoderConfig: AudioDecoderConfig = {
    codec: codecString,
    sampleRate: config.sampleRate ?? 48_000,
    numberOfChannels: config.numberOfChannels ?? 2,
  };

  const result = await globalThis.AudioDecoder.isConfigSupported(decoderConfig);

  return {
    supported: result.supported ?? false,
    codecString,
    hardwareAccelerated: false, // Audio decoding is always software in current browsers
    supportedConfig: result.supported ? (result.config as AudioDecoderConfig) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isHardwareAccelerated(accel: HardwareAcceleration | undefined | null): boolean {
  return accel === 'prefer-hardware';
}
