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
  WebCodecsNotSupportedError,
  probeAudioCodec,
  probeAudioDecoder,
} from '@catlabtech/webcvt-codec-webcodecs';

export interface ProbeHints {
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
}

/**
 * Caches audio decode/encode capability probes for one backend instance
 * (== one session). Not shared across instances so tests stay isolated.
 */
export class ProbeCache {
  readonly #decode = new Map<string, boolean>();
  readonly #encode = new Map<string, boolean>();

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
