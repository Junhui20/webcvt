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
import { demuxAudio } from './demux.ts';
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
  MAX_INPUT_BYTES,
  type OutputTarget,
  type SideCodec,
  TRANSCODE_MATRIX,
  inputCodecFor,
  matrixKey,
  outputTargetFor,
  resolveBitrate,
} from './matrix.ts';
import type { DecodedAudio } from './pcm.ts';
import { ProbeCache } from './probe-cache.ts';

const DEFAULT_QUALITY = 0.7;

export class TranscodeBackend implements Backend {
  readonly name = 'webcodecs-transcode';
  readonly priority = 0;

  readonly #probes = new ProbeCache();

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Stage 1: static matrix gate — cheap O(1) reject, no probing.
    if (!TRANSCODE_MATRIX.has(matrixKey(input.mime, output.mime))) return false;

    const inputCodec = inputCodecFor(input.mime);
    const target = outputTargetFor(output.mime);
    if (!inputCodec || !target) return false;

    // Stage 2: probe both sides. A pcm side (wav) needs no codec — skip it.
    if (inputCodec !== 'pcm') {
      if (!(await this.#probes.canDecode(asAudioCodec(inputCodec)))) return false;
    }
    if (target.codec !== 'pcm') {
      if (!(await this.#probes.canEncode(asAudioCodec(target.codec)))) return false;
    }
    return true;
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
    const inputCodec = inputCodecFor(inputMime);
    const target = outputTargetFor(output.mime);
    if (!inputCodec || !target || !TRANSCODE_MATRIX.has(matrixKey(inputMime, output.mime))) {
      throw new TranscodeUnsupportedError(inputMime, output.mime);
    }

    const report = (percent: number, phase: string): void =>
      options.onProgress?.({ percent, phase });

    // Phase 1: demux (0 → 10%).
    report(0, 'demux');
    const bytes = new Uint8Array(await input.arrayBuffer());
    const demux = demuxAudio(inputCodec, bytes);
    report(10, 'demux');
    throwIfAborted(signal);

    // Phase 2: decode (10 → 45%).
    const decoded = await decodeToPcm(demux, {
      signal,
      onProgress: (f) => report(10 + f * 35, 'decode'),
    });
    report(45, 'decode');
    throwIfAborted(signal);

    // Phase 3 + 4: encode (45 → 90%) then mux, folded into the sink.
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
    const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false, // audio decode/encode is always software today.
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
