/**
 * WavBackend — webcvt Backend implementation for WAV container.
 *
 * Decode: parse WAV → return raw PCM as Blob (audio/wav pass-through for now;
 *   full WebCodecs integration with codec-webcodecs is deferred to Phase 2).
 *
 * Encode: requires AudioData input from codec-webcodecs (Phase 2).
 *   Stub throws WavEncodeNotImplementedError until that package is available.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
import { WavEncodeNotImplementedError } from './errors.ts';
import { parseWav } from './parser.ts';
import { serializeWav } from './serializer.ts';

// ---------------------------------------------------------------------------
// Supported MIME types
// ---------------------------------------------------------------------------

const WAV_MIME = 'audio/wav';
const WAV_MIMES = new Set([WAV_MIME, 'audio/wave', 'audio/x-wav']);

// ---------------------------------------------------------------------------
// WavBackend
// ---------------------------------------------------------------------------

/**
 * Backend that handles WAV ↔ WAV pass-through (decode/re-serialize) and
 * provides PCM sample access for downstream codec packages.
 *
 * Phase 1 capability:
 * - canHandle: WAV input → WAV output only (identity / re-pack)
 * - convert: parse + re-serialize (round-trip); useful for normalization
 *
 * Phase 2 TODO:
 * - Decode to WebCodecs AudioData via codec-webcodecs
 * - Encode from AudioData to WAV (PCM mux)
 * - Expose per-frame iteration for streaming decode
 */
export class WavBackend extends RoundTripBackend<ReturnType<typeof parseWav>> {
  constructor() {
    super({
      name: 'container-wav',
      mimes: WAV_MIMES,
      // Blob is always the canonical audio/wav MIME regardless of the wave/x-wav alias.
      outputMime: WAV_MIME,
      parse: parseWav,
      serialize: serializeWav,
      encodeNotImplemented: () => new WavEncodeNotImplementedError(),
      // WAV has no input-size cap in Phase 1 (no OOM-prone streaming parse).
      demuxStep: { percent: 10, phase: 'demux' },
      serializeStep: { percent: 60, phase: 'mux' },
    });
  }
}

// ---------------------------------------------------------------------------
// WAV format descriptor
// ---------------------------------------------------------------------------

export const WAV_FORMAT: FormatDescriptor = {
  ext: 'wav',
  mime: WAV_MIME,
  category: 'audio',
  description: 'Waveform Audio File Format (RIFF/WAV)',
};
