/**
 * ComicBackend — webcvt Backend implementation for comic book conversion.
 *
 * Supported conversion:
 *   cbz → pdf : every image page, in natural reading order, wrapped into one
 *               multi-page PDF (one page per image) via doc-pdf's `imagesToPdf`.
 *
 * This backend deliberately does NOT auto-register itself — consumers wire it
 * into a registry explicitly. Comic input is recognised by the filename hint /
 * format descriptor (CBZ shares ZIP magic, so it relies on the extension/MIME).
 *
 * Clean-room: a CBZ is a ZIP of page images; the PDF assembly is delegated to
 * @catlabtech/webcvt-doc-pdf.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import {
  DocPdfUnsupportedSourceError,
  type ImageInput,
  imagesToPdf,
} from '@catlabtech/webcvt-doc-pdf';
import { CB7_MIME, CBR_MIME, CBZ_MIME, MAX_INPUT_BYTES, PDF_MIME } from './constants.ts';
import { ComicInputTooLargeError, ComicUnsupportedPageFormatError } from './errors.ts';
import { parseComic } from './parser.ts';

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

/** Format descriptor for a Comic Book ZIP archive. */
export const CBZ_FORMAT: FormatDescriptor = {
  ext: 'cbz',
  mime: CBZ_MIME,
  category: 'document',
  description: 'Comic Book ZIP archive (CBZ)',
};

/** Format descriptor for a Comic Book RAR archive (decode deferred). */
export const CBR_FORMAT: FormatDescriptor = {
  ext: 'cbr',
  mime: CBR_MIME,
  category: 'document',
  description: 'Comic Book RAR archive (CBR)',
};

/** Format descriptor for a Comic Book 7z archive (decode deferred). */
export const CB7_FORMAT: FormatDescriptor = {
  ext: 'cb7',
  mime: CB7_MIME,
  category: 'document',
  description: 'Comic Book 7z archive (CB7)',
};

// ---------------------------------------------------------------------------
// Format predicates
// ---------------------------------------------------------------------------

function isCbzInput(input: FormatDescriptor): boolean {
  return input.mime === CBZ_MIME || input.ext === 'cbz';
}

function isPdfOutput(output: FormatDescriptor): boolean {
  return output.mime === PDF_MIME || output.ext === 'pdf';
}

// ---------------------------------------------------------------------------
// ComicBackend
// ---------------------------------------------------------------------------

export class ComicBackend implements Backend {
  readonly name = 'comic';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return isCbzInput(input) && isPdfOutput(output);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new ComicInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }
    if (!isPdfOutput(output)) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });
    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const book = await parseComic(bytes);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const images: ImageInput[] = book.pages.map((page) => ({ bytes: page.bytes, mime: page.mime }));

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = imagesToPdf(images, { maxInputBytes: MAX_INPUT_BYTES });
    } catch (cause) {
      if (cause instanceof DocPdfUnsupportedSourceError) {
        throw new ComicUnsupportedPageFormatError(cause.message, { cause });
      }
      throw cause;
    }

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: PDF_MIME });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}
