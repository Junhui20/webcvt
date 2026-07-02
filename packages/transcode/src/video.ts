/**
 * Video transcode pipeline: mp4/webm/mkv → webm/mkv (VP9|VP8 + Opus).
 *
 * Flow: demux both tracks → decode H.264/VP8/VP9 video to `VideoFrame`s and feed
 * them straight into a VP9 (fallback VP8) `VideoEncoder`, closing every frame the
 * moment it is handed off (the wrapper's `finally` closes it — VideoFrames leak
 * GPU surfaces otherwise). If the source carries audio AND both the audio decoder
 * and the Opus encoder probe as supported, the audio track is decoded to PCM and
 * re-encoded to Opus (reusing the audio stage); otherwise a **video-only** webm/mkv
 * is emitted (Safari-style video-only WebCodecs) and surfaced via
 * {@link VideoTranscodeResult.audioIncluded}.
 *
 * The muxer is buffer-all: encoded chunks accumulate into a model, then one
 * `serializeWebm`/`serializeMkv` call. Clusters split on video keyframes and
 * whenever a per-block tick delta would approach the int16 SimpleBlock limit.
 *
 * See docs/design-notes/transcode.md §D (category 1, flagship) and §E.
 */

import { WebCodecsVideoDecoder, WebCodecsVideoEncoder } from '@catlabtech/webcvt-codec-webcodecs';
import {
  type MkvAudioTrack,
  type MkvCluster,
  type MkvFile,
  type MkvVideoTrack,
  serializeMkv,
} from '@catlabtech/webcvt-container-mkv';
import { buildOpusHead } from '@catlabtech/webcvt-container-ogg';
import {
  type WebmAudioTrack,
  type WebmCluster,
  type WebmFile,
  type WebmVideoTrack,
  serializeWebm,
} from '@catlabtech/webcvt-container-webm';
import { asCodecError, throwIfAborted } from './abort.ts';
import { decodeToPcm } from './decode.ts';
import { type EncodedOut, OPUS_PRE_SKIP, OPUS_RATE, encodeOpusChunks } from './encode.ts';
import { TranscodeCodecError } from './errors.ts';
import { type ContainerFamily, resolveVideoBitrate } from './matrix.ts';
import type { ProbeCache } from './probe-cache.ts';
import {
  type ContainerVideoDemux,
  type EncodedAudioTrack,
  demuxContainerVideo,
} from './video-demux.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VideoTranscodeOptions {
  readonly quality: number;
  readonly signal?: AbortSignal;
  readonly hardwareAcceleration?: HardwareAcceleration;
  /** (percent 0–100, phase) — already monotone. */
  readonly onProgress?: (percent: number, phase: string) => void;
}

export interface VideoTranscodeResult {
  readonly bytes: Uint8Array;
  readonly hardwareAccelerated: boolean;
  /** False → the source had audio we could not transcode; output is video-only. */
  readonly audioIncluded: boolean;
}

const KEYFRAME_INTERVAL_US = 2_000_000; // request a keyframe at most every 2 s.
const WEBM_TIMECODE_SCALE = 1_000_000; // 1 ms ticks.
const CLUSTER_MAX_TICKS = 30_000; // keep every SimpleBlock delta well inside int16.
const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;

/**
 * Transcode a container's video (and, when possible, audio) track to a fresh
 * webm/mkv with VP9|VP8 video + Opus audio.
 */
export async function transcodeVideo(
  family: ContainerFamily,
  outputContainer: 'webm' | 'mkv',
  bytes: Uint8Array,
  probes: ProbeCache,
  opts: VideoTranscodeOptions,
): Promise<VideoTranscodeResult> {
  const { signal } = opts;
  const emit = monotone(opts.onProgress);

  emit(0, 'demux');
  const demux = demuxContainerVideo(family, bytes);
  emit(5, 'demux');
  throwIfAborted(signal);

  // Choose the video encoder: prefer VP9, fall back to VP8. Both are probed at
  // the real geometry so we also learn hardware acceleration.
  const { videoCodec, codecString, hardwareAccelerated } = await selectVideoEncoder(
    demux.video,
    probes,
    opts.hardwareAcceleration,
  );

  // Decide up front whether the audio track can ride along (probe-gated).
  const audioPlan = await planAudio(demux.audio, probes);
  const videoCap = audioPlan ? 60 : 90; // reserve the tail for audio when present.

  emit(5, 'decode');
  const videoOut = await encodeVideoTrack(demux, videoCodec, codecString, {
    signal,
    hardwareAcceleration: opts.hardwareAcceleration,
    quality: opts.quality,
    onEncoded: (fraction) => emit(5 + fraction * (videoCap - 5), 'encode'),
  });
  throwIfAborted(signal);

  // Audio sub-pipeline (decode → Opus), reusing the audio stage.
  let audioOut: EncodedOut[] | null = null;
  let audioChannels = 2;
  if (audioPlan) {
    emit(videoCap, 'decode');
    const decoded = await decodeToPcm(
      {
        kind: 'encoded',
        config: audioPlan.track.config,
        chunks: audioPlan.track.chunks,
        sampleRate: audioPlan.track.sampleRate,
        numberOfChannels: audioPlan.track.numberOfChannels,
      },
      { signal, onProgress: (f) => emit(videoCap + f * 10, 'decode') },
    );
    throwIfAborted(signal);
    audioChannels = Math.max(1, decoded.numberOfChannels);
    audioOut = await encodeOpusChunks(
      decoded,
      {},
      { signal, onProgress: (f) => emit(70 + f * 20, 'encode') },
    );
    throwIfAborted(signal);
  }

  emit(90, 'mux');
  const outBytes =
    outputContainer === 'mkv'
      ? buildMkv(
          demux.video.width,
          demux.video.height,
          videoCodec,
          videoOut,
          audioOut,
          audioChannels,
        )
      : buildWebm(
          demux.video.width,
          demux.video.height,
          videoCodec,
          videoOut,
          audioOut,
          audioChannels,
        );
  throwIfAborted(signal);

  emit(100, 'done');
  return { bytes: outBytes, hardwareAccelerated, audioIncluded: audioOut !== null };
}

// ---------------------------------------------------------------------------
// Encoder selection
// ---------------------------------------------------------------------------

async function selectVideoEncoder(
  video: ContainerVideoDemux['video'],
  probes: ProbeCache,
  hardwareAcceleration: HardwareAcceleration | undefined,
): Promise<{ videoCodec: 'vp9' | 'vp8'; codecString: string; hardwareAccelerated: boolean }> {
  const hints = {
    width: video.width,
    height: video.height,
    ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
  };
  const vp9 = await probes.probeEncodeVideo('vp9', hints);
  if (vp9) {
    return {
      videoCodec: 'vp9',
      codecString: 'vp09.00.10.08',
      hardwareAccelerated: vp9.hardwareAccelerated,
    };
  }
  const vp8 = await probes.probeEncodeVideo('vp8', hints);
  if (vp8) {
    return { videoCodec: 'vp8', codecString: 'vp8', hardwareAccelerated: vp8.hardwareAccelerated };
  }
  throw new TranscodeCodecError('no VP9/VP8 video encoder is supported in this runtime');
}

interface AudioPlan {
  readonly track: EncodedAudioTrack;
}

async function planAudio(
  audio: EncodedAudioTrack | null,
  probes: ProbeCache,
): Promise<AudioPlan | null> {
  if (!audio) return null;
  const inputCodec = audioCodecName(audio.config.codec);
  if (!inputCodec) return null;
  if (!(await probes.canDecode(inputCodec))) return null;
  if (!(await probes.canEncode('opus'))) return null;
  return { track: audio };
}

function audioCodecName(codec: string): 'aac' | 'opus' | 'flac' | null {
  if (codec === 'opus') return 'opus';
  if (codec.startsWith('mp4a') || codec === 'aac') return 'aac';
  if (codec === 'flac') return 'flac';
  return null;
}

// ---------------------------------------------------------------------------
// Video decode → encode
// ---------------------------------------------------------------------------

interface VideoOut {
  readonly data: Uint8Array;
  readonly timestampUs: number;
  readonly keyframe: boolean;
}

interface VideoEncodeCtx {
  readonly signal?: AbortSignal;
  readonly hardwareAcceleration?: HardwareAcceleration;
  readonly quality: number;
  readonly onEncoded: (fraction: number) => void;
}

async function encodeVideoTrack(
  demux: ContainerVideoDemux,
  videoCodec: 'vp9' | 'vp8',
  codecString: string,
  ctx: VideoEncodeCtx,
): Promise<VideoOut[]> {
  const { video } = demux;
  const { width, height } = video;
  const frameRate = video.frameRate > 0 ? video.frameRate : 30;
  const bitrate = resolveVideoBitrate(width, height, ctx.quality, videoCodec);
  const total = video.chunks.length || 1;

  const out: VideoOut[] = [];
  const encoder = new WebCodecsVideoEncoder(
    {
      config: {
        codec: codecString,
        width,
        height,
        bitrate,
        framerate: frameRate,
        ...(ctx.hardwareAcceleration ? { hardwareAcceleration: ctx.hardwareAcceleration } : {}),
      },
    },
    (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      out.push({ data, timestampUs: chunk.timestamp, keyframe: chunk.type === 'key' });
      ctx.onEncoded(Math.min(1, out.length / total));
    },
  );

  let frameIndex = 0;
  let lastKeyframeUs = Number.NEGATIVE_INFINITY;
  const decoder = new WebCodecsVideoDecoder({ config: video.config }, (frame) => {
    // If an abort raced in (the signal listener closes the encoder mid-flush),
    // don't feed the now-closed encoder — just release the frame. The feed loop
    // then throws the AbortError on its next `throwIfAborted`.
    if (ctx.signal?.aborted) {
      frame.close();
      return;
    }
    const ts = frame.timestamp;
    const keyFrame = frameIndex === 0 || ts - lastKeyframeUs >= KEYFRAME_INTERVAL_US;
    if (keyFrame) lastKeyframeUs = ts;
    frameIndex++;
    // The encoder wrapper takes ownership and closes the frame in its finally,
    // so we never reuse it and no GPU surface leaks.
    encoder.encode(frame, { keyFrame });
  });

  const onAbort = (): void => {
    decoder.close();
    encoder.close();
  };
  ctx.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (let i = 0; i < video.chunks.length; i++) {
      throwIfAborted(ctx.signal);
      const c = video.chunks[i];
      if (!c) continue;
      decoder.decode(
        new EncodedVideoChunk({
          type: c.type,
          timestamp: c.timestampUs,
          duration: c.durationUs,
          data: c.data,
        }),
      );
    }
    await decoder.flush();
    throwIfAborted(ctx.signal);
    await encoder.flush();
    throwIfAborted(ctx.signal);
  } catch (err) {
    throw asCodecError(err, 'video');
  } finally {
    ctx.signal?.removeEventListener('abort', onAbort);
    decoder.close();
    encoder.close();
  }

  return out;
}

// ---------------------------------------------------------------------------
// Mux — shared cluster builder + webm/mkv adapters
// ---------------------------------------------------------------------------

interface OutBlock {
  readonly trackNumber: number;
  readonly timestampUs: number;
  readonly keyframe: boolean;
  readonly data: Uint8Array;
}

interface BuiltCluster {
  readonly fileOffset: number;
  readonly timecode: bigint;
  readonly blocks: Array<{
    trackNumber: number;
    timestampNs: bigint;
    keyframe: boolean;
    invisible: boolean;
    discardable: boolean;
    frames: Uint8Array[];
  }>;
}

/**
 * Merge video + audio blocks in timestamp order and split into clusters. A new
 * cluster begins on a video keyframe or whenever the tick delta from the current
 * cluster start would approach the int16 SimpleBlock limit.
 */
function buildClusters(videoOut: VideoOut[], audioOut: EncodedOut[] | null): BuiltCluster[] {
  const blocks: OutBlock[] = [];
  for (const v of videoOut) {
    blocks.push({
      trackNumber: VIDEO_TRACK,
      timestampUs: v.timestampUs,
      keyframe: v.keyframe,
      data: v.data,
    });
  }
  if (audioOut) {
    for (const a of audioOut) {
      blocks.push({
        trackNumber: AUDIO_TRACK,
        timestampUs: a.timestampUs,
        keyframe: true,
        data: a.data,
      });
    }
  }
  // Stable sort by timestamp; video (pushed first) wins ties so a cluster opens
  // on the keyframe rather than a co-timed audio block.
  blocks.sort((x, y) => x.timestampUs - y.timestampUs);

  const clusters: BuiltCluster[] = [];
  let current: BuiltCluster | null = null;
  for (const b of blocks) {
    const tick = BigInt(Math.round(b.timestampUs / 1000)); // µs → 1 ms ticks
    const startNew =
      current === null ||
      (b.trackNumber === VIDEO_TRACK && b.keyframe) ||
      tick - current.timecode > BigInt(CLUSTER_MAX_TICKS);
    if (startNew) {
      current = { fileOffset: 0, timecode: tick, blocks: [] };
      clusters.push(current);
    }
    current?.blocks.push({
      trackNumber: b.trackNumber,
      timestampNs: tick * BigInt(WEBM_TIMECODE_SCALE),
      keyframe: b.keyframe,
      invisible: false,
      discardable: false,
      frames: [b.data],
    });
  }
  return clusters;
}

function buildWebm(
  width: number,
  height: number,
  videoCodec: 'vp9' | 'vp8',
  videoOut: VideoOut[],
  audioOut: EncodedOut[] | null,
  audioChannels: number,
): Uint8Array {
  const videoTrack: WebmVideoTrack = {
    trackNumber: VIDEO_TRACK,
    trackUid: 1n,
    trackType: 1,
    codecId: videoCodec === 'vp8' ? 'V_VP8' : 'V_VP9',
    pixelWidth: width,
    pixelHeight: height,
  };
  const tracks: WebmFile['tracks'] = [videoTrack];
  if (audioOut) {
    const audioTrack: WebmAudioTrack = {
      trackNumber: AUDIO_TRACK,
      trackUid: 2n,
      trackType: 2,
      codecId: 'A_OPUS',
      codecPrivate: opusHead(audioChannels),
      samplingFrequency: OPUS_RATE,
      channels: audioChannels,
    };
    tracks.push(audioTrack);
  }

  const file: WebmFile = {
    ebmlHeader: {
      ebmlVersion: 1,
      ebmlReadVersion: 1,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'webm',
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    },
    segmentPayloadOffset: 0,
    info: {
      timecodeScale: WEBM_TIMECODE_SCALE,
      muxingApp: 'webcvt-transcode',
      writingApp: 'webcvt-transcode',
    },
    tracks,
    clusters: buildClusters(videoOut, audioOut) as WebmCluster[],
    fileBytes: new Uint8Array(0),
  };
  return serializeWebm(file);
}

function buildMkv(
  width: number,
  height: number,
  videoCodec: 'vp9' | 'vp8',
  videoOut: VideoOut[],
  audioOut: EncodedOut[] | null,
  audioChannels: number,
): Uint8Array {
  const videoTrack: MkvVideoTrack = {
    trackNumber: VIDEO_TRACK,
    trackUid: 1n,
    trackType: 1,
    codecId: videoCodec === 'vp8' ? 'V_VP8' : 'V_VP9',
    pixelWidth: width,
    pixelHeight: height,
    webcodecsCodecString: videoCodec === 'vp8' ? 'vp8' : 'vp09.00.10.08',
  };
  const tracks: MkvFile['tracks'] = [videoTrack];
  if (audioOut) {
    const audioTrack: MkvAudioTrack = {
      trackNumber: AUDIO_TRACK,
      trackUid: 2n,
      trackType: 2,
      codecId: 'A_OPUS',
      codecPrivate: opusHead(audioChannels),
      samplingFrequency: OPUS_RATE,
      channels: audioChannels,
      webcodecsCodecString: 'opus',
    };
    tracks.push(audioTrack);
  }

  const file: MkvFile = {
    ebmlHeader: {
      ebmlVersion: 1,
      ebmlReadVersion: 1,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'matroska',
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    },
    segmentPayloadOffset: 0,
    info: {
      timecodeScale: WEBM_TIMECODE_SCALE,
      muxingApp: 'webcvt-transcode',
      writingApp: 'webcvt-transcode',
    },
    tracks,
    clusters: buildClusters(videoOut, audioOut) as MkvCluster[],
    chapters: [],
    tags: [],
    fileBytes: new Uint8Array(0),
  };
  return serializeMkv(file);
}

function opusHead(channels: number): Uint8Array {
  return buildOpusHead({
    channelCount: channels,
    preSkip: OPUS_PRE_SKIP,
    inputSampleRate: OPUS_RATE,
  });
}

// ---------------------------------------------------------------------------
// Monotone progress
// ---------------------------------------------------------------------------

function monotone(
  onProgress: ((percent: number, phase: string) => void) | undefined,
): (percent: number, phase: string) => void {
  let last = 0;
  return (percent, phase) => {
    const p = Math.max(last, Math.min(100, percent));
    last = p;
    onProgress?.(p, phase);
  };
}
