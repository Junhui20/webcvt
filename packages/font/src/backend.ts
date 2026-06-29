/**
 * FontBackend — webcvt Backend implementation for sfnt ↔ WOFF repackaging.
 *
 * Supported conversions (pure container repackaging — no glyph/outline work):
 *   ttf/otf → woff : read the sfnt tables, deflate each, emit a WOFF.
 *   woff → ttf/otf : read the WOFF tables, inflate each, rebuild an sfnt and
 *                    recompute head.checkSumAdjustment.
 *
 * The output extension follows the WOFF/sfnt `flavor`: 'OTTO' → .otf, otherwise
 * → .ttf. ttf↔otf are NOT inter-converted (that needs CFF/outline conversion,
 * out of scope). WOFF 2.0 is rejected with a typed error.
 *
 * This backend deliberately does NOT auto-register itself — consumers wire it
 * into a registry explicitly.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, OTF_MIME, TTF_MIME, WOFF_MIME } from './constants.ts';
import { FontInputTooLargeError } from './errors.ts';
import { flavorToExt, parseSfnt, serializeSfnt } from './sfnt.ts';
import { parseWoff, serializeWoff } from './woff.ts';

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

/** TrueType-flavoured sfnt font. */
export const TTF_FORMAT: FormatDescriptor = {
  ext: 'ttf',
  mime: TTF_MIME,
  category: 'font',
  description: 'TrueType Font (sfnt)',
};

/** OpenType/CFF-flavoured sfnt font. */
export const OTF_FORMAT: FormatDescriptor = {
  ext: 'otf',
  mime: OTF_MIME,
  category: 'font',
  description: 'OpenType Font (sfnt/CFF)',
};

/** WOFF 1.0 font. */
export const WOFF_FORMAT: FormatDescriptor = {
  ext: 'woff',
  mime: WOFF_MIME,
  category: 'font',
  description: 'Web Open Font Format 1.0',
};

// ---------------------------------------------------------------------------
// Format predicates
// ---------------------------------------------------------------------------

function isSfntFormat(format: FormatDescriptor): boolean {
  return (
    format.ext === 'ttf' ||
    format.ext === 'otf' ||
    format.mime === TTF_MIME ||
    format.mime === OTF_MIME
  );
}

function isWoffFormat(format: FormatDescriptor): boolean {
  return format.ext === 'woff' || format.mime === WOFF_MIME;
}

// ---------------------------------------------------------------------------
// FontBackend
// ---------------------------------------------------------------------------

export class FontBackend implements Backend {
  readonly name = 'font';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (isSfntFormat(input) && isWoffFormat(output)) return true;
    if (isWoffFormat(input) && isSfntFormat(output)) return true;
    return false;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new FontInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    const inputDesc = formatOfBlob(input, output);
    const sfntToWoff = isSfntFormat(inputDesc) && isWoffFormat(output);
    const woffToSfnt = isWoffFormat(inputDesc) && isSfntFormat(output);
    if (!sfntToWoff && !woffToSfnt) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    options.onProgress?.({ percent: 5, phase: 'read' });
    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 40, phase: 'parse' });

    let outBytes: Uint8Array;
    let resultFormat: FormatDescriptor;

    if (sfntToWoff) {
      const font = parseSfnt(bytes);
      options.onProgress?.({ percent: 70, phase: 'serialize' });
      outBytes = await serializeWoff(font);
      resultFormat = WOFF_FORMAT;
    } else {
      const font = await parseWoff(bytes);
      options.onProgress?.({ percent: 70, phase: 'serialize' });
      outBytes = serializeSfnt(font);
      // The real output flavor decides the extension, regardless of what was
      // requested: a TrueType WOFF always becomes .ttf, a CFF WOFF .otf.
      resultFormat = flavorToExt(font.flavor) === 'otf' ? OTF_FORMAT : TTF_FORMAT;
    }

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([outBytes.buffer as ArrayBuffer], { type: resultFormat.mime });
    return {
      blob,
      format: resultFormat,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

/**
 * Determine the effective input descriptor. A Blob carries no reliable font
 * MIME, so we trust the conversion direction implied by the requested output:
 * if the output is a WOFF the input must be an sfnt, and vice versa. When the
 * Blob's own type is a known font MIME it is used directly.
 */
function formatOfBlob(input: Blob, output: FormatDescriptor): FormatDescriptor {
  const type = input.type;
  if (type === TTF_MIME) return TTF_FORMAT;
  if (type === OTF_MIME) return OTF_FORMAT;
  if (type === WOFF_MIME) return WOFF_FORMAT;
  // Infer from the requested output direction.
  return isWoffFormat(output) ? TTF_FORMAT : WOFF_FORMAT;
}
