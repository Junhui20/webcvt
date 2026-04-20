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
// XBM errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the first non-whitespace tokens in a candidate XBM file do not
 * match `#define <prefix>_width <decimal>`.
 */
export class XbmBadHeaderError extends WebcvtError {
  constructor(message: string) {
    super('XBM_BAD_HEADER', `XBM: bad header — ${message}`);
    this.name = 'XbmBadHeaderError';
  }
}

/**
 * Thrown when a required `#define` (`_width`, `_height`) is absent or appears
 * out of order, or when exactly one of `_x_hot`/`_y_hot` is present (XOR).
 */
export class XbmMissingDefineError extends WebcvtError {
  constructor(define: string) {
    super('XBM_MISSING_DEFINE', `XBM: required #define "${define}" is missing or out of order.`);
    this.name = 'XbmMissingDefineError';
  }
}

/**
 * Thrown when the identifier prefix extracted from `_width` does not match the
 * prefix used in `_height`, `_bits`, `_x_hot`, or `_y_hot`.
 */
export class XbmPrefixMismatchError extends WebcvtError {
  constructor(expected: string, got: string, define: string) {
    super(
      'XBM_PREFIX_MISMATCH',
      `XBM: prefix mismatch in "${define}" — expected "${expected}", got "${got}".`,
    );
    this.name = 'XbmPrefixMismatchError';
  }
}

/**
 * Thrown when a token inside the `{...}` hex-byte array is not a valid
 * `0x[0-9a-fA-F]{1,2}` literal, or its value exceeds 0xFF.
 */
export class XbmBadHexByteError extends WebcvtError {
  constructor(token: string) {
    super(
      'XBM_BAD_HEX_BYTE',
      `XBM: invalid hex byte token "${token}"; expected 0x00..0xFF (1-2 hex digits).`,
    );
    this.name = 'XbmBadHexByteError';
  }
}

/**
 * Thrown when the number of hex bytes in the array does not equal
 * `height * ceil(width / 8)`.
 */
export class XbmSizeMismatchError extends WebcvtError {
  constructor(got: number, expected: number) {
    super(
      'XBM_SIZE_MISMATCH',
      `XBM: hex-byte count ${got} does not match expected ${expected} (height × ceil(width/8)).`,
    );
    this.name = 'XbmSizeMismatchError';
  }
}

/**
 * Thrown when the identifier prefix is empty, contains invalid characters, or
 * exceeds XBM_MAX_IDENTIFIER_LENGTH.
 */
export class XbmBadIdentifierError extends WebcvtError {
  constructor(message: string) {
    super('XBM_BAD_IDENTIFIER', `XBM: invalid identifier — ${message}`);
    this.name = 'XbmBadIdentifierError';
  }
}

// ---------------------------------------------------------------------------
// PCX errors
// ---------------------------------------------------------------------------

/** Thrown when byte 0 of a PCX file is not 0x0A. */
export class PcxBadMagicError extends WebcvtError {
  constructor(got: number) {
    super(
      'PCX_BAD_MAGIC',
      `PCX: expected manufacturer byte 0x0A, got 0x${got.toString(16).padStart(2, '0')}.`,
    );
    this.name = 'PcxBadMagicError';
  }
}

/** Thrown when the PCX version byte is not in {0, 2, 3, 4, 5}. */
export class PcxBadVersionError extends WebcvtError {
  constructor(version: number) {
    super(
      'PCX_BAD_VERSION',
      `PCX: version ${version} is not supported; expected one of {0, 2, 3, 4, 5}.`,
    );
    this.name = 'PcxBadVersionError';
  }
}

/** Thrown when the PCX encoding byte is not 1 (RLE). */
export class PcxBadEncodingError extends WebcvtError {
  constructor(encoding: number) {
    super(
      'PCX_BAD_ENCODING',
      `PCX: encoding ${encoding} is not supported; only encoding 1 (RLE) is valid.`,
    );
    this.name = 'PcxBadEncodingError';
  }
}

/**
 * Thrown when the PCX header is structurally invalid:
 * Xmax < Xmin, Ymax < Ymin, BytesPerLine odd, or BytesPerLine too small.
 */
export class PcxBadHeaderError extends WebcvtError {
  constructor(message: string) {
    super('PCX_BAD_HEADER', `PCX: bad header — ${message}`);
    this.name = 'PcxBadHeaderError';
  }
}

/** Thrown when the (BitsPerPixel, NPlanes) combination is not supported. */
export class PcxUnsupportedFeatureError extends WebcvtError {
  constructor(feature: string) {
    super('PCX_UNSUPPORTED_FEATURE', `PCX: unsupported feature — ${feature}`);
    this.name = 'PcxUnsupportedFeatureError';
  }
}

/** Thrown when PCX RLE decoding encounters an input underrun, output overflow, or illegal zero-length run. */
export class PcxRleDecodeError extends WebcvtError {
  constructor(kind: 'input-underrun' | 'output-overflow' | 'zero-length-run') {
    const msg =
      kind === 'input-underrun'
        ? 'RLE input exhausted before expected byte count was reached.'
        : kind === 'output-overflow'
          ? 'RLE packet would write past the output buffer boundary.'
          : 'RLE run header 0xC0 has count=0 (spec range is 1..63); rejecting to prevent unbounded decode loop.';
    super('PCX_RLE_DECODE', `PCX RLE: ${msg}`);
    this.name = 'PcxRleDecodeError';
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

// ---------------------------------------------------------------------------
// TGA errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the TGA 18-byte header is malformed:
 * fewer than 18 bytes, reserved bits 6-7 of byte 17 set, or zero dimensions.
 */
export class TgaBadHeaderError extends WebcvtError {
  constructor(message: string) {
    super('TGA_BAD_HEADER', `TGA: bad header — ${message}`);
    this.name = 'TgaBadHeaderError';
  }
}

/**
 * Thrown when imageType is not in {1, 2, 3, 9, 10, 11}.
 * Type 32/33 also triggers this (they are exotic Huffman/Delta/RLE variants).
 */
export class TgaUnsupportedImageTypeError extends WebcvtError {
  constructor(imageType: number) {
    super(
      'TGA_UNSUPPORTED_IMAGE_TYPE',
      `TGA: image type ${imageType} is not supported; expected one of {1, 2, 3, 9, 10, 11}.`,
    );
    this.name = 'TgaUnsupportedImageTypeError';
  }
}

/** Thrown when imageType === 0 (no image data). */
export class TgaNoImageDataError extends WebcvtError {
  constructor() {
    super('TGA_NO_IMAGE_DATA', 'TGA: image type 0 indicates no image data.');
    this.name = 'TgaNoImageDataError';
  }
}

/**
 * Thrown when an unsupported feature is encountered: 15/16-bit palette entries,
 * type 32/33, or (imageType, pixelDepth) pair that is not a legal combination.
 */
export class TgaUnsupportedFeatureError extends WebcvtError {
  constructor(feature: string) {
    super('TGA_UNSUPPORTED_FEATURE', `TGA: unsupported feature — ${feature}`);
    this.name = 'TgaUnsupportedFeatureError';
  }
}

/** Thrown when the raster byte range extends past the input buffer. */
export class TgaTruncatedError extends WebcvtError {
  constructor(message: string) {
    super('TGA_TRUNCATED', `TGA: truncated input — ${message}`);
    this.name = 'TgaTruncatedError';
  }
}

/**
 * Thrown when RLE decoding would write past the pre-allocated output buffer,
 * or when the input is exhausted before enough pixels are decoded.
 */
export class TgaRleDecodeError extends WebcvtError {
  constructor(kind: 'output-overflow' | 'input-underrun') {
    const msg =
      kind === 'output-overflow'
        ? 'RLE packet would write past the output buffer boundary.'
        : 'RLE input exhausted before expected pixel count was reached.';
    super('TGA_RLE_DECODE', `TGA RLE: ${msg}`);
    this.name = 'TgaRleDecodeError';
  }
}

/**
 * Thrown when the last 26 bytes partially match the TGA 2.0 footer signature
 * but the footer is malformed (e.g., reserved bytes non-zero).
 */
export class TgaBadFooterError extends WebcvtError {
  constructor(message: string) {
    super('TGA_BAD_FOOTER', `TGA: bad footer — ${message}`);
    this.name = 'TgaBadFooterError';
  }
}
