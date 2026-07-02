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
 * The identity-only MIME set (audio/aac only) keeps HE-AAC MIMEs — audio/aacp,
 * audio/x-aac — out of canHandle so they fall through to backend-wasm.
 *
 * Phase 2 TODO:
 * - Submit AdtsFrame.data (stripped of ADTS header) as EncodedAudioChunk to
 *   WebCodecsAudioDecoder with description=buildAudioSpecificConfig(firstFrame.header).
 * - Streaming frame iteration.
 * - Widen canHandle to output.category === 'audio' once WebCodecs decode is wired.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
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
 * Identity only (both input and output must be ADTS-AAC); AAC→other audio
 * throws AdtsEncodeNotImplementedError, and encode-to-AAC from other inputs is
 * handled by @catlabtech/webcvt-backend-wasm through the registry fallback chain.
 */
export class AacBackend extends RoundTripBackend<ReturnType<typeof parseAdts>> {
  constructor() {
    super({
      name: 'container-aac',
      mimes: AAC_MIMES,
      outputMime: AAC_MIME,
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new AdtsInputTooLargeError(size, max),
      },
      parse: parseAdts,
      serialize: serializeAdts,
      encodeNotImplemented: () => new AdtsEncodeNotImplementedError(),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'decode' },
    });
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
