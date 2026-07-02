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

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, MKV_MIMES } from './constants.ts';
import { MkvEncodeNotImplementedError, MkvInputTooLargeError } from './errors.ts';
import { parseMkv } from './parser.ts';
import { serializeMkv } from './serializer.ts';

// ---------------------------------------------------------------------------
// MkvBackend
// ---------------------------------------------------------------------------

export class MkvBackend extends RoundTripBackend<ReturnType<typeof parseMkv>> {
  constructor() {
    super({
      name: 'container-mkv',
      mimes: MKV_MIMES,
      // Identity-only: both must be in the MKV MIME set AND must be equal.
      canHandleMode: 'strict-identity',
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new MkvInputTooLargeError(size, max),
      },
      parse: parseMkv,
      serialize: serializeMkv,
      encodeNotImplemented: (output) =>
        new MkvEncodeNotImplementedError(
          `output MIME "${output.mime}" is not supported; only MKV identity round-trip is implemented`,
        ),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'mux' },
    });
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
