/**
 * Typed error classes for @catlabtech/webcvt-comic.
 *
 * Every error code is an UPPER_SNAKE_CASE string for programmatic matching.
 * Never throw a bare Error or a bare WebcvtError from this package — always use
 * one of the typed subclasses below. ZIP-level (zip-slip, decompression-bomb)
 * violations surface as the typed errors of @catlabtech/webcvt-archive-zip, and
 * page-embedding failures as the typed errors of @catlabtech/webcvt-doc-pdf
 * (with the unsupported-page case re-wrapped as ComicUnsupportedPageFormatError).
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the raw input exceeds MAX_INPUT_BYTES (512 MiB). */
export class ComicInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'COMIC_INPUT_TOO_LARGE',
      `Comic input is ${size} bytes; maximum supported is ${max} bytes (512 MiB).`,
    );
    this.name = 'ComicInputTooLargeError';
  }
}

/**
 * Thrown when the input is not a recognised comic container (its leading bytes
 * match neither the ZIP, RAR, nor 7z signature).
 */
export class ComicInvalidContainerError extends WebcvtError {
  constructor() {
    super(
      'COMIC_INVALID_CONTAINER',
      'Input is not a recognised comic container: expected a CBZ (ZIP), CBR (RAR), or CB7 (7z) archive.',
    );
    this.name = 'ComicInvalidContainerError';
  }
}

/**
 * Thrown for a CBR (RAR) container. RAR decoding requires a dedicated wasm
 * decoder which is deferred — like WOFF2 / bzip2 / xz elsewhere in webcvt.
 */
export class ComicRarNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'COMIC_RAR_NOT_SUPPORTED',
      'CBR (RAR) comics are not supported yet: RAR is a proprietary, patent-encumbered format that needs a dedicated wasm decoder (deferred). Convert the archive to CBZ (ZIP) first.',
    );
    this.name = 'ComicRarNotSupportedError';
  }
}

/**
 * Thrown for a CB7 (7z) container. 7z (LZMA/LZMA2) decoding requires a dedicated
 * wasm decoder which is deferred — like WOFF2 / bzip2 / xz elsewhere in webcvt.
 */
export class Comic7zNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'COMIC_7Z_NOT_SUPPORTED',
      'CB7 (7z) comics are not supported yet: 7z (LZMA/LZMA2) needs a dedicated wasm decoder (deferred). Convert the archive to CBZ (ZIP) first.',
    );
    this.name = 'Comic7zNotSupportedError';
  }
}

/** Thrown when a CBZ contains no image-page entries at all. */
export class ComicNoPagesError extends WebcvtError {
  constructor() {
    super(
      'COMIC_NO_PAGES',
      'CBZ archive contains no image pages (no entries ending in .jpg/.jpeg/.png/.gif/.webp/.bmp).',
    );
    this.name = 'ComicNoPagesError';
  }
}

/** Thrown when a CBZ declares more than MAX_PAGES image-page entries. */
export class ComicTooManyPagesError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'COMIC_TOO_MANY_PAGES',
      `CBZ archive contains ${count} image pages which exceeds the cap of ${max}.`,
    );
    this.name = 'ComicTooManyPagesError';
  }
}

/**
 * Thrown when a page's image format cannot be embedded into a PDF by
 * `imagesToPdf` (e.g. WebP, GIF, BMP, CMYK JPEG, or alpha/indexed PNG). Wraps
 * the underlying doc-pdf `DocPdfUnsupportedSourceError` as the `cause`.
 */
export class ComicUnsupportedPageFormatError extends WebcvtError {
  constructor(detail: string, options?: ErrorOptions) {
    super(
      'COMIC_UNSUPPORTED_PAGE_FORMAT',
      `A comic page could not be embedded into the PDF: ${detail} imagesToPdf embeds JPEG and opaque grayscale/RGB PNG only; transcode WebP, GIF, BMP, CMYK JPEG, or alpha/indexed PNG pages first.`,
      options,
    );
    this.name = 'ComicUnsupportedPageFormatError';
  }
}
