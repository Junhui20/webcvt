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
 * @catlabtech/webcvt-backend-wasm (libFLAC via ffmpeg.wasm) through the core BackendRegistry
 * fallback chain. Do NOT import backend-wasm here — the wiring happens in core.
 *
 * Phase 2 TODO:
 * - Submit FlacFrame.data as EncodedAudioChunk to WebCodecsAudioDecoder.
 * - Streaming frame iteration.
 * - Widen canHandle to output.category === 'audio' once WebCodecs decode is wired.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
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
 * Backend that round-trips FLAC files via the container parser (Phase 1).
 *
 * Identity only (FLAC → FLAC): decode-to-other-audio is deferred to Phase 2,
 * and encode-to-FLAC from a non-FLAC input is handled by
 * @catlabtech/webcvt-backend-wasm through the registry fallback chain.
 */
export class FlacBackend extends RoundTripBackend<ReturnType<typeof parseFlac>> {
  constructor() {
    super({
      name: 'container-flac',
      mimes: FLAC_MIMES,
      outputMime: FLAC_MIME,
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new FlacInputTooLargeError(size, max),
      },
      parse: parseFlac,
      // Serializer is lazily imported to keep the decode-only path lean.
      serialize: async (flacFile) => {
        const { serializeFlac } = await import('./serializer.ts');
        return serializeFlac(flacFile);
      },
      encodeNotImplemented: () => new FlacEncodeNotImplementedError(),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'decode' },
    });
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
