import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  EpubInputTooLargeError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubMissingContainerError,
  EpubMissingContentError,
  EpubMissingOpfError,
  EpubOutputTooLargeError,
  EpubPathTraversalError,
  EpubTooManyManifestItemsError,
  EpubTooManySpineItemsError,
} from './errors.ts';

describe('typed errors', () => {
  const cases: Array<[WebcvtError, string, string]> = [
    [new EpubInputTooLargeError(10, 5), 'EPUB_INPUT_TOO_LARGE', 'EpubInputTooLargeError'],
    [
      new EpubInvalidMimetypeError('text/plain', 'application/epub+zip'),
      'EPUB_INVALID_MIMETYPE',
      'EpubInvalidMimetypeError',
    ],
    [
      new EpubMissingContainerError('META-INF/container.xml'),
      'EPUB_MISSING_CONTAINER',
      'EpubMissingContainerError',
    ],
    [
      new EpubInvalidContainerError('no rootfile'),
      'EPUB_INVALID_CONTAINER',
      'EpubInvalidContainerError',
    ],
    [new EpubMissingOpfError('OEBPS/content.opf'), 'EPUB_MISSING_OPF', 'EpubMissingOpfError'],
    [new EpubInvalidOpfError('no spine'), 'EPUB_INVALID_OPF', 'EpubInvalidOpfError'],
    [new EpubPathTraversalError('../x'), 'EPUB_PATH_TRAVERSAL', 'EpubPathTraversalError'],
    [
      new EpubMissingContentError('OEBPS/x.xhtml'),
      'EPUB_MISSING_CONTENT',
      'EpubMissingContentError',
    ],
    [
      new EpubTooManyManifestItemsError(11, 10),
      'EPUB_TOO_MANY_MANIFEST_ITEMS',
      'EpubTooManyManifestItemsError',
    ],
    [
      new EpubTooManySpineItemsError(6, 5),
      'EPUB_TOO_MANY_SPINE_ITEMS',
      'EpubTooManySpineItemsError',
    ],
    [new EpubOutputTooLargeError(10, 5), 'EPUB_OUTPUT_TOO_LARGE', 'EpubOutputTooLargeError'],
  ];

  it.each(cases)('%o has the right code/name and extends WebcvtError', (err, code, name) => {
    expect(err).toBeInstanceOf(WebcvtError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(err.name).toBe(name);
    expect(err.message.length).toBeGreaterThan(0);
  });
});
