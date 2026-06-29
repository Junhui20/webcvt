import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  FontCollectionNotSupportedError,
  FontCompressionUnavailableError,
  FontDecompressionError,
  FontInputTooLargeError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';

describe('font error classes', () => {
  const cases: Array<[WebcvtError, string, string]> = [
    [new FontInputTooLargeError(100, 64), 'FONT_INPUT_TOO_LARGE', 'FontInputTooLargeError'],
    [
      new FontInvalidSignatureError('bad magic'),
      'FONT_INVALID_SIGNATURE',
      'FontInvalidSignatureError',
    ],
    [new FontWoff2NotSupportedError(), 'FONT_WOFF2_NOT_SUPPORTED', 'FontWoff2NotSupportedError'],
    [
      new FontCollectionNotSupportedError(),
      'FONT_COLLECTION_NOT_SUPPORTED',
      'FontCollectionNotSupportedError',
    ],
    [new FontTooManyTablesError(5, 4), 'FONT_TOO_MANY_TABLES', 'FontTooManyTablesError'],
    [new FontMalformedError('truncated'), 'FONT_MALFORMED', 'FontMalformedError'],
    [new FontTableTooLargeError('too big'), 'FONT_TABLE_TOO_LARGE', 'FontTableTooLargeError'],
    [
      new FontDecompressionError('glyf', 'bad zlib'),
      'FONT_DECOMPRESSION_FAILED',
      'FontDecompressionError',
    ],
    [
      new FontCompressionUnavailableError('CompressionStream'),
      'FONT_COMPRESSION_UNAVAILABLE',
      'FontCompressionUnavailableError',
    ],
  ];

  it('all extend WebcvtError with UPPER_SNAKE codes, a name, and a non-empty message', () => {
    for (const [err, code, name] of cases) {
      expect(err).toBeInstanceOf(WebcvtError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.name).toBe(name);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});
