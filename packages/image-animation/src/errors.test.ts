import { WebcvtError } from '@catlabtech/webcvt-core';
import { describe, expect, it } from 'vitest';
import {
  AnimationUnsupportedFormatError,
  ApngBadCrcError,
  ApngBadSequenceError,
  ApngBadSignatureError,
  ApngChunkTooLargeError,
  ApngFdatTooShortError,
  ApngFirstFramePreviousError,
  ApngFrameCountMismatchError,
  ApngHiddenDefaultNotSupportedError,
  ApngTooShortError,
  ApngUnknownCriticalChunkError,
  ApngZeroFramesError,
  GifBadBlockIntroError,
  GifBadDimensionError,
  GifBadSignatureError,
  GifFrameOutOfBoundsError,
  GifLzwInvalidCodeError,
  GifLzwTruncatedError,
  GifNoPaletteError,
  GifTooManyColorsError,
  GifTooShortError,
  GifUnknownExtensionError,
  ImageInputTooLargeError,
  WebpAnimMissingVp8xError,
  WebpAnimOddOffsetError,
  WebpAnimTooShortError,
  WebpAnimUnknownChunkError,
  WebpAnmfTooShortError,
  WebpBadDimensionError,
  WebpBadRiffError,
  WebpChunkTooLargeError,
  WebpFrameOutOfBoundsError,
  WebpMissingSubFrameError,
  WebpStaticNotSupportedError,
  WebpVp8lBadSignatureError,
} from './errors.ts';

describe('errors', () => {
  it('ImageInputTooLargeError extends WebcvtError with correct code', () => {
    const e = new ImageInputTooLargeError(300 * 1024 * 1024, 200 * 1024 * 1024);
    expect(e).toBeInstanceOf(WebcvtError);
    expect(e.code).toBe('IMAGE_INPUT_TOO_LARGE');
    expect(e.name).toBe('ImageInputTooLargeError');
    expect(e.message).toContain('200 MiB');
  });

  it('AnimationUnsupportedFormatError has correct code', () => {
    const e = new AnimationUnsupportedFormatError('image/bmp');
    expect(e.code).toBe('ANIMATION_UNSUPPORTED_FORMAT');
    expect(e.name).toBe('AnimationUnsupportedFormatError');
  });

  it('GifTooShortError has correct code', () => {
    const e = new GifTooShortError(5);
    expect(e.code).toBe('GIF_TOO_SHORT');
    expect(e.name).toBe('GifTooShortError');
  });

  it('GifBadSignatureError includes the bad value', () => {
    const e = new GifBadSignatureError('GIFBAD');
    expect(e.code).toBe('GIF_BAD_SIGNATURE');
    expect(e.message).toContain('GIFBAD');
  });

  it('GifBadDimensionError specifies axis', () => {
    const e = new GifBadDimensionError('width', 0);
    expect(e.code).toBe('GIF_BAD_DIMENSION');
    expect(e.message).toContain('width');
  });

  it('GifNoPaletteError includes frame index', () => {
    const e = new GifNoPaletteError(3);
    expect(e.code).toBe('GIF_NO_PALETTE');
    expect(e.message).toContain('3');
  });

  it('GifFrameOutOfBoundsError specifies x or y', () => {
    const ex = new GifFrameOutOfBoundsError(0, 'x');
    expect(ex.message).toContain('width');
    const ey = new GifFrameOutOfBoundsError(0, 'y');
    expect(ey.message).toContain('height');
  });

  it('GifUnknownExtensionError includes hex label', () => {
    const e = new GifUnknownExtensionError(0xab);
    expect(e.code).toBe('GIF_UNKNOWN_EXTENSION');
    expect(e.message).toContain('ab');
  });

  it('GifBadBlockIntroError includes hex and offset', () => {
    const e = new GifBadBlockIntroError(0xdd, 42);
    expect(e.message).toContain('dd');
    expect(e.message).toContain('42');
  });

  it('GifLzwInvalidCodeError includes code', () => {
    const e = new GifLzwInvalidCodeError(999);
    expect(e.code).toBe('GIF_LZW_INVALID_CODE');
    expect(e.message).toContain('999');
  });

  it('GifLzwTruncatedError reports got vs expected', () => {
    const e = new GifLzwTruncatedError(100, 200);
    expect(e.code).toBe('GIF_LZW_TRUNCATED');
    expect(e.message).toContain('100');
    expect(e.message).toContain('200');
  });

  it('GifTooManyColorsError reports count', () => {
    const e = new GifTooManyColorsError(2, 512);
    expect(e.code).toBe('GIF_TOO_MANY_COLORS');
    expect(e.message).toContain('512');
  });

  it('ApngTooShortError has correct code', () => {
    const e = new ApngTooShortError(10);
    expect(e.code).toBe('APNG_TOO_SHORT');
    expect(e.name).toBe('ApngTooShortError');
  });

  it('ApngBadSignatureError has correct code', () => {
    const e = new ApngBadSignatureError();
    expect(e.code).toBe('APNG_BAD_SIGNATURE');
  });

  it('ApngBadCrcError includes chunk type and values', () => {
    const e = new ApngBadCrcError('IHDR', 8, 0xabcd, 0x1234);
    expect(e.code).toBe('APNG_BAD_CRC');
    expect(e.message).toContain('IHDR');
  });

  it('ApngChunkTooLargeError has correct code', () => {
    const e = new ApngChunkTooLargeError('IDAT', 999_999_999, 100 * 1024 * 1024);
    expect(e.code).toBe('APNG_CHUNK_TOO_LARGE');
  });

  it('ApngBadSequenceError reports expected vs got', () => {
    const e = new ApngBadSequenceError('fcTL', 3, 5);
    expect(e.code).toBe('APNG_BAD_SEQUENCE');
    expect(e.message).toContain('3');
    expect(e.message).toContain('5');
  });

  it('ApngFdatTooShortError has correct code', () => {
    const e = new ApngFdatTooShortError(2);
    expect(e.code).toBe('APNG_FDAT_TOO_SHORT');
  });

  it('ApngUnknownCriticalChunkError includes type', () => {
    const e = new ApngUnknownCriticalChunkError('ZZZZ');
    expect(e.code).toBe('APNG_UNKNOWN_CRITICAL_CHUNK');
    expect(e.message).toContain('ZZZZ');
  });

  it('ApngFrameCountMismatchError reports declared vs actual', () => {
    const e = new ApngFrameCountMismatchError(5, 3);
    expect(e.code).toBe('APNG_FRAME_COUNT_MISMATCH');
    expect(e.message).toContain('5');
    expect(e.message).toContain('3');
  });

  it('ApngHiddenDefaultNotSupportedError has correct code', () => {
    const e = new ApngHiddenDefaultNotSupportedError();
    expect(e.code).toBe('APNG_HIDDEN_DEFAULT_NOT_SUPPORTED');
  });

  it('ApngFirstFramePreviousError has correct code', () => {
    const e = new ApngFirstFramePreviousError();
    expect(e.code).toBe('APNG_FIRST_FRAME_PREVIOUS');
  });

  it('ApngZeroFramesError has correct code', () => {
    const e = new ApngZeroFramesError();
    expect(e.code).toBe('APNG_ZERO_FRAMES');
  });

  it('WebpAnimTooShortError has correct code', () => {
    const e = new WebpAnimTooShortError(10);
    expect(e.code).toBe('WEBP_ANIM_TOO_SHORT');
    expect(e.name).toBe('WebpAnimTooShortError');
  });

  it('WebpBadRiffError has correct code', () => {
    const e = new WebpBadRiffError('missing WEBP FourCC');
    expect(e.code).toBe('WEBP_BAD_RIFF');
    expect(e.message).toContain('missing WEBP FourCC');
  });

  it('WebpAnimMissingVp8xError includes got chunk', () => {
    const e = new WebpAnimMissingVp8xError('ANIM');
    expect(e.code).toBe('WEBP_ANIM_MISSING_VP8X');
    expect(e.message).toContain('ANIM');
  });

  it('WebpStaticNotSupportedError has correct code', () => {
    const e = new WebpStaticNotSupportedError();
    expect(e.code).toBe('WEBP_STATIC_NOT_SUPPORTED');
  });

  it('WebpChunkTooLargeError has correct code', () => {
    const e = new WebpChunkTooLargeError('ANMF', 999_999, 200 * 1024 * 1024);
    expect(e.code).toBe('WEBP_CHUNK_TOO_LARGE');
  });

  it('WebpAnimUnknownChunkError includes fourcc', () => {
    const e = new WebpAnimUnknownChunkError('ZZZZ', 100);
    expect(e.code).toBe('WEBP_ANIM_UNKNOWN_CHUNK');
    expect(e.message).toContain('ZZZZ');
  });

  it('WebpVp8lBadSignatureError includes got byte', () => {
    const e = new WebpVp8lBadSignatureError(0xab);
    expect(e.code).toBe('WEBP_VP8L_BAD_SIGNATURE');
    expect(e.message).toContain('ab');
  });

  it('WebpBadDimensionError specifies axis', () => {
    const e = new WebpBadDimensionError('height', 20000);
    expect(e.code).toBe('WEBP_BAD_DIMENSION');
    expect(e.message).toContain('height');
  });

  it('WebpFrameOutOfBoundsError specifies axis', () => {
    const ex = new WebpFrameOutOfBoundsError(0, 'x');
    expect(ex.message).toContain('width');
    const ey = new WebpFrameOutOfBoundsError(0, 'y');
    expect(ey.message).toContain('height');
  });

  it('WebpAnmfTooShortError has correct code', () => {
    const e = new WebpAnmfTooShortError(0, 10);
    expect(e.code).toBe('WEBP_ANMF_TOO_SHORT');
  });

  it('WebpAnimOddOffsetError includes axis and value', () => {
    const e = new WebpAnimOddOffsetError(1, 'x', 3);
    expect(e.code).toBe('WEBP_ANIM_ODD_OFFSET');
    expect(e.message).toContain('3');
  });

  it('WebpMissingSubFrameError has correct code', () => {
    const e = new WebpMissingSubFrameError(2);
    expect(e.code).toBe('WEBP_MISSING_SUB_FRAME');
  });

  it('all errors inherit from WebcvtError', () => {
    const errors = [
      new ImageInputTooLargeError(1, 2),
      new GifTooShortError(0),
      new GifBadSignatureError(''),
      new ApngTooShortError(0),
      new WebpAnimTooShortError(0),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(WebcvtError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
