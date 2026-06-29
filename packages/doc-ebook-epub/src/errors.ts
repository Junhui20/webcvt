/**
 * Typed error classes for @catlabtech/webcvt-doc-ebook-epub.
 *
 * Every error code is an UPPER_SNAKE_CASE string for programmatic matching.
 * Never throw a bare Error or a bare WebcvtError from this package — always use
 * one of the typed subclasses below. ZIP-level (zip-slip, decompression-bomb)
 * and XML-level (XXE, billion-laughs) violations surface as the typed errors of
 * @catlabtech/webcvt-archive-zip and @catlabtech/webcvt-data-text respectively.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the raw input exceeds MAX_INPUT_BYTES (256 MiB). */
export class EpubInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'EPUB_INPUT_TOO_LARGE',
      `EPUB input is ${size} bytes; maximum supported is ${max} bytes (256 MiB).`,
    );
    this.name = 'EpubInputTooLargeError';
  }
}

/**
 * Thrown when the OCF `mimetype` entry is present but does not equal
 * "application/epub+zip". An absent `mimetype` entry is tolerated.
 */
export class EpubInvalidMimetypeError extends WebcvtError {
  constructor(declared: string, expected: string) {
    super(
      'EPUB_INVALID_MIMETYPE',
      `EPUB OCF mimetype entry is "${declared}" but must equal "${expected}".`,
    );
    this.name = 'EpubInvalidMimetypeError';
  }
}

/** Thrown when `META-INF/container.xml` is missing from the OCF ZIP. */
export class EpubMissingContainerError extends WebcvtError {
  constructor(path: string) {
    super(
      'EPUB_MISSING_CONTAINER',
      `EPUB is missing the required OCF container descriptor "${path}".`,
    );
    this.name = 'EpubMissingContainerError';
  }
}

/**
 * Thrown when `container.xml` contains no usable `<rootfile>` pointing at an
 * OPF package document.
 */
export class EpubInvalidContainerError extends WebcvtError {
  constructor(detail: string) {
    super('EPUB_INVALID_CONTAINER', `EPUB OCF container.xml is invalid: ${detail}`);
    this.name = 'EpubInvalidContainerError';
  }
}

/** Thrown when the OPF package document referenced by container.xml is absent. */
export class EpubMissingOpfError extends WebcvtError {
  constructor(path: string) {
    super(
      'EPUB_MISSING_OPF',
      `EPUB OPF package document "${path}" was not found inside the container.`,
    );
    this.name = 'EpubMissingOpfError';
  }
}

/**
 * Thrown when the OPF package document is structurally invalid (missing the
 * `<package>`, `<metadata>`, `<manifest>`, or `<spine>` element, or referencing
 * an unknown manifest id from the spine).
 */
export class EpubInvalidOpfError extends WebcvtError {
  constructor(detail: string) {
    super('EPUB_INVALID_OPF', `EPUB OPF package document is invalid: ${detail}`);
    this.name = 'EpubInvalidOpfError';
  }
}

/**
 * Thrown when a manifest/spine href resolves outside the OCF (ZIP) root via
 * `../` path traversal — a defence in addition to archive-zip's zip-slip guard.
 */
export class EpubPathTraversalError extends WebcvtError {
  constructor(href: string) {
    super(
      'EPUB_PATH_TRAVERSAL',
      `EPUB href "${href}" resolves outside the container root and was rejected.`,
    );
    this.name = 'EpubPathTraversalError';
  }
}

/** Thrown when a resolved spine document is not present in the container. */
export class EpubMissingContentError extends WebcvtError {
  constructor(path: string) {
    super(
      'EPUB_MISSING_CONTENT',
      `EPUB spine references content document "${path}" which is not in the container.`,
    );
    this.name = 'EpubMissingContentError';
  }
}

/** Thrown when the OPF manifest declares more than MAX_MANIFEST_ITEMS items. */
export class EpubTooManyManifestItemsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'EPUB_TOO_MANY_MANIFEST_ITEMS',
      `EPUB manifest declares ${count} items which exceeds the cap of ${max}.`,
    );
    this.name = 'EpubTooManyManifestItemsError';
  }
}

/** Thrown when the OPF spine declares more than MAX_SPINE_ITEMS itemrefs. */
export class EpubTooManySpineItemsError extends WebcvtError {
  constructor(count: number, max: number) {
    super(
      'EPUB_TOO_MANY_SPINE_ITEMS',
      `EPUB spine declares ${count} itemrefs which exceeds the cap of ${max}.`,
    );
    this.name = 'EpubTooManySpineItemsError';
  }
}

/**
 * Thrown when a concatenated text/html conversion output would exceed
 * MAX_TOTAL_TEXT_BYTES.
 */
export class EpubOutputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'EPUB_OUTPUT_TOO_LARGE',
      `EPUB conversion output reached ${size} bytes which exceeds the cap of ${max} (64 MiB).`,
    );
    this.name = 'EpubOutputTooLargeError';
  }
}
