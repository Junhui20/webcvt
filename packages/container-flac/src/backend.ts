/**
 * FlacBackend — webcvt Backend implementation for the FLAC container.
 *
 * Phase 1 capability:
 * - canHandle: FLAC input → FLAC output only (identity round-trip; see design note §Phase-1)
 * - canHandle: FLAC output (encode) → returns false (routed to backend-wasm via registry)
 * - convert (identity): parse → re-serialize (lossless round-trip)
 * - convert (non-identity): throws FlacEncodeNotImplementedError
 *
 * WebCodecs encode note:
 * FLAC is not a WebCodecs encode target as of 2026. Encode is delegated to
 * @webcvt/backend-wasm (libFLAC via ffmpeg.wasm) through the core BackendRegistry
 * fallback chain. Do NOT import backend-wasm here — the wiring happens in core.
 *
 * Phase 2 TODO:
 * - Submit FlacFrame.data as EncodedAudioChunk to WebCodecsAudioDecoder.
 * - Streaming frame iteration.
 * - Widen canHandle to output.category === 'audio' once WebCodecs decode is wired.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import { MAX_INPUT_BYTES } from './constants.ts';
import { FlacEncodeNotImplementedError, FlacInputTooLargeError } from './errors.ts';
import { parseFlac } from './parser.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MIME = 'audio/flac';
const FLAC_MIMES = new Set([FLAC_MIME, 'audio/x-flac']);

// ---------------------------------------------------------------------------
// FlacBackend
// ---------------------------------------------------------------------------

/**
 * Backend that decodes FLAC files via the container parser (Phase 1).
 *
 * In Phase 1, the `convert` method:
 * - For FLAC→FLAC (identity): parse and re-serialize (lossless round-trip).
 * - For FLAC→other audio: throws FlacEncodeNotImplementedError (WebCodecs
 *   decode path will be wired in Phase 2).
 */
export class FlacBackend implements Backend {
  readonly name = 'container-flac';

  /**
   * Phase 1: identity only (FLAC → FLAC).
   *
   * Returns true when both input AND output are FLAC MIME types.
   * Decode-to-other-audio (FLAC → WAV etc.) is deferred to Phase 2 once the
   * WebCodecs decode path is wired. Encode-to-FLAC from a non-FLAC input is
   * handled by @webcvt/backend-wasm (design note §Phase-1).
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (!FLAC_MIMES.has(input.mime)) return false;
    // Phase 1: identity only. Decode path to non-FLAC formats deferred to Phase 2.
    return FLAC_MIMES.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new FlacInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const flacFile = parseFlac(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'decode' });

    // Identity / round-trip path (FLAC → FLAC)
    if (FLAC_MIMES.has(output.mime)) {
      const { serializeFlac } = await import('./serializer.ts');
      const outputBytes = serializeFlac(flacFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: FLAC_MIME });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Phase 1: non-FLAC output not yet implemented
    throw new FlacEncodeNotImplementedError();
  }
}

// ---------------------------------------------------------------------------
// FLAC format descriptor
// ---------------------------------------------------------------------------

export const FLAC_FORMAT: FormatDescriptor = {
  ext: 'flac',
  mime: FLAC_MIME,
  category: 'audio',
  description: 'Free Lossless Audio Codec',
};
