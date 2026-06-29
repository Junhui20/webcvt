/**
 * Public data model for @catlabtech/webcvt-comic.
 *
 * These types describe the structured shape returned by `parseComic`. They are
 * plain data (no methods). Only the CBZ container is parsed to pages today; CBR
 * (RAR) and CB7 (7z) are detected but deferred to a future wasm decoder, so the
 * parsed `format` is always `'cbz'`.
 *
 * Clean-room: a comic book archive is, by community convention, simply a ZIP /
 * RAR / 7z of sequentially named page images. No third-party reader code is
 * ported here.
 */

/** One decoded comic page: an image entry read from the container. */
export interface ComicPage {
  /** The page's entry name within the archive (e.g. "pages/page-001.jpg"). */
  readonly name: string;
  /** Raw, decompressed image bytes (the encoded JPEG/PNG/… as stored). */
  readonly bytes: Uint8Array;
  /** Best-effort MIME type derived from the entry's file extension. */
  readonly mime: string;
}

/** A parsed comic book, with its pages in natural reading order. */
export interface ComicBook {
  /** The recognised container format. Only `'cbz'` is parsed to pages today. */
  readonly format: 'cbz';
  /** Number of image pages (always equal to `pages.length`). */
  readonly pageCount: number;
  /** Image pages, sorted by natural (numeric-aware) entry-name order. */
  readonly pages: readonly ComicPage[];
}
