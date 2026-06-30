import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { parsePdfInfo } from '@catlabtech/webcvt-doc-pdf';
/**
 * Real-file regression test: build a CBZ from real encoder-produced JPEG + PNG
 * images (tests/fixtures/image/), parse it, and convert it to a PDF whose page
 * count is read back via doc-pdf. End-to-end on real image bytes.
 */
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { buildCbz } from './_test-helpers/fixtures.ts';
import { ComicBackend, parseComic } from './index.ts';

const PDF_OUT: FormatDescriptor = { ext: 'pdf', mime: 'application/pdf', category: 'document' };

async function realCbz(): Promise<Uint8Array> {
  const jpg = await loadFixture('image/testsrc-64x64.jpg');
  const png = await loadFixture('image/testsrc-64x64.png');
  return buildCbz([
    ['page-01.jpg', jpg],
    ['page-02.png', png],
  ]);
}

describe('comic — REAL fixtures (real images -> CBZ -> PDF)', () => {
  it('parses a CBZ of real images in natural page order', async () => {
    const book = await parseComic(await realCbz());
    expect(book.pageCount).toBe(2);
    expect(book.pages.map((p) => p.name)).toEqual(['page-01.jpg', 'page-02.png']);
  });

  it('converts the real CBZ to a 2-page PDF', async () => {
    const cbz = await realCbz();
    const result = await new ComicBackend().convert(
      new Blob([cbz.buffer as ArrayBuffer], { type: 'application/vnd.comicbook+zip' }),
      PDF_OUT,
      {},
    );
    const pdf = new Uint8Array(await result.blob.arrayBuffer());
    expect(parsePdfInfo(pdf).pageCount).toBe(2);
  });
});
