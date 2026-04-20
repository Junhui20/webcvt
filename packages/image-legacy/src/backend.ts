/**
 * ImageLegacyBackend — webcvt Backend implementation for five legacy image formats.
 *
 * canHandle: identity-within-format only (input.mime === output.mime AND
 * the MIME belongs to one of the five supported formats). No cross-format
 * conversion, no auto-detection.
 *
 * Lesson 1 from prior packages: each format gates on its own MIME only.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import {
  ICNS_MIME,
  ICNS_MIME_ALT,
  MAX_INPUT_BYTES,
  PBM_MIME,
  PCX_MIME,
  PCX_MIME_ALT,
  PFM_MIME,
  PGM_MIME,
  PPM_MIME,
  QOI_MIME,
  TGA_MIME,
  TGA_MIME_ALT1,
  TGA_MIME_ALT2,
  TIFF_MIME,
  XBM_MIME,
  XBM_MIME_ALT,
  XPM_MIME,
  XPM_MIME_ALT,
} from './constants.ts';
import type { ImageFormat } from './detect.ts';
import { ImageInputTooLargeError, ImageUnsupportedFormatError } from './errors.ts';
import { parseImage } from './parser.ts';
import { serializeImage } from './serializer.ts';

// ---------------------------------------------------------------------------
// MIME → ImageFormat mapping
// ---------------------------------------------------------------------------

const MIME_TO_FORMAT = new Map<string, ImageFormat>([
  [PBM_MIME, 'pbm'],
  [PGM_MIME, 'pgm'],
  [PPM_MIME, 'ppm'],
  [PFM_MIME, 'pfm'],
  [QOI_MIME, 'qoi'],
  [TIFF_MIME, 'tiff'],
  [TGA_MIME, 'tga'],
  [TGA_MIME_ALT1, 'tga'],
  [TGA_MIME_ALT2, 'tga'],
  [XBM_MIME, 'xbm'],
  [XBM_MIME_ALT, 'xbm'],
  [PCX_MIME, 'pcx'],
  [PCX_MIME_ALT, 'pcx'],
  [XPM_MIME, 'xpm'],
  [XPM_MIME_ALT, 'xpm'],
  [ICNS_MIME, 'icns'],
  [ICNS_MIME_ALT, 'icns'],
]);

// ---------------------------------------------------------------------------
// ImageLegacyBackend
// ---------------------------------------------------------------------------

export class ImageLegacyBackend implements Backend {
  readonly name = 'image-legacy';

  /**
   * Returns true only when input MIME === output MIME AND both map to one of
   * the five supported legacy image formats.
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

    const format = MIME_TO_FORMAT.get(input.type);
    if (format === undefined) {
      throw new ImageUnsupportedFormatError(input.type);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const parsed = parseImage(bytes, format);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const serialized = serializeImage(parsed);

    options.onProgress?.({ percent: 100, phase: 'done' });

    // Copy to a plain ArrayBuffer to satisfy Blob constructor typing (no SharedArrayBuffer)
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

export const PBM_FORMAT: FormatDescriptor = {
  ext: 'pbm',
  mime: PBM_MIME,
  category: 'image',
  description: 'Portable Bitmap (Netpbm)',
};

export const PGM_FORMAT: FormatDescriptor = {
  ext: 'pgm',
  mime: PGM_MIME,
  category: 'image',
  description: 'Portable Graymap (Netpbm)',
};

export const PPM_FORMAT: FormatDescriptor = {
  ext: 'ppm',
  mime: PPM_MIME,
  category: 'image',
  description: 'Portable Pixmap (Netpbm)',
};

export const PFM_FORMAT: FormatDescriptor = {
  ext: 'pfm',
  mime: PFM_MIME,
  category: 'image',
  description: 'Portable Float Map',
};

export const QOI_FORMAT: FormatDescriptor = {
  ext: 'qoi',
  mime: QOI_MIME,
  category: 'image',
  description: 'Quite OK Image Format',
};

export const TIFF_FORMAT: FormatDescriptor = {
  ext: 'tiff',
  mime: TIFF_MIME,
  category: 'image',
  description: 'Tag Image File Format (TIFF 6.0)',
};

export const TGA_FORMAT: FormatDescriptor = {
  ext: 'tga',
  mime: TGA_MIME,
  category: 'image',
  description: 'Truevision TGA (Targa)',
};

export const XBM_FORMAT: FormatDescriptor = {
  ext: 'xbm',
  mime: XBM_MIME,
  category: 'image',
  description: 'X11 Bitmap',
};

export const PCX_FORMAT: FormatDescriptor = {
  ext: 'pcx',
  mime: PCX_MIME,
  category: 'image',
  description: 'PC Paintbrush',
};

export const XPM_FORMAT: FormatDescriptor = {
  ext: 'xpm',
  mime: XPM_MIME,
  category: 'image',
  description: 'X PixMap',
};

export const ICNS_FORMAT: FormatDescriptor = {
  ext: 'icns',
  mime: ICNS_MIME,
  category: 'image',
  description: 'Apple Icon Image',
};
