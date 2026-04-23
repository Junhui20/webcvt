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

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, TS_MIME } from './constants.ts';
import { TsEncodeNotImplementedError, TsInputTooLargeError } from './errors.ts';
import { parseTs } from './parser.ts';
import { serializeTs } from './serializer.ts';

// ---------------------------------------------------------------------------
// TsBackend
// ---------------------------------------------------------------------------

export class TsBackend implements Backend {
  readonly name = 'container-ts';

  /**
   * Identity-only canHandle (first pass).
   *
   * Returns true ONLY when both input AND output are video/mp2t.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return input.mime === TS_MIME && output.mime === TS_MIME;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new TsInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const tsFile = parseTs(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'mux' });

    // Identity / round-trip path.
    if (output.mime === TS_MIME) {
      const outputBytes = serializeTs(tsFile);
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

    throw new TsEncodeNotImplementedError(
      `output MIME "${output.mime}" is not supported; only TS identity round-trip is implemented`,
    );
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
