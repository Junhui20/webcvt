/**
 * AacBackend — webcvt Backend implementation for the AAC/ADTS container.
 *
 * Phase 1 capability:
 * - canHandle: ADTS-AAC input → ADTS-AAC output only (identity round-trip).
 * - canHandle: HE-AAC v1/v2 input → returns false (routes to backend-wasm via registry).
 * - canHandle: non-identity output → returns false.
 * - convert (identity): parse → re-serialize (lossless round-trip).
 * - convert (non-identity): throws AdtsEncodeNotImplementedError.
 *
 * HE-AAC note (design note Trap #7):
 * HE-AAC v1 (SBR, object_type=5) and HE-AAC v2 (PS, object_type=29) are
 * identified during parsing; those frames route to @catlabtech/webcvt-backend-wasm via
 * the core BackendRegistry fallback chain. Do NOT import backend-wasm here.
 *
 * Phase 2 TODO:
 * - Submit AdtsFrame.data (stripped of ADTS header) as EncodedAudioChunk to
 *   WebCodecsAudioDecoder with description=buildAudioSpecificConfig(firstFrame.header).
 * - Streaming frame iteration.
 * - Widen canHandle to output.category === 'audio' once WebCodecs decode is wired.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES } from './constants.ts';
import { AdtsEncodeNotImplementedError, AdtsInputTooLargeError } from './errors.ts';
import { parseAdts } from './parser.ts';
import { serializeAdts } from './serializer.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AAC_MIME = 'audio/aac';
// HE-AAC (audio/aacp, audio/x-aac) routes to @catlabtech/webcvt-backend-wasm via registry — design note Trap #7.
const AAC_MIMES = new Set([AAC_MIME]);

// ---------------------------------------------------------------------------
// AacBackend
// ---------------------------------------------------------------------------

/**
 * Backend that round-trips ADTS-AAC files via the container parser (Phase 1).
 *
 * In Phase 1, `convert`:
 * - For AAC→AAC (identity): parse and re-serialize (lossless round-trip).
 * - For AAC→other audio: throws AdtsEncodeNotImplementedError.
 */
export class AacBackend implements Backend {
  readonly name = 'container-aac';

  /**
   * Phase 1: identity only (ADTS-AAC → ADTS-AAC).
   *
   * Returns true only when both input AND output are ADTS-AAC MIME types.
   * HE-AAC (detected at parse time) routes to backend-wasm — canHandle cannot
   * pre-filter by object_type without inspecting the stream, so we accept the
   * MIME and let parseAdts surface any issues.
   *
   * Encode-to-AAC from non-AAC input is handled by @catlabtech/webcvt-backend-wasm
   * through the BackendRegistry fallback chain (design note §Phase-1).
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Phase 1: identity only — both input and output must be ADTS-AAC.
    // HE-AAC (audio/aacp, audio/x-aac) routes to @catlabtech/webcvt-backend-wasm — design note Trap #7.
    return input.mime === AAC_MIME && output.mime === AAC_MIME;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new AdtsInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const aacFile = parseAdts(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'decode' });

    // Identity / round-trip path (AAC → AAC)
    if (AAC_MIMES.has(output.mime)) {
      const outputBytes = serializeAdts(aacFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: AAC_MIME });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Phase 1: non-AAC output not yet implemented.
    throw new AdtsEncodeNotImplementedError();
  }
}

// ---------------------------------------------------------------------------
// AAC format descriptor
// ---------------------------------------------------------------------------

export const AAC_FORMAT: FormatDescriptor = {
  ext: 'aac',
  mime: AAC_MIME,
  category: 'audio',
  description: 'Advanced Audio Coding (ADTS)',
};
