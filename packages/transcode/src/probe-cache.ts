/**
 * Per-session memoisation of WebCodecs `isConfigSupported` probes.
 *
 * `canHandle` runs for every registry lookup, so an uncached backend would fire
 * an `isConfigSupported` round-trip on each call. Codec support does not change
 * within a session, so results are cached forever (keyed by codec token +
 * direction). A `WebCodecsNotSupportedError` — the signal for a runtime with no
 * WebCodecs (Node, Safari < 26 for audio) — is caught and cached as `false`, so
 * the backend falls through to ffmpeg-wasm cleanly instead of throwing.
 */

import {
  type AudioCodecName,
  type ProbeResult,
  type VideoCodecName,
  WebCodecsNotSupportedError,
  probeAudioCodec,
  probeAudioDecoder,
  probeVideoCodec,
  probeVideoDecoder,
} from '@catlabtech/webcvt-codec-webcodecs';

export interface ProbeHints {
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
}

export interface VideoProbeHints {
  readonly width?: number;
  readonly height?: number;
  readonly bitrate?: number;
  readonly framerate?: number;
  readonly hardwareAcceleration?: HardwareAcceleration;
}

/**
 * Caches audio decode/encode capability probes for one backend instance
 * (== one session). Not shared across instances so tests stay isolated.
 */
export class ProbeCache {
  readonly #decode = new Map<string, boolean>();
  readonly #encode = new Map<string, boolean>();
  readonly #videoDecode = new Map<string, boolean>();
  readonly #videoEncode = new Map<string, ProbeResult | null>();

  /** True iff the current runtime can DECODE `codec`. Memoised. */
  async canDecode(codec: AudioCodecName, hints: ProbeHints = {}): Promise<boolean> {
    const cached = this.#decode.get(codec);
    if (cached !== undefined) return cached;
    const ok = await probeSafely(() => probeAudioDecoder({ codec, ...hints }));
    this.#decode.set(codec, ok);
    return ok;
  }

  /** True iff the current runtime can ENCODE `codec` (probeAudioCodec). Memoised. */
  async canEncode(codec: AudioCodecName, hints: ProbeHints = {}): Promise<boolean> {
    const cached = this.#encode.get(codec);
    if (cached !== undefined) return cached;
    const ok = await probeSafely(() => probeAudioCodec({ codec, ...hints }));
    this.#encode.set(codec, ok);
    return ok;
  }

  /** True iff the current runtime can DECODE video `codec`. Memoised. */
  async canDecodeVideo(codec: VideoCodecName): Promise<boolean> {
    const cached = this.#videoDecode.get(codec);
    if (cached !== undefined) return cached;
    const ok = await probeSafely(() => probeVideoDecoder({ codec }));
    this.#videoDecode.set(codec, ok);
    return ok;
  }

  /**
   * Full encode probe for a video `codec` at the given geometry — returns the
   * {@link ProbeResult} (with `hardwareAccelerated`) or `null` when unsupported
   * / no WebCodecs. Memoised by codec + geometry so `canHandle` (default dims)
   * and the pipeline (real dims) each cache their own lookup.
   */
  async probeEncodeVideo(
    codec: VideoCodecName,
    hints: VideoProbeHints = {},
  ): Promise<ProbeResult | null> {
    const key = `${codec}:${hints.width ?? 0}x${hints.height ?? 0}`;
    const cached = this.#videoEncode.get(key);
    if (cached !== undefined) return cached;
    let result: ProbeResult | null;
    try {
      const r = await probeVideoCodec({ codec, ...hints });
      result = r.supported ? r : null;
    } catch (err) {
      if (err instanceof WebCodecsNotSupportedError) result = null;
      else throw err;
    }
    this.#videoEncode.set(key, result);
    return result;
  }

  /** True iff the current runtime can ENCODE video `codec`. Memoised. */
  async canEncodeVideo(codec: VideoCodecName, hints: VideoProbeHints = {}): Promise<boolean> {
    return (await this.probeEncodeVideo(codec, hints)) !== null;
  }
}

async function probeSafely(run: () => Promise<{ supported: boolean }>): Promise<boolean> {
  try {
    const result = await run();
    return result.supported;
  } catch (err) {
    if (err instanceof WebCodecsNotSupportedError) return false;
    throw err;
  }
}
