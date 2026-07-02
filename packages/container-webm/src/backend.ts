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
 *
 * Do NOT import backend-wasm directly; let the BackendRegistry fallback handle it.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, WEBM_MIMES } from './constants.ts';
import { WebmEncodeNotImplementedError, WebmInputTooLargeError } from './errors.ts';
import { parseWebm } from './parser.ts';
import { serializeWebm } from './serializer.ts';

// ---------------------------------------------------------------------------
// WebmBackend
// ---------------------------------------------------------------------------

export class WebmBackend extends RoundTripBackend<ReturnType<typeof parseWebm>> {
  constructor() {
    super({
      name: 'container-webm',
      mimes: WEBM_MIMES,
      // Identity-only: both must be in the WebM MIME set AND must be equal, so
      // a video/webm → audio/webm relabel routes to a codec-capable backend.
      canHandleMode: 'strict-identity',
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new WebmInputTooLargeError(size, max),
      },
      parse: parseWebm,
      serialize: serializeWebm,
      encodeNotImplemented: (output) =>
        new WebmEncodeNotImplementedError(
          `output MIME "${output.mime}" is not supported; only WebM identity round-trip is implemented`,
        ),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'mux' },
    });
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
