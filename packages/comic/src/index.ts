/**
 * @catlabtech/webcvt-comic — Public API
 *
 * A self-written, read-only comic book reader that composes two hardened webcvt
 * packages:
 *   - @catlabtech/webcvt-archive-zip — `parseZip` (zip-slip + decompression-bomb
 *     protection) reads CBZ (a ZIP of page images).
 *   - @catlabtech/webcvt-doc-pdf     — `imagesToPdf` wraps the ordered pages into
 *     a single multi-page PDF.
 *
 * Scope: CBZ → PDF. CBR (RAR) and CB7 (7z) are DETECTED by magic bytes so the
 * caller gets a precise error, but their decoders are deferred (like WOFF2 /
 * bzip2 / xz elsewhere in webcvt).
 *
 * Clean-room: a comic book archive is, by community convention, a ZIP / RAR / 7z
 * of sequentially named page images. No third-party reader code is ported here.
 *
 * Security: 512 MiB input cap, a 5,000-page cap, magic-byte container routing
 * (no extension trust), and natural-order page sorting. ZIP bomb / zip-slip
 * protection is delegated to archive-zip; per-image limits to doc-pdf.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ComicBook, ComicPage } from './model.ts';
export type { ComicContainer } from './container.ts';

// ---------------------------------------------------------------------------
// Reader API
// ---------------------------------------------------------------------------

export { parseComic } from './parser.ts';
export { detectComicContainer } from './container.ts';

// ---------------------------------------------------------------------------
// Natural ordering (exported for advanced consumers / testing)
// ---------------------------------------------------------------------------

export { naturalCompare, naturalSortBy } from './natural-sort.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export { ComicBackend, CBZ_FORMAT, CBR_FORMAT, CB7_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export {
  CB7_MIME,
  CBR_MIME,
  CBZ_MIME,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  PDF_MIME,
} from './constants.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  Comic7zNotSupportedError,
  ComicInputTooLargeError,
  ComicInvalidContainerError,
  ComicNoPagesError,
  ComicRarNotSupportedError,
  ComicTooManyPagesError,
  ComicUnsupportedPageFormatError,
} from './errors.ts';
