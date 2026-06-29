import { BackendRegistry } from '@catlabtech/webcvt-core';
import type { ConvertOptions, FormatDescriptor, ProgressEvent } from '@catlabtech/webcvt-core';
import { UnsupportedFormatError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import { makeJpegHeader } from './_test-helpers/fixtures.ts';
import { DocPdfBackend, registerDocPdfBackend } from './backend.ts';
import { JPEG_MIME } from './constants.ts';
import { DocPdfInputTooLargeError } from './errors.ts';
import { JSON_FORMAT, PDF_FORMAT } from './format.ts';
import { imagesToPdf } from './images-to-pdf.ts';

const TXT_FORMAT: FormatDescriptor = {
  ext: 'txt',
  mime: 'text/plain',
  category: 'document',
};

function makePdfBlob(): Blob {
  const pdf = imagesToPdf([
    { bytes: makeJpegHeader(20, 20, 3), mime: JPEG_MIME },
    { bytes: makeJpegHeader(20, 20, 3), mime: JPEG_MIME },
  ]);
  return new Blob([pdf], { type: PDF_FORMAT.mime });
}

const noOpOptions: ConvertOptions = { format: JSON_FORMAT };

describe('DocPdfBackend.canHandle', () => {
  const backend = new DocPdfBackend();
  it('accepts pdf → json', async () => {
    expect(await backend.canHandle(PDF_FORMAT, JSON_FORMAT)).toBe(true);
  });
  it('rejects non-json output', async () => {
    expect(await backend.canHandle(PDF_FORMAT, TXT_FORMAT)).toBe(false);
  });
  it('rejects non-pdf input', async () => {
    expect(await backend.canHandle(JSON_FORMAT, JSON_FORMAT)).toBe(false);
  });
});

describe('DocPdfBackend.convert', () => {
  it('emits PDF info as JSON', async () => {
    const backend = new DocPdfBackend();
    const progress: ProgressEvent[] = [];
    const result = await backend.convert(makePdfBlob(), JSON_FORMAT, {
      format: JSON_FORMAT,
      onProgress: (p) => progress.push(p),
    });
    expect(result.backend).toBe('doc-pdf');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.format).toBe(JSON_FORMAT);
    const parsed = JSON.parse(await result.blob.text());
    expect(parsed.version).toBe('1.7');
    expect(parsed.pageCount).toBe(2);
    expect(parsed.producer).toBe('webcvt-doc-pdf');
    expect(progress.at(-1)?.percent).toBe(100);
  });

  it('rejects an oversized input blob', async () => {
    const backend = new DocPdfBackend({ maxInputBytes: 4 });
    await expect(backend.convert(makePdfBlob(), JSON_FORMAT, noOpOptions)).rejects.toBeInstanceOf(
      DocPdfInputTooLargeError,
    );
  });

  it('rejects an unsupported output format', async () => {
    const backend = new DocPdfBackend();
    await expect(
      backend.convert(makePdfBlob(), TXT_FORMAT, { format: TXT_FORMAT }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});

describe('registerDocPdfBackend', () => {
  it('registers into a provided registry and refuses duplicates', () => {
    const registry = new BackendRegistry();
    registerDocPdfBackend(registry);
    expect(registry.list().map((b) => b.name)).toContain('doc-pdf');
    expect(() => registerDocPdfBackend(registry)).toThrow();
  });
});
