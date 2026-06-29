import { describe, expect, it } from 'vitest';
import { buildCbz, makeJpeg, makePng, makeRar, makeSevenZip } from './_test-helpers/fixtures.ts';
import { MAX_INPUT_BYTES, MAX_PAGES } from './constants.ts';
import {
  Comic7zNotSupportedError,
  ComicInputTooLargeError,
  ComicInvalidContainerError,
  ComicNoPagesError,
  ComicRarNotSupportedError,
  ComicTooManyPagesError,
} from './errors.ts';
import { parseComic } from './parser.ts';

const JPG = makeJpeg(8, 8, 3);
const PNG = makePng(8, 8);

describe('parseComic — CBZ', () => {
  it('collects image pages in natural order (page2 before page10)', async () => {
    const cbz = await buildCbz([
      ['page10.jpg', JPG],
      ['page2.jpg', JPG],
      ['page1.jpg', JPG],
      ['page20.jpg', JPG],
    ]);
    const book = await parseComic(cbz);
    expect(book.format).toBe('cbz');
    expect(book.pageCount).toBe(4);
    expect(book.pages.map((p) => p.name)).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg',
      'page20.jpg',
    ]);
  });

  it('maps page MIME types from the file extension', async () => {
    const cbz = await buildCbz([
      ['a.jpg', JPG],
      ['b.jpeg', JPG],
      ['c.png', PNG],
      ['d.gif', JPG],
      ['e.webp', JPG],
      ['f.bmp', JPG],
    ]);
    const book = await parseComic(cbz);
    expect(book.pages.map((p) => p.mime)).toEqual([
      'image/jpeg',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
    ]);
  });

  it('exposes the decompressed page bytes', async () => {
    const cbz = await buildCbz([['only.jpg', JPG]]);
    const book = await parseComic(cbz);
    expect(book.pages[0]?.bytes).toEqual(JPG);
  });

  it('skips non-image entries, __MACOSX, and dotfiles', async () => {
    const cbz = await buildCbz([
      ['ComicInfo.xml', new Uint8Array([0x3c, 0x3f])],
      ['__MACOSX/._page1.jpg', JPG],
      ['.DS_Store', new Uint8Array([0x00])],
      ['._page1.jpg', JPG],
      ['notes.txt', new Uint8Array([0x68, 0x69])],
      ['page1.jpg', JPG],
      ['noextension', JPG],
    ]);
    const book = await parseComic(cbz);
    expect(book.pages.map((p) => p.name)).toEqual(['page1.jpg']);
  });

  it('skips a nested __MACOSX directory', async () => {
    const cbz = await buildCbz([
      ['comic/__MACOSX/page9.jpg', JPG],
      ['comic/page1.jpg', JPG],
    ]);
    const book = await parseComic(cbz);
    expect(book.pages.map((p) => p.name)).toEqual(['comic/page1.jpg']);
  });

  it('throws ComicNoPagesError for a CBZ with no image entries', async () => {
    const cbz = await buildCbz([['ComicInfo.xml', new Uint8Array([0x3c])]]);
    await expect(parseComic(cbz)).rejects.toBeInstanceOf(ComicNoPagesError);
  });

  it('throws ComicTooManyPagesError when the page cap is exceeded', async () => {
    const entries: Array<[string, Uint8Array]> = [];
    for (let i = 0; i < MAX_PAGES + 1; i += 1) entries.push([`p${i}.jpg`, JPG]);
    const cbz = await buildCbz(entries);
    await expect(parseComic(cbz)).rejects.toBeInstanceOf(ComicTooManyPagesError);
  });
});

describe('parseComic — deferred / invalid containers', () => {
  it('throws ComicRarNotSupportedError for a CBR (RAR) container', async () => {
    await expect(parseComic(makeRar())).rejects.toBeInstanceOf(ComicRarNotSupportedError);
  });

  it('throws Comic7zNotSupportedError for a CB7 (7z) container', async () => {
    await expect(parseComic(makeSevenZip())).rejects.toBeInstanceOf(Comic7zNotSupportedError);
  });

  it('throws ComicInvalidContainerError for unrecognised bytes', async () => {
    const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await expect(parseComic(junk)).rejects.toBeInstanceOf(ComicInvalidContainerError);
  });

  it('throws ComicInputTooLargeError above the byte cap', async () => {
    const fake = { length: MAX_INPUT_BYTES + 1 } as unknown as Uint8Array;
    await expect(parseComic(fake)).rejects.toBeInstanceOf(ComicInputTooLargeError);
  });
});
