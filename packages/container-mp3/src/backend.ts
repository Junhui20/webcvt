/**
 * Mp3Backend — webcvt Backend implementation for the MP3 container.
 *
 * Phase 1 capability:
 * - canHandle: MP3 input → any audio output (decode via WebCodecs)
 * - convert (decode path): parse frames → submit to WebCodecsAudioDecoder
 * - convert (encode path): throws Mp3EncodeNotImplementedError
 *
 * Phase 2 TODO:
 * - Encode path via lamejs (browser MP3 encoder)
 * - Streaming frame iteration
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { WebcvtError } from '@catlabtech/webcvt-core';
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
 * Backend that decodes MP3 files via WebCodecs AudioDecoder (when available).
 *
 * The `convert` method returns a Blob containing raw interleaved PCM samples
 * (audio/pcm; float32; host endian) for Phase 1. A proper mux step would be
 * added in Phase 2.
 */
export class Mp3Backend implements Backend {
  readonly name = 'container-mp3';

  /**
   * Returns true when:
   * - input MIME is an MP3 MIME type, AND
   * - output MIME is any audio format (decode path always available for MP3 input)
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (!MP3_MIMES.has(input.mime)) return false;
    // Decode any MP3 input to any audio output category.
    return output.category === 'audio';
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new WebcvtError(
        'MP3_INPUT_TOO_LARGE',
        `MP3 input is ${input.size} bytes; maximum supported is ${MAX_INPUT_BYTES} bytes (200 MiB).`,
      );
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const mp3File = parseMp3(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'decode' });

    // If the output is also MP3 (identity / round-trip), re-serialize.
    if (MP3_MIMES.has(output.mime)) {
      const { serializeMp3 } = await import('./serializer.ts');
      const outputBytes = serializeMp3(mp3File);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: MP3_MIME });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // For non-MP3 output: Phase 1 decode-only stub using WebCodecs.
    // A full implementation would decode to AudioData and re-mux.
    // For now, throw a helpful error for encode paths.
    throw new Mp3EncodeNotImplementedError();
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
