/**
 * Mp3Backend — webcvt Backend implementation for the MP3 container.
 *
 * Phase 1 capability:
 * - canHandle: MP3 input → any audio output (decode via WebCodecs)
 * - convert (identity path): parse frames → re-serialize MP3
 * - convert (encode path): throws Mp3EncodeNotImplementedError
 *
 * Phase 2 TODO:
 * - Encode path via lamejs (browser MP3 encoder)
 * - Streaming frame iteration
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { InputTooLargeError, RoundTripBackend } from '@catlabtech/webcvt-core';
import { Mp3EncodeNotImplementedError } from './errors.ts';
import { parseMp3 } from './parser.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MP3_MIME = 'audio/mpeg';
const MP3_MIMES = new Set([MP3_MIME, 'audio/mp3', 'audio/x-mpeg']);

/** Maximum allowed input size. Prevents OOM from pathologically large inputs. */
const MAX_INPUT_BYTES = 200 * 1024 * 1024; // 200 MiB

// ---------------------------------------------------------------------------
// Mp3Backend
// ---------------------------------------------------------------------------

/**
 * Backend that round-trips MP3 files (identity only).
 *
 * canHandle is identity-set: MP3 input → MP3 output only. The decode path
 * (mp3 → wav/opus/…) is now owned by the WebCodecs transcode backend
 * (`@catlabtech/webcvt-transcode`, priority 0), so this container no longer
 * over-claims `mp3 → any-audio` — that previously made canHandle return true
 * for pairs it could not convert (they threw in `convert`), which would shadow
 * the real decode backend at equal priority depending on registration order.
 */
export class Mp3Backend extends RoundTripBackend<ReturnType<typeof parseMp3>> {
  constructor() {
    super({
      name: 'container-mp3',
      mimes: MP3_MIMES,
      // Identity-only: MP3 → MP3. Cross-format decode routes to the transcode
      // backend (default 'identity-set' mode: output must be an MP3 MIME).
      // Identity round-trip always emits the canonical audio/mpeg MIME.
      outputMime: MP3_MIME,
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new InputTooLargeError('MP3', 'MP3', size, max),
      },
      parse: parseMp3,
      // Serializer is lazily imported to keep the decode-only path lean.
      serialize: async (mp3File) => {
        const { serializeMp3 } = await import('./serializer.ts');
        return serializeMp3(mp3File);
      },
      encodeNotImplemented: () => new Mp3EncodeNotImplementedError(),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'decode' },
    });
  }
}

// ---------------------------------------------------------------------------
// MP3 format descriptor
// ---------------------------------------------------------------------------

export const MP3_FORMAT: FormatDescriptor = {
  ext: 'mp3',
  mime: MP3_MIME,
  category: 'audio',
  description: 'MPEG-1/2 Audio Layer III',
};
