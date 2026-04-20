/**
 * Typed error classes for @webcvt/image-legacy.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error from image-legacy — always use a typed subclass.
 */

import { WebcvtError } from '@webcvt/core';

// ---------------------------------------------------------------------------
// Universal errors
// ---------------------------------------------------------------------------

/** Thrown when the raw input exceeds MAX_INPUT_BYTES (200 MiB). */
export class ImageInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'IMAGE_INPUT_TOO_LARGE',
      `Image input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'ImageInputTooLargeError';
  }
}

/** Thrown when pixel count or pixel-byte count exceeds a security cap. */
export class ImagePixelCapError extends WebcvtError {
  constructor(message: string) {
    super('IMAGE_PIXEL_CAP_EXCEEDED', message);
    this.name = 'ImagePixelCapError';
  }
}

// ---------------------------------------------------------------------------
// PBM errors
// ---------------------------------------------------------------------------

/** Thrown when a PBM file has an unrecognized magic number. */
export class PbmBadMagicError extends WebcvtError {
  constructor(magic: string) {
    super('PBM_BAD_MAGIC', `PBM: expected magic P1 or P4, got "${magic}".`);
    this.name = 'PbmBadMagicError';
  }
}

/** Thrown when a P1 ASCII raster contains a byte that is not '0' or '1'. */
export class PbmBadAsciiByteError extends WebcvtError {
  constructor(byte: number) {
    super(
      'PBM_BAD_ASCII_BYTE',
      `PBM P1: raster contains invalid byte 0x${byte.toString(16).padStart(2, '0')} — only '0' (0x30) and '1' (0x31) are allowed.`,
    );
    this.name = 'PbmBadAsciiByteError';
  }
}

/** Thrown when a PBM raster has fewer or more samples than width × height. */
export class PbmSizeMismatchError extends WebcvtError {
  constructor(got: number, expected: number) {
    super('PBM_SIZE_MISMATCH', `PBM: raster has ${got} pixels but header declares ${expected}.`);
    this.name = 'PbmSizeMismatchError';
  }
}

// ---------------------------------------------------------------------------
// PGM errors
// ---------------------------------------------------------------------------

/** Thrown when a PGM file has an unrecognized magic number. */
export class PgmBadMagicError extends WebcvtError {
  constructor(magic: string) {
    super('PGM_BAD_MAGIC', `PGM: expected magic P2 or P5, got "${magic}".`);
    this.name = 'PgmBadMagicError';
  }
}

/** Thrown when the PGM maxval token is out of the valid range [1, 65535]. */
export class PgmBadMaxvalError extends WebcvtError {
  constructor(maxval: number) {
    super('PGM_BAD_MAXVAL', `PGM: maxval ${maxval} is out of range [1, 65535].`);
    this.name = 'PgmBadMaxvalError';
  }
}

/** Thrown when a PGM sample value exceeds maxval. */
export class PgmSampleOutOfRangeError extends WebcvtError {
  constructor(sample: number, maxval: number) {
    super('PGM_SAMPLE_OUT_OF_RANGE', `PGM: sample value ${sample} exceeds maxval ${maxval}.`);
    this.name = 'PgmSampleOutOfRangeError';
  }
}

// ---------------------------------------------------------------------------
// PPM errors
// ---------------------------------------------------------------------------

/** Thrown when a PPM file has an unrecognized magic number. */
export class PpmBadMagicError extends WebcvtError {
  constructor(magic: string) {
    super('PPM_BAD_MAGIC', `PPM: expected magic P3 or P6, got "${magic}".`);
    this.name = 'PpmBadMagicError';
  }
}

/** Thrown when a PPM sample value exceeds maxval. */
export class PpmSampleOutOfRangeError extends WebcvtError {
  constructor(sample: number, maxval: number) {
    super('PPM_SAMPLE_OUT_OF_RANGE', `PPM: sample value ${sample} exceeds maxval ${maxval}.`);
    this.name = 'PpmSampleOutOfRangeError';
  }
}

// ---------------------------------------------------------------------------
// PFM errors
// ---------------------------------------------------------------------------

/** Thrown when a PFM file has an unrecognized magic number. */
export class PfmBadMagicError extends WebcvtError {
  constructor(magic: string) {
    super('PFM_BAD_MAGIC', `PFM: expected magic Pf or PF, got "${magic}".`);
    this.name = 'PfmBadMagicError';
  }
}

/** Thrown when the PFM scale token is zero, NaN, or infinite. */
export class PfmBadScaleError extends WebcvtError {
  constructor(token: string) {
    super(
      'PFM_BAD_SCALE',
      `PFM: scale token "${token}" is invalid — must be a finite non-zero decimal float.`,
    );
    this.name = 'PfmBadScaleError';
  }
}

// ---------------------------------------------------------------------------
// QOI errors
// ---------------------------------------------------------------------------

/** Thrown when QOI input is shorter than the minimum valid size (header + end marker). */
export class QoiTooShortError extends WebcvtError {
  constructor(length: number) {
    super(
      'QOI_TOO_SHORT',
      `QOI: input is ${length} bytes; minimum valid size is 22 bytes (14-byte header + 8-byte end marker).`,
    );
    this.name = 'QoiTooShortError';
  }
}

/** Thrown when the QOI magic bytes do not match "qoif". */
export class QoiBadMagicError extends WebcvtError {
  constructor() {
    super('QOI_BAD_MAGIC', 'QOI: magic bytes do not match "qoif" (0x71 0x6F 0x69 0x66).');
    this.name = 'QoiBadMagicError';
  }
}

/** Thrown when QOI header byte 12 (channels) or byte 13 (colorspace) is invalid. */
export class QoiBadHeaderError extends WebcvtError {
  constructor(field: 'channels' | 'colorspace', value: number) {
    const valid = field === 'channels' ? '{3, 4}' : '{0, 1}';
    super(
      'QOI_BAD_HEADER',
      `QOI: header field "${field}" has invalid value ${value}; expected one of ${valid}.`,
    );
    this.name = 'QoiBadHeaderError';
  }
}

/** Thrown when the 8-byte end marker [0,0,0,0,0,0,0,1] is missing or corrupt. */
export class QoiMissingEndMarkerError extends WebcvtError {
  constructor() {
    super(
      'QOI_MISSING_END_MARKER',
      'QOI: the 8-byte end marker [0,0,0,0,0,0,0,1] is missing or corrupt.',
    );
    this.name = 'QoiMissingEndMarkerError';
  }
}

/** Thrown when the decoded pixel count or stream position does not match expectations. */
export class QoiSizeMismatchError extends WebcvtError {
  constructor(message: string) {
    super('QOI_SIZE_MISMATCH', `QOI: ${message}`);
    this.name = 'QoiSizeMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Backend error
// ---------------------------------------------------------------------------

/** Thrown when the backend is called with an unsupported MIME. */
export class ImageUnsupportedFormatError extends WebcvtError {
  constructor(mime: string) {
    super('IMAGE_UNSUPPORTED_FORMAT', `image-legacy does not support MIME '${mime}'.`);
    this.name = 'ImageUnsupportedFormatError';
  }
}

// ---------------------------------------------------------------------------
// TIFF errors
// ---------------------------------------------------------------------------

/** Thrown when the first 4 bytes do not match II*\0 or MM\0*. */
export class TiffBadMagicError extends WebcvtError {
  constructor() {
    super('TIFF_BAD_MAGIC', 'TIFF: first 4 bytes do not match II*\\0 (LE) or MM\\0* (BE).');
    this.name = 'TiffBadMagicError';
  }
}

/**
 * Thrown when an unsupported TIFF feature is encountered (BigTIFF, tiles,
 * JPEG-in-TIFF, CMYK/YCbCr, CCITT, unsupported photometric, etc.).
 */
export class TiffUnsupportedFeatureError extends WebcvtError {
  constructor(feature: string) {
    super('TIFF_UNSUPPORTED_FEATURE', `TIFF: unsupported feature "${feature}".`);
    this.name = 'TiffUnsupportedFeatureError';
  }
}

/**
 * Thrown when an IFD is malformed (declares too many entries, offset past EOF,
 * or other structural violation).
 */
export class TiffBadIfdError extends WebcvtError {
  constructor(message: string) {
    super('TIFF_BAD_IFD', `TIFF: bad IFD — ${message}`);
    this.name = 'TiffBadIfdError';
  }
}

/** Thrown when the NextIFDOffset chain revisits a prior offset (cycle detected). */
export class TiffCircularIfdError extends WebcvtError {
  constructor(offset: number) {
    super('TIFF_CIRCULAR_IFD', `TIFF: circular IFD chain detected at offset ${offset}.`);
    this.name = 'TiffCircularIfdError';
  }
}

/** Thrown when the IFD chain exceeds MAX_PAGES. */
export class TiffTooManyPagesError extends WebcvtError {
  constructor(max: number) {
    super('TIFF_TOO_MANY_PAGES', `TIFF: page count exceeds maximum (${max}).`);
    this.name = 'TiffTooManyPagesError';
  }
}

/**
 * Thrown when a required IFD tag is missing, has the wrong type, or carries
 * an invalid value.
 */
export class TiffBadTagValueError extends WebcvtError {
  constructor(tag: number | string, message: string) {
    super('TIFF_BAD_TAG_VALUE', `TIFF: tag ${tag} — ${message}`);
    this.name = 'TiffBadTagValueError';
  }
}

/** Thrown when PackBits decompression encounters corrupt data. */
export class TiffPackBitsDecodeError extends WebcvtError {
  constructor(message: string) {
    super('TIFF_PACKBITS_DECODE', `TIFF PackBits: ${message}`);
    this.name = 'TiffPackBitsDecodeError';
  }
}

/**
 * Thrown when LZW decompression encounters an invalid code, a code before
 * ClearCode, or output that would exceed the expansion cap.
 */
export class TiffLzwDecodeError extends WebcvtError {
  constructor(message: string) {
    super('TIFF_LZW_DECODE', `TIFF LZW: ${message}`);
    this.name = 'TiffLzwDecodeError';
  }
}

/** Thrown when DEFLATE decompression fails (deferred feature). */
export class TiffDeflateDecodeError extends WebcvtError {
  constructor(message: string) {
    super('TIFF_DEFLATE_DECODE', `TIFF DEFLATE: ${message}`);
    this.name = 'TiffDeflateDecodeError';
  }
}
