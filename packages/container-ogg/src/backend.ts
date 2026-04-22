/**
 * OggBackend — webcvt Backend implementation for the Ogg container.
 *
 * Phase 1 / Phase 2 capability:
 * - canHandle: Ogg input → Ogg output (identity round-trip for .ogg/.oga/.opus).
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (lossless round-trip).
 * - convert (Vorbis encode): throws OggEncodeNotImplementedError (route to wasm).
 * - convert (Opus encode from WebCodecs): Phase 2 — deferred.
 *
 * Design note:
 * - Vorbis encode is not in WebCodecs; encode path throws with pointer to wasm.
 * - Opus decode is broadly supported; each OggPacket.data is submitted as an
 *   EncodedAudioChunk. The container layer doesn't decode — that's codec-webcodecs.
 * - Do NOT import backend-wasm directly; let the BackendRegistry fallback chain handle it.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES } from './constants.ts';
import { OggEncodeNotImplementedError, OggInputTooLargeError } from './errors.ts';
import { parseOgg } from './parser.ts';
import { serializeOgg } from './serializer.ts';

// ---------------------------------------------------------------------------
// MIME type registry
// ---------------------------------------------------------------------------

// Identity-only gate: a cross-MIME relabel (e.g. audio/ogg → audio/opus) would
// lie about the codec without re-encoding. Lesson repeated from container-flac
// and container-aac reviews — only exact mime === mime passes canHandle.
const OGG_MIMES = new Set(['audio/ogg', 'audio/opus']);

// ---------------------------------------------------------------------------
// OggBackend
// ---------------------------------------------------------------------------

/**
 * Backend that round-trips Ogg/Vorbis and Ogg/Opus files via the container
 * parser (Phase 2 identity + Opus decode scaffold).
 */
export class OggBackend implements Backend {
  readonly name = 'container-ogg';

  /**
   * Phase 2: identity only (Ogg → Ogg).
   *
   * Returns true when both input AND output are Ogg MIME types.
   * Vorbis / Opus encode from non-Ogg sources routes to backend-wasm.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    // Identity-only per the recurring lesson from container-flac/container-aac/container-ogg reviews.
    return OGG_MIMES.has(input.mime) && input.mime === output.mime;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new OggInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const oggFile = parseOgg(inputBytes);

    options.onProgress?.({ percent: 50, phase: 'decode' });

    // Identity / round-trip path (Ogg → Ogg).
    if (OGG_MIMES.has(output.mime)) {
      const outputBytes = serializeOgg(oggFile);
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

    // Phase 1/2: non-Ogg output not implemented.
    throw new OggEncodeNotImplementedError();
  }
}

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

export const OGG_FORMAT: FormatDescriptor = {
  ext: 'ogg',
  mime: 'audio/ogg',
  category: 'audio',
  description: 'Ogg',
};

export const OPUS_FORMAT: FormatDescriptor = {
  ext: 'opus',
  mime: 'audio/opus',
  category: 'audio',
  description: 'Opus audio in Ogg',
};

export const OGA_FORMAT: FormatDescriptor = {
  ext: 'oga',
  mime: 'audio/ogg',
  category: 'audio',
  description: 'Ogg audio (alternate extension)',
};
