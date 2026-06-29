/**
 * `parseComic` — read-only comic book (CBZ) reader.
 *
 * Pipeline (all archive security delegated to the composed package):
 *   1. Enforce MAX_INPUT_BYTES.
 *   2. Detect the container by magic bytes (container.ts).
 *   3. CBR / CB7 → raise the precise "deferred decoder" typed error.
 *   4. CBZ → archive-zip `parseZip` (zip-slip + decompression-bomb caps), collect
 *      image-page entries, sort them in natural (numeric-aware) order, cap the
 *      page count, and read each entry's decompressed bytes.
 *
 * Note: `parseComic` is async because archive-zip exposes entry payloads through
 * an async `data()` accessor (Deflate decompression uses DecompressionStream).
 *
 * Clean-room: a CBZ is simply a ZIP of sequentially named page images.
 */

import { type ZipEntry, parseZip } from '@catlabtech/webcvt-archive-zip';
import { IMAGE_EXT_TO_MIME, MAX_INPUT_BYTES, MAX_PAGES } from './constants.ts';
import { detectComicContainer } from './container.ts';
import {
  Comic7zNotSupportedError,
  ComicInputTooLargeError,
  ComicInvalidContainerError,
  ComicNoPagesError,
  ComicRarNotSupportedError,
  ComicTooManyPagesError,
} from './errors.ts';
import type { ComicBook, ComicPage } from './model.ts';
import { naturalSortBy } from './natural-sort.ts';

/** The final path segment of a forward-slash separated entry name. */
function baseName(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}

/** Lowercased extension (without the dot) of a basename, or '' if none. */
function extensionOf(base: string): string {
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether a ZIP entry is a comic page image worth collecting.
 *
 * Skips: directories, the macOS `__MACOSX/` resource-fork tree, dotfiles
 * (basename starting with `.`, e.g. `.DS_Store` or AppleDouble `._page1.jpg`),
 * and any entry whose extension is not a known image type.
 */
function pageMimeFor(entry: ZipEntry): string | undefined {
  if (entry.isDirectory) return undefined;
  if (entry.name.startsWith('__MACOSX/') || entry.name.includes('/__MACOSX/')) return undefined;
  const base = baseName(entry.name);
  if (base.length === 0 || base.startsWith('.')) return undefined;
  const ext = extensionOf(base);
  if (ext.length === 0) return undefined;
  return IMAGE_EXT_TO_MIME[ext];
}

/**
 * Parse a read-only comic book from its raw container bytes.
 *
 * @throws {@link ComicInputTooLargeError} when the input exceeds the byte cap.
 * @throws {@link ComicRarNotSupportedError} / {@link Comic7zNotSupportedError}
 *         for a detected CBR / CB7 container (decoder deferred).
 * @throws {@link ComicInvalidContainerError} when no archive signature matches.
 * @throws {@link ComicNoPagesError} when a CBZ holds no image pages.
 * @throws {@link ComicTooManyPagesError} when a CBZ exceeds MAX_PAGES pages.
 * @throws the archive-zip typed errors (zip-slip, decompression-bomb, …).
 */
export async function parseComic(input: Uint8Array): Promise<ComicBook> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new ComicInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  const container = detectComicContainer(input);
  if (container === 'cbr') throw new ComicRarNotSupportedError();
  if (container === 'cb7') throw new Comic7zNotSupportedError();
  if (container !== 'cbz') throw new ComicInvalidContainerError();

  const zip = parseZip(input);

  const imageEntries: Array<{ entry: ZipEntry; mime: string }> = [];
  for (const entry of zip.entries) {
    const mime = pageMimeFor(entry);
    if (mime !== undefined) imageEntries.push({ entry, mime });
  }

  if (imageEntries.length === 0) throw new ComicNoPagesError();
  if (imageEntries.length > MAX_PAGES) {
    throw new ComicTooManyPagesError(imageEntries.length, MAX_PAGES);
  }

  const ordered = naturalSortBy(imageEntries, (item) => item.entry.name);

  const pages: ComicPage[] = [];
  for (const { entry, mime } of ordered) {
    pages.push({ name: entry.name, bytes: await entry.data(), mime });
  }

  return { format: 'cbz', pageCount: pages.length, pages };
}
