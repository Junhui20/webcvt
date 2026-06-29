import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  Comic7zNotSupportedError,
  ComicInputTooLargeError,
  ComicInvalidContainerError,
  ComicNoPagesError,
  ComicRarNotSupportedError,
  ComicTooManyPagesError,
  ComicUnsupportedPageFormatError,
} from './errors.ts';

describe('typed errors', () => {
  it('all carry stable UPPER_SNAKE codes and subclass WebcvtError', () => {
    const cases: Array<[WebcvtError, string, string]> = [
      [new ComicInputTooLargeError(10, 5), 'COMIC_INPUT_TOO_LARGE', 'ComicInputTooLargeError'],
      [new ComicInvalidContainerError(), 'COMIC_INVALID_CONTAINER', 'ComicInvalidContainerError'],
      [new ComicRarNotSupportedError(), 'COMIC_RAR_NOT_SUPPORTED', 'ComicRarNotSupportedError'],
      [new Comic7zNotSupportedError(), 'COMIC_7Z_NOT_SUPPORTED', 'Comic7zNotSupportedError'],
      [new ComicNoPagesError(), 'COMIC_NO_PAGES', 'ComicNoPagesError'],
      [new ComicTooManyPagesError(6, 5), 'COMIC_TOO_MANY_PAGES', 'ComicTooManyPagesError'],
      [
        new ComicUnsupportedPageFormatError('detail'),
        'COMIC_UNSUPPORTED_PAGE_FORMAT',
        'ComicUnsupportedPageFormatError',
      ],
    ];
    for (const [err, code, name] of cases) {
      expect(err).toBeInstanceOf(WebcvtError);
      expect(err.code).toBe(code);
      expect(err.name).toBe(name);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('preserves the cause on ComicUnsupportedPageFormatError', () => {
    const cause = new Error('boom');
    const err = new ComicUnsupportedPageFormatError('detail', { cause });
    expect(err.cause).toBe(cause);
  });
});
