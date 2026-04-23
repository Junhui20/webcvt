/**
 * SvgBackend — webcvt Backend implementation for SVG images.
 *
 * First-pass capability:
 *  - canHandle: identity SVG→SVG (pass-through serialization).
 *  - canHandle: SVG→PNG, SVG→JPEG, SVG→WebP (rasterization paths).
 *  - canHandle: everything else → false (cross-MIME relabel, non-SVG input).
 *
 * Identity-only gate lesson (Lesson 1 from prior packages): canHandle returns
 * true ONLY for the explicitly-supported paths above. No speculative returns.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import {
  JPEG_MIME,
  MAX_SVG_INPUT_BYTES,
  PNG_MIME,
  RASTERIZE_OUTPUT_MIMES,
  SVG_MIME,
  WEBP_MIME,
} from './constants.ts';
import { SvgEncodeNotImplementedError, SvgInputTooLargeError } from './errors.ts';
import { parseSvg, serializeSvg } from './parser.ts';
import { rasterizeSvg } from './rasterizer.ts';

// ---------------------------------------------------------------------------
// SvgBackend
// ---------------------------------------------------------------------------

export class SvgBackend implements Backend {
  readonly name = 'image-svg';

  /**
   * canHandle returns true for:
   *  - SVG → SVG  (identity / pass-through)
   *  - SVG → PNG  (rasterize)
   *  - SVG → JPEG (rasterize)
   *  - SVG → WebP (rasterize)
   *
   * Returns false for everything else (cross-MIME relabel, non-SVG input).
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (input.mime !== SVG_MIME) return false;
    if (output.mime === SVG_MIME) return true;
    return RASTERIZE_OUTPUT_MIMES.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_SVG_INPUT_BYTES) {
      throw new SvgInputTooLargeError(input.size, MAX_SVG_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const source = await input.text();
    const svgFile = parseSvg(source);

    // Identity path: SVG → SVG
    if (output.mime === SVG_MIME) {
      options.onProgress?.({ percent: 50, phase: 'mux' });
      const serialized = serializeSvg(svgFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([serialized], { type: SVG_MIME });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Rasterize paths: SVG → PNG / JPEG / WebP
    if (RASTERIZE_OUTPUT_MIMES.has(output.mime)) {
      options.onProgress?.({ percent: 20, phase: 'rasterize' });
      const format = output.mime as 'image/png' | 'image/jpeg' | 'image/webp';
      const quality = options.quality;
      const blob = await rasterizeSvg(svgFile, { format, quality });
      options.onProgress?.({ percent: 100, phase: 'done' });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    throw new SvgEncodeNotImplementedError(
      `output MIME "${output.mime}" from input "${input.type}" is not a supported path`,
    );
  }
}

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

export const SVG_FORMAT: FormatDescriptor = {
  ext: 'svg',
  mime: SVG_MIME,
  category: 'image',
  description: 'Scalable Vector Graphics',
};

export const PNG_FORMAT: FormatDescriptor = {
  ext: 'png',
  mime: PNG_MIME,
  category: 'image',
  description: 'Portable Network Graphics',
};

export const JPEG_FORMAT: FormatDescriptor = {
  ext: 'jpeg',
  mime: JPEG_MIME,
  category: 'image',
  description: 'JPEG',
};

export const WEBP_FORMAT: FormatDescriptor = {
  ext: 'webp',
  mime: WEBP_MIME,
  category: 'image',
  description: 'Web Picture',
};
