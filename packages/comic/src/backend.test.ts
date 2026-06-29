import { DocPdfDecodeError, parsePdfInfo } from '@catlabtech/webcvt-doc-pdf';
import { describe, expect, it } from 'vitest';
import { buildCbz, makeJpeg, makePng } from './_test-helpers/fixtures.ts';
import { CB7_FORMAT, CBR_FORMAT, CBZ_FORMAT, ComicBackend } from './backend.ts';
import { MAX_INPUT_BYTES, PDF_MIME } from './constants.ts';
import { ComicInputTooLargeError, ComicUnsupportedPageFormatError } from './errors.ts';

const PDF_OUT = { ext: 'pdf', mime: PDF_MIME, category: 'document' as const };
const JPG = makeJpeg(8, 8, 3);
const PNG = makePng(8, 8);

function noopOptions() {
  return { format: 'pdf' as const };
}

describe('ComicBackend.canHandle', () => {
  const backend = new ComicBackend();

  it('handles cbz → pdf (by MIME and by ext)', async () => {
    await expect(backend.canHandle(CBZ_FORMAT, PDF_OUT)).resolves.toBe(true);
    await expect(
      backend.canHandle(
        { ext: 'cbz', mime: 'x/anything', category: 'document' },
        { ext: 'pdf', mime: 'x/y', category: 'document' },
      ),
    ).resolves.toBe(true);
  });

  it('rejects non-cbz input and non-pdf output', async () => {
    await expect(
      backend.canHandle({ ext: 'zip', mime: 'application/zip', category: 'archive' }, PDF_OUT),
    ).resolves.toBe(false);
    await expect(
      backend.canHandle(CBZ_FORMAT, { ext: 'txt', mime: 'text/plain', category: 'document' }),
    ).resolves.toBe(false);
    await expect(backend.canHandle(CBR_FORMAT, PDF_OUT)).resolves.toBe(false);
    await expect(backend.canHandle(CB7_FORMAT, PDF_OUT)).resolves.toBe(false);
  });
});

describe('ComicBackend.convert', () => {
  const backend = new ComicBackend();

  it('converts a CBZ of JPEG/PNG pages into a multi-page PDF', async () => {
    const cbz = await buildCbz([
      ['page2.jpg', JPG],
      ['page10.jpg', JPG],
      ['page1.png', PNG],
    ]);
    const phases: string[] = [];
    const result = await backend.convert(new Blob([cbz]), PDF_OUT, {
      format: 'pdf',
      onProgress: (p) => {
        if (p.phase) phases.push(p.phase);
      },
    });

    expect(result.backend).toBe('comic');
    expect(result.format).toBe(PDF_OUT);
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.blob.type).toBe(PDF_MIME);
    expect(phases).toContain('done');

    const pdfBytes = new Uint8Array(await result.blob.arrayBuffer());
    const info = parsePdfInfo(pdfBytes);
    expect(info.pageCount).toBe(3);
  });

  it('wraps an unsupported page format in ComicUnsupportedPageFormatError', async () => {
    // An RGBA PNG (colour type 6) cannot be embedded by imagesToPdf.
    const rgba = makePng(8, 8, 6);
    const cbz = await buildCbz([['page1.png', rgba]]);
    await expect(backend.convert(new Blob([cbz]), PDF_OUT, noopOptions())).rejects.toBeInstanceOf(
      ComicUnsupportedPageFormatError,
    );
  });

  it('re-throws non-unsupported doc-pdf errors unwrapped (e.g. a corrupt JPEG)', async () => {
    // SOI + EOI only: a JPEG signature with no SOF marker → DocPdfDecodeError,
    // which is NOT a DocPdfUnsupportedSourceError and must propagate as-is.
    const corruptJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const cbz = await buildCbz([['page1.jpg', corruptJpeg]]);
    const promise = backend.convert(new Blob([cbz]), PDF_OUT, noopOptions());
    await expect(promise).rejects.toBeInstanceOf(DocPdfDecodeError);
    await expect(promise).rejects.not.toBeInstanceOf(ComicUnsupportedPageFormatError);
  });

  it('rejects oversized input before reading it', async () => {
    const fake = { size: MAX_INPUT_BYTES + 1 } as unknown as Blob;
    await expect(backend.convert(fake, PDF_OUT, noopOptions())).rejects.toBeInstanceOf(
      ComicInputTooLargeError,
    );
  });

  it('rejects an unsupported output format', async () => {
    const cbz = await buildCbz([['page1.jpg', JPG]]);
    await expect(
      backend.convert(
        new Blob([cbz]),
        { ext: 'txt', mime: 'text/plain', category: 'document' },
        {
          format: 'txt',
        },
      ),
    ).rejects.toThrow();
  });
});
