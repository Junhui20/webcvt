/**
 * MkvBackend — webcvt Backend implementation for the Matroska container.
 *
 * First-pass capability:
 * - canHandle: video/x-matroska → video/x-matroska identity round-trip.
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (lossless round-trip).
 *
 * Identity-only gate: a cross-MIME relabel would lie about the codec without
 * re-encoding. This is the recurring 4-of-6 lesson from prior container reviews —
 * only exact input.mime === output.mime passes canHandle.
 *
 * Routing note: detect.ts returns FormatDescriptor for 'webm' (video/webm) for any
 * EBML-headed file, including .mkv files. When BackendRegistry.findBackend is asked
 * for a backend for 'video/webm', it tries container-webm first (DocType match via
 * canHandle) then falls back to container-mkv. The actual routing contract is enforced
 * by parseMkv rejecting DocType="webm" with MkvDocTypeNotSupportedError.
 * This backend does NOT modify detect.ts — the backend-layer handles routing.
 *
 * Do NOT import backend-wasm directly; let the BackendRegistry fallback handle it.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, MKV_MIMES } from './constants.ts';
import { MkvEncodeNotImplementedError, MkvInputTooLargeError } from './errors.ts';
import { parseMkv } from './parser.ts';
import { serializeMkv } from './serializer.ts';

// ---------------------------------------------------------------------------
// MkvBackend
// ---------------------------------------------------------------------------

export class MkvBackend implements Backend {
  readonly name = 'container-mkv';

  /**
   * Identity-only canHandle (first pass).
   *
   * Returns true ONLY when both input AND output are the SAME MKV MIME type
   * (video/x-matroska → video/x-matroska).
   *
   * Cross-MIME relabels return false so the BackendRegistry can route to a
   * codec-capable backend. This is the identity-only pattern that avoids the
   * 4-of-6 recurring canHandle issue from prior container reviews.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return MKV_MIMES.has(input.mime) && input.mime === output.mime;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new MkvInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const mkvFile = parseMkv(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'mux' });

    // Identity / round-trip path.
    if (MKV_MIMES.has(output.mime)) {
      const outputBytes = serializeMkv(mkvFile);
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

    throw new MkvEncodeNotImplementedError(
      `output MIME "${output.mime}" is not supported; only MKV identity round-trip is implemented`,
    );
  }
}

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

export const MKV_FORMAT: FormatDescriptor = {
  ext: 'mkv',
  mime: 'video/x-matroska',
  category: 'video',
  description: 'Matroska container (H.264/HEVC/VP8/VP9, AAC/MP3/FLAC/Vorbis/Opus)',
};
