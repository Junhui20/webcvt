/**
 * TsBackend — webcvt Backend implementation for the MPEG-TS container.
 *
 * First-pass capability:
 * - canHandle: video/mp2t → video/mp2t identity round-trip ONLY.
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (semantic round-trip).
 *
 * Identity-only gate: a cross-MIME relabel would lie about the codec without
 * re-encoding. Lesson 1 from 4-of-7 prior container reviews — only exact
 * input.mime === output.mime passes canHandle.
 *
 * Encode requests for newly-encoded content are Phase 3.5+ work; they return
 * false from canHandle so the BackendRegistry routes to backend-wasm.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { RoundTripBackend } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, TS_MIME } from './constants.ts';
import { TsEncodeNotImplementedError, TsInputTooLargeError } from './errors.ts';
import { parseTs } from './parser.ts';
import { serializeTs } from './serializer.ts';

// ---------------------------------------------------------------------------
// TsBackend
// ---------------------------------------------------------------------------

const TS_MIMES = new Set([TS_MIME]);

export class TsBackend extends RoundTripBackend<ReturnType<typeof parseTs>> {
  constructor() {
    super({
      name: 'container-ts',
      mimes: TS_MIMES,
      canHandleMode: 'strict-identity',
      sizeGuard: {
        maxBytes: MAX_INPUT_BYTES,
        error: (size, max) => new TsInputTooLargeError(size, max),
      },
      parse: parseTs,
      serialize: serializeTs,
      encodeNotImplemented: (output) =>
        new TsEncodeNotImplementedError(
          `output MIME "${output.mime}" is not supported; only TS identity round-trip is implemented`,
        ),
      demuxStep: { percent: 5, phase: 'demux' },
      serializeStep: { percent: 50, phase: 'mux' },
    });
  }
}

// ---------------------------------------------------------------------------
// Format descriptor
// ---------------------------------------------------------------------------

export const TS_FORMAT: FormatDescriptor = {
  ext: 'ts',
  mime: TS_MIME,
  category: 'video',
  description: 'MPEG-2 Transport Stream (H.264 + AAC ADTS)',
};
