/**
 * TranscodeBackend — the WebCodecs-first audio transcode backend.
 *
 * `canHandle` is two-stage + cached: (1) the static {@link TRANSCODE_MATRIX}
 * gate rejects off-matrix pairs in O(1) with no probing; (2) both-sided
 * concrete codec probes (`probeAudioDecoder` for the input, `probeAudioCodec`
 * for the output) confirm the runtime actually supports the pair — this is what
 * makes Safari-audio and no-WebCodecs runtimes fall through to ffmpeg-wasm.
 * Probe results are memoised per session.
 *
 * `convert` runs the four-phase pipeline demux → decode → encode → mux, enforces
 * the input cap first, honours `options.signal`, and closes codecs on exit.
 */

import type { AudioCodecName } from '@catlabtech/webcvt-codec-webcodecs';
import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { throwIfAborted } from './abort.ts';
import { decodeToPcm } from './decode.ts';
import { demuxAudio, demuxContainerAudio } from './demux.ts';
import {
  type EncodeContext,
  encodeAac,
  encodeFlac,
  encodeOpusOgg,
  encodeOpusWebm,
  encodeWav,
} from './encode.ts';
import { TranscodeInputTooLargeError, TranscodeUnsupportedError } from './errors.ts';
import {
  CONTAINER_AUDIO_CODEC,
  CONTAINER_VIDEO_CODEC,
  type ContainerFamily,
  MAX_INPUT_BYTES,
  type OutputTarget,
  type SideCodec,
  TRANSCODE_MATRIX,
  type VideoTarget,
  containerFamilyFor,
  inputCodecFor,
  matrixKey,
  outputTargetFor,
  resolveBitrate,
  videoTargetFor,
} from './matrix.ts';
import type { DecodedAudio } from './pcm.ts';
import { ProbeCache } from './probe-cache.ts';
import { transcodeVideo } from './video.ts';

const DEFAULT_QUALITY = 0.7;

export class TranscodeBackend implements Backend {
  readonly name = 'webcodecs-transcode';
  readonly priority = 0;

  readonly #probes = new ProbeCache();

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Audio-only matrix (wav/mp3/aac/flac/ogg → wav/opus/webm/aac/flac).
    if (TRANSCODE_MATRIX.has(matrixKey(input.mime, output.mime))) {
      return this.#canHandleAudioMatrix(input.mime, output.mime);
    }
    // Container inputs (mp4/m4a/webm/mkv): video transcode OR audio-track
    // extraction into the audio matrix. Kept separate so the frozen audio
    // matrix (and `inputCodecFor('video/mp4')`) stays unchanged.
    const family = containerFamilyFor(input.mime);
    if (family) return this.#canHandleContainer(family, input, output);
    return false;
  }

  /** Stage-2 both-sided probe for the frozen audio matrix. */
  async #canHandleAudioMatrix(inputMime: string, outputMime: string): Promise<boolean> {
    const inputCodec = inputCodecFor(inputMime);
    const target = outputTargetFor(outputMime);
    if (!inputCodec || !target) return false;

    // A pcm side (wav) needs no codec — skip it.
    if (inputCodec !== 'pcm') {
      if (!(await this.#probes.canDecode(asAudioCodec(inputCodec)))) return false;
    }
    if (target.codec !== 'pcm') {
      if (!(await this.#probes.canEncode(asAudioCodec(target.codec)))) return false;
    }
    return true;
  }

  /** Container input: gate a video-target or an audio-track-extraction pair. */
  async #canHandleContainer(
    family: ContainerFamily,
    input: FormatDescriptor,
    output: FormatDescriptor,
  ): Promise<boolean> {
    // Video output → transcode the container's video track. Requires a
    // video-bearing input (m4a / audio-only containers cannot supply video).
    const videoTarget = videoTargetFor(output.mime);
    if (videoTarget && input.category === 'video') {
      if (!(await this.#probes.canDecodeVideo(CONTAINER_VIDEO_CODEC[family]))) return false;
      const canVp9 = await this.#probes.canEncodeVideo('vp9');
      const canVp8 = canVp9 || (await this.#probes.canEncodeVideo('vp8'));
      return canVp9 || canVp8;
    }

    // Audio output → extract the container's audio track into the audio matrix.
    const target = outputTargetFor(output.mime);
    if (target && output.mime !== input.mime) {
      if (!(await this.#probes.canDecode(CONTAINER_AUDIO_CODEC[family]))) return false;
      if (target.codec !== 'pcm') {
        if (!(await this.#probes.canEncode(asAudioCodec(target.codec)))) return false;
      }
      return true;
    }
    return false;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    // Input cap FIRST — reject before touching the bytes so a hostile `.size`
    // never triggers an allocation.
    if (input.size > MAX_INPUT_BYTES) {
      throw new TranscodeInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    const signal = options.signal;
    throwIfAborted(signal);

    // Backends dispatch on Blob.type (core re-types the blob to the resolved
    // input MIME before calling convert). Fall back to options.inputFormat.
    const inputMime = resolveInputMime(input, options);

    // 1. Audio-only matrix (wav/mp3/aac/flac/ogg audio).
    const inputCodec = inputCodecFor(inputMime);
    const target = outputTargetFor(output.mime);
    if (inputCodec && target && TRANSCODE_MATRIX.has(matrixKey(inputMime, output.mime))) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      const outputBytes = await this.#runAudio(demuxAudio(inputCodec, bytes), target, options);
      return this.#audioResult(outputBytes, output, startMs);
    }

    // 2. Container inputs (mp4/m4a/webm/mkv).
    const family = containerFamilyFor(inputMime);
    if (family) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      const videoTarget = videoTargetFor(output.mime);
      if (videoTarget && output.category === 'video') {
        return this.#convertVideo(family, videoTarget, bytes, output, options, startMs);
      }
      if (target) {
        const outputBytes = await this.#runAudio(
          demuxContainerAudio(family, bytes),
          target,
          options,
        );
        return this.#audioResult(outputBytes, output, startMs);
      }
    }

    throw new TranscodeUnsupportedError(inputMime, output.mime);
  }

  /** Shared audio demux→decode→encode→mux for both audio-matrix and container-audio. */
  async #runAudio(
    demux: ReturnType<typeof demuxAudio>,
    target: OutputTarget,
    options: ConvertOptions,
  ): Promise<Uint8Array> {
    const signal = options.signal;
    const report = (percent: number, phase: string): void =>
      options.onProgress?.({ percent, phase });

    report(10, 'demux');
    throwIfAborted(signal);

    // Decode (10 → 45%).
    const decoded = await decodeToPcm(demux, {
      signal,
      onProgress: (f) => report(10 + f * 35, 'decode'),
    });
    report(45, 'decode');
    throwIfAborted(signal);

    // Encode (45 → 90%) then mux, folded into the sink.
    const quality = options.quality ?? DEFAULT_QUALITY;
    const bitrate = resolveBitrate(target.codec, quality, decoded.numberOfChannels);
    const encodeCtx: EncodeContext = {
      signal,
      onProgress: (f) => report(45 + f * 45, 'encode'),
    };
    const outputBytes = await runSink(target, decoded, { bitrate }, encodeCtx);
    report(90, 'mux');
    throwIfAborted(signal);
    report(100, 'done');
    return outputBytes;
  }

  #audioResult(outputBytes: Uint8Array, output: FormatDescriptor, startMs: number): ConvertResult {
    return {
      blob: new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime }),
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false, // audio decode/encode is always software today.
    };
  }

  /** Video transcode dispatch (mp4/webm/mkv → webm/mkv, VP9|VP8 + Opus). */
  async #convertVideo(
    family: ContainerFamily,
    videoTarget: VideoTarget,
    bytes: Uint8Array,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const result = await transcodeVideo(family, videoTarget.container, bytes, this.#probes, {
      quality: options.quality ?? DEFAULT_QUALITY,
      signal: options.signal,
      ...(options.hardwareAcceleration
        ? { hardwareAcceleration: mapHwAccel(options.hardwareAcceleration) }
        : {}),
      onProgress: (percent, phase) => options.onProgress?.({ percent, phase }),
    });

    // Video-only fallback surface: when the source had audio we could not
    // transcode (Safari-style video-only WebCodecs, or a non-decodable audio
    // codec), the output is video-only. There is no ConvertResult field for
    // this by design — it is surfaced via a console warning + the docs/report.
    if (!result.audioIncluded) {
      console.warn(
        '[webcvt-transcode] emitted a VIDEO-ONLY output: the source audio track could not be ' +
          'transcoded (no WebCodecs AudioDecoder/AudioEncoder, or an unsupported audio codec).',
      );
    }

    return {
      blob: new Blob([result.bytes.buffer as ArrayBuffer], { type: output.mime }),
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: result.hardwareAccelerated,
    };
  }
}

/**
 * Construct a TranscodeBackend and register it with the given registry (or
 * core's `defaultRegistry` when omitted). Returns the backend so the caller can
 * later `registry.unregister('webcodecs-transcode')`. Nothing registers on
 * import — call this explicitly.
 */
export function registerTranscodeBackend(
  registry: BackendRegistry = defaultRegistry,
): TranscodeBackend {
  const backend = new TranscodeBackend();
  registry.register(backend);
  return backend;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runSink(
  target: OutputTarget,
  decoded: DecodedAudio,
  opts: { bitrate?: number },
  ctx: EncodeContext,
): Promise<Uint8Array> | Uint8Array {
  switch (target.container) {
    case 'wav':
      return encodeWav(decoded);
    case 'ogg':
      return encodeOpusOgg(decoded, opts, ctx);
    case 'webm':
      return encodeOpusWebm(decoded, opts, ctx);
    case 'aac':
      return encodeAac(decoded, opts, ctx);
    case 'flac':
      return encodeFlac(decoded, opts, ctx);
    default:
      throw new TranscodeUnsupportedError('audio', target.container);
  }
}

function resolveInputMime(input: Blob, options: ConvertOptions): string {
  if (options.inputFormat !== undefined) {
    if (typeof options.inputFormat === 'string') {
      // Extension or MIME string — only MIME is meaningful for demuxer routing.
      if (options.inputFormat.includes('/')) return options.inputFormat;
    } else {
      return options.inputFormat.mime;
    }
  }
  return input.type;
}

/** SideCodec (non-pcm) → codec-webcodecs AudioCodecName. */
function asAudioCodec(codec: Exclude<SideCodec, 'pcm'>): AudioCodecName {
  return codec;
}

/** Core's `HardwareAcceleration` hint → the WebCodecs `hardwareAcceleration` enum. */
function mapHwAccel(
  pref: NonNullable<ConvertOptions['hardwareAcceleration']>,
): HardwareAcceleration {
  switch (pref) {
    case 'no':
      return 'prefer-software';
    case 'preferred':
    case 'required':
      return 'prefer-hardware';
    default:
      return 'no-preference';
  }
}
