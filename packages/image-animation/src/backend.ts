/**
 * AnimationBackend — webcvt Backend implementation for animated image formats.
 *
 * canHandle: identity-within-format only (input.mime === output.mime AND
 * the MIME belongs to one of the three supported formats). No cross-format
 * conversion, no auto-detection.
 *
 * For 'image/webp': canHandle returns true; convert will throw
 * WebpStaticNotSupportedError for static WebP inputs (per design note).
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { APNG_MIME, GIF_MIME, MAX_INPUT_BYTES, WEBP_MIME } from './constants.ts';
import { detectAnimationFormat } from './detect.ts';
import { AnimationUnsupportedFormatError, ImageInputTooLargeError } from './errors.ts';
import { parseAnimation } from './parser.ts';
import { serializeAnimation } from './serializer.ts';
import type { AnimationFormat } from './types.ts';

// ---------------------------------------------------------------------------
// MIME → AnimationFormat mapping
// ---------------------------------------------------------------------------

const MIME_TO_FORMAT = new Map<string, AnimationFormat>([
  [GIF_MIME, 'gif'],
  [APNG_MIME, 'apng'],
  [WEBP_MIME, 'webp-anim'],
]);

// ---------------------------------------------------------------------------
// AnimationBackend
// ---------------------------------------------------------------------------

export class AnimationBackend implements Backend {
  readonly name = 'image-animation';

  /**
   * Returns true only when input MIME === output MIME AND both map to one of
   * the three supported animated formats.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (input.mime !== output.mime) return false;
    return MIME_TO_FORMAT.has(input.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new ImageInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    const formatHint = MIME_TO_FORMAT.get(input.type);
    if (formatHint === undefined) {
      throw new AnimationUnsupportedFormatError(input.type);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const bytes = new Uint8Array(await input.arrayBuffer());

    // For WebP, detect if it's actually animated (canHandle accepted it by MIME alone)
    const format: AnimationFormat = formatHint;
    if (formatHint === 'webp-anim') {
      const detected = detectAnimationFormat(bytes);
      if (detected !== 'webp-anim') {
        // Static WebP — this package can't handle it; throw so caller falls back
        throw new AnimationUnsupportedFormatError(input.type);
      }
    } else if (formatHint === 'apng') {
      const detected = detectAnimationFormat(bytes);
      if (detected !== 'apng') {
        throw new AnimationUnsupportedFormatError(input.type);
      }
    }

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const parsed = parseAnimation(bytes, format);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const serialized = serializeAnimation(parsed);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const outBuffer = new ArrayBuffer(serialized.byteLength);
    new Uint8Array(outBuffer).set(serialized);
    const blob = new Blob([outBuffer], { type: output.mime });

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
// Format descriptors
// ---------------------------------------------------------------------------

export const GIF_FORMAT: FormatDescriptor = {
  ext: 'gif',
  mime: GIF_MIME,
  category: 'image',
  description: 'GIF Animation',
};

export const APNG_FORMAT: FormatDescriptor = {
  ext: 'apng',
  mime: APNG_MIME,
  category: 'image',
  description: 'Animated PNG (APNG)',
};

export const WEBP_ANIM_FORMAT: FormatDescriptor = {
  ext: 'webp',
  mime: WEBP_MIME,
  category: 'image',
  description: 'Animated WebP',
};
