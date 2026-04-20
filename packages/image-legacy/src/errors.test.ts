import { describe, expect, it } from 'vitest';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  ImageUnsupportedFormatError,
  PbmBadAsciiByteError,
  PbmBadMagicError,
  PbmSizeMismatchError,
  PfmBadMagicError,
  PfmBadScaleError,
  PgmBadMagicError,
  PgmBadMaxvalError,
  PgmSampleOutOfRangeError,
  PpmBadMagicError,
  PpmSampleOutOfRangeError,
  QoiBadHeaderError,
  QoiBadMagicError,
  QoiMissingEndMarkerError,
  QoiSizeMismatchError,
  QoiTooShortError,
} from './errors.ts';

describe('errors', () => {
  it('ImageInputTooLargeError has correct code and name', () => {
    const e = new ImageInputTooLargeError(100, 50);
    expect(e.code).toBe('IMAGE_INPUT_TOO_LARGE');
    expect(e.name).toBe('ImageInputTooLargeError');
    expect(e instanceof ImageInputTooLargeError).toBe(true);
  });

  it('ImagePixelCapError has correct code', () => {
    const e = new ImagePixelCapError('too big');
    expect(e.code).toBe('IMAGE_PIXEL_CAP_EXCEEDED');
    expect(e.name).toBe('ImagePixelCapError');
  });

  it('PbmBadMagicError includes magic in message', () => {
    const e = new PbmBadMagicError('P9');
    expect(e.message).toContain('P9');
    expect(e.code).toBe('PBM_BAD_MAGIC');
  });

  it('PbmBadAsciiByteError includes byte in message', () => {
    const e = new PbmBadAsciiByteError(0x32);
    expect(e.message).toContain('32');
    expect(e.code).toBe('PBM_BAD_ASCII_BYTE');
  });

  it('PbmSizeMismatchError has correct code', () => {
    const e = new PbmSizeMismatchError(4, 8);
    expect(e.code).toBe('PBM_SIZE_MISMATCH');
  });

  it('PgmBadMagicError has correct code', () => {
    const e = new PgmBadMagicError('P9');
    expect(e.code).toBe('PGM_BAD_MAGIC');
  });

  it('PgmBadMaxvalError has correct code', () => {
    const e = new PgmBadMaxvalError(0);
    expect(e.code).toBe('PGM_BAD_MAXVAL');
  });

  it('PgmSampleOutOfRangeError has correct code', () => {
    const e = new PgmSampleOutOfRangeError(300, 255);
    expect(e.code).toBe('PGM_SAMPLE_OUT_OF_RANGE');
  });

  it('PpmBadMagicError has correct code', () => {
    const e = new PpmBadMagicError('P9');
    expect(e.code).toBe('PPM_BAD_MAGIC');
  });

  it('PpmSampleOutOfRangeError has correct code', () => {
    const e = new PpmSampleOutOfRangeError(300, 255);
    expect(e.code).toBe('PPM_SAMPLE_OUT_OF_RANGE');
  });

  it('PfmBadMagicError has correct code', () => {
    const e = new PfmBadMagicError('P1');
    expect(e.code).toBe('PFM_BAD_MAGIC');
  });

  it('PfmBadScaleError includes token in message', () => {
    const e = new PfmBadScaleError('0');
    expect(e.message).toContain('0');
    expect(e.code).toBe('PFM_BAD_SCALE');
  });

  it('QoiTooShortError has correct code', () => {
    const e = new QoiTooShortError(10);
    expect(e.code).toBe('QOI_TOO_SHORT');
  });

  it('QoiBadMagicError has correct code', () => {
    const e = new QoiBadMagicError();
    expect(e.code).toBe('QOI_BAD_MAGIC');
  });

  it('QoiBadHeaderError includes field and value', () => {
    const e = new QoiBadHeaderError('channels', 2);
    expect(e.message).toContain('channels');
    expect(e.message).toContain('2');
    expect(e.code).toBe('QOI_BAD_HEADER');
  });

  it('QoiMissingEndMarkerError has correct code', () => {
    const e = new QoiMissingEndMarkerError();
    expect(e.code).toBe('QOI_MISSING_END_MARKER');
  });

  it('QoiSizeMismatchError has correct code', () => {
    const e = new QoiSizeMismatchError('pos mismatch');
    expect(e.code).toBe('QOI_SIZE_MISMATCH');
  });

  it('ImageUnsupportedFormatError has correct code', () => {
    const e = new ImageUnsupportedFormatError('image/tiff');
    expect(e.code).toBe('IMAGE_UNSUPPORTED_FORMAT');
  });

  it('all errors are instanceof Error', () => {
    expect(new ImageInputTooLargeError(1, 1) instanceof Error).toBe(true);
    expect(new QoiMissingEndMarkerError() instanceof Error).toBe(true);
    expect(new PfmBadScaleError('0') instanceof Error).toBe(true);
  });
});
