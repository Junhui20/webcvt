/**
 * WavBackend — webcvt Backend implementation for WAV container.
 *
 * Decode: parse WAV → return raw PCM as Blob (audio/wav pass-through for now;
 *   full WebCodecs integration with codec-webcodecs is deferred to Phase 2).
 *
 * Encode: requires AudioData input from codec-webcodecs (Phase 2).
 *   Stub throws NotImplementedError until that package is available.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { WebcvtError } from '@catlabtech/webcvt-core';
import { parseWav } from './parser.ts';
import { serializeWav } from './serializer.ts';

// ---------------------------------------------------------------------------
// Supported MIME types
// ---------------------------------------------------------------------------

const WAV_MIME = 'audio/wav';
const WAV_MIMES = new Set([WAV_MIME, 'audio/wave', 'audio/x-wav']);

// ---------------------------------------------------------------------------
// Error: encode not yet implemented
// ---------------------------------------------------------------------------

/**
 * Thrown when WAV encoding is requested before codec-webcodecs integration.
 * TODO Phase 2: remove once AudioData muxing is implemented.
 */
class WavEncodeNotImplementedError extends WebcvtError {
  constructor() {
    super(
      'WAV_ENCODE_NOT_IMPLEMENTED',
      'WAV encoding requires AudioData from @catlabtech/webcvt-codec-webcodecs, which is not yet available. ' +
        'This will be implemented in Phase 2.',
    );
    this.name = 'WavEncodeNotImplementedError';
  }
}

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
export class WavBackend implements Backend {
  readonly name = 'container-wav';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return WAV_MIMES.has(input.mime) && WAV_MIMES.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (!WAV_MIMES.has(output.mime)) {
      // TODO Phase 2: route to codec-webcodecs for transcode to other formats
      throw new WavEncodeNotImplementedError();
    }

    options.onProgress?.({ percent: 10, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const wavFile = parseWav(inputBytes);

    options.onProgress?.({ percent: 60, phase: 'mux' });

    const outputBytes = serializeWav(wavFile);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: WAV_MIME });

    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
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
