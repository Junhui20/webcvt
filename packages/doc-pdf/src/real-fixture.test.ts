/**
 * Real-file regression test: real encoder-produced JPEG + PNG images committed
 * under tests/fixtures/image/, wrapped into a multi-page PDF whose page count is
 * read back. (The synthetic tests use hand-built images; this uses real ones.)
 */
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { imagesToPdf, parsePdfInfo } from './index.ts';

describe('doc-pdf — REAL fixtures (ffmpeg JPEG + PNG -> PDF)', () => {
  it('writes a 2-page PDF from real images that our reader reads back', async () => {
    const jpg = await loadFixture('image/testsrc-64x64.jpg');
    const png = await loadFixture('image/testsrc-64x64.png');
    const pdf = imagesToPdf([
      { bytes: jpg, mime: 'image/jpeg' },
      { bytes: png, mime: 'image/png' },
    ]);
    const info = parsePdfInfo(pdf);
    expect(info.pageCount).toBe(2);
    expect(info.version).toMatch(/^1\./);
  });
});
