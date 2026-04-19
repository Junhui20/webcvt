/**
 * Mp4Backend — webcvt Backend implementation for the MP4/M4A container.
 *
 * Phase 3 capability:
 * - canHandle: audio/mp4 (M4A) → audio/mp4 identity round-trip only.
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (lossless round-trip).
 * - convert (encode): throws Mp4EncodeNotImplementedError (route to wasm).
 *
 * Identity-only gate: a cross-MIME relabel (e.g. video/mp4 → audio/mp4) would
 * lie about the codec without re-encoding. Lesson repeated from
 * container-flac/container-aac/container-ogg reviews — only exact
 * mime === mime passes canHandle. (4-for-4 recurring lesson.)
 *
 * Do NOT import backend-wasm directly; let the BackendRegistry fallback chain handle it.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import { MAX_INPUT_BYTES } from './constants.ts';
import { Mp4EncodeNotImplementedError, Mp4InputTooLargeError } from './errors.ts';
import { parseMp4 } from './parser.ts';
import { serializeMp4 } from './serializer.ts';

// ---------------------------------------------------------------------------
// MIME type registry
// ---------------------------------------------------------------------------

// Identity-only gate — only exact input.mime === output.mime passes.
// Cross-MIME relabels (video/mp4 → audio/mp4) return false to route to wasm.
// Per the recurring 4-for-4 lesson from container-flac/aac/ogg reviews.
const M4A_MIMES = new Set(['audio/mp4']);

// ---------------------------------------------------------------------------
// Mp4Backend
// ---------------------------------------------------------------------------

export class Mp4Backend implements Backend {
  readonly name = 'container-mp4';

  /**
   * Phase 3: identity only (audio/mp4 → audio/mp4).
   *
   * Returns true when both input AND output are the same M4A MIME type.
   * Any cross-format conversion routes to backend-wasm.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Identity-only per the recurring lesson from container-flac/container-aac/container-ogg reviews.
    return M4A_MIMES.has(input.mime) && input.mime === output.mime;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new Mp4InputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const mp4File = parseMp4(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'mux' });

    // Identity / round-trip path (audio/mp4 → audio/mp4).
    if (M4A_MIMES.has(output.mime)) {
      const outputBytes = serializeMp4(mp4File);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Non-M4A output is not implemented in Phase 3.
    throw new Mp4EncodeNotImplementedError();
  }
}

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

export const M4A_FORMAT: FormatDescriptor = {
  ext: 'm4a',
  mime: 'audio/mp4',
  category: 'audio',
  description: 'MP4 audio (AAC-in-M4A)',
};
