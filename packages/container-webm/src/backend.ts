/**
 * WebmBackend — webcvt Backend implementation for the WebM container.
 *
 * First-pass capability:
 * - canHandle: video/webm → video/webm identity round-trip.
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (lossless round-trip).
 *
 * Identity-only gate: a cross-MIME relabel (e.g. audio/webm → video/webm)
 * would lie about the codec without re-encoding. This is the recurring
 * 4-for-4 lesson from container-flac/container-aac/container-ogg/container-mp4
 * reviews — only exact input.mime === output.mime passes canHandle.
 * Add a comment explaining identity-only per the lesson.
 *
 * Do NOT import backend-wasm directly; let the BackendRegistry fallback handle it.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import { MAX_INPUT_BYTES, WEBM_MIMES } from './constants.ts';
import { WebmEncodeNotImplementedError, WebmInputTooLargeError } from './errors.ts';
import { parseWebm } from './parser.ts';
import { serializeWebm } from './serializer.ts';

// ---------------------------------------------------------------------------
// WebmBackend
// ---------------------------------------------------------------------------

export class WebmBackend implements Backend {
  readonly name = 'container-webm';

  /**
   * Identity-only canHandle (first pass).
   *
   * Returns true ONLY when both input AND output are the SAME WebM MIME type
   * (video/webm → video/webm, or audio/webm → audio/webm).
   *
   * Cross-MIME relabels (e.g. video/webm → audio/webm) return false so the
   * BackendRegistry can route to a codec-capable backend. This is the
   * identity-only pattern that avoids the 4-of-4 recurring canHandle issue.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Identity-only: both must be in the WebM MIME set AND must be equal.
    return WEBM_MIMES.has(input.mime) && input.mime === output.mime;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new WebmInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const webmFile = parseWebm(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'mux' });

    // Identity / round-trip path (video/webm → video/webm or audio/webm → audio/webm).
    if (WEBM_MIMES.has(output.mime)) {
      const outputBytes = serializeWebm(webmFile);
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

    // Non-WebM output is not implemented in first pass.
    throw new WebmEncodeNotImplementedError(
      `output MIME "${output.mime}" is not supported; only WebM identity round-trip is implemented`,
    );
  }
}

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

export const WEBM_FORMAT: FormatDescriptor = {
  ext: 'webm',
  mime: 'video/webm',
  category: 'video',
  description: 'WebM video/audio container (VP8/VP9, Vorbis/Opus)',
};
