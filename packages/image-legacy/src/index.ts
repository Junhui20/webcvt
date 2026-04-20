/**
 * @webcvt/image-legacy — Public API
 *
 * Supported formats (seventh pass — Phase 4.7):
 *   PBM (P1/P4), PGM (P2/P5), PPM (P3/P6), PFM (Pf/PF), QOI, TIFF, TGA, XBM, PCX, XPM, ICNS.
 *
 * Deferred (Phase 4.7+): CUR.
 *
 * No cross-format conversion: each format is parse/serialize-only within its type.
 * No auto-detection inside parseImage: pass format explicitly.
 * No streaming: all operations are fully buffered.
 * No colour-space interpretation: pixel values returned as raw samples.
 *
 * Security: 200 MiB input cap, dimension/pixel/pixel-byte caps validated before
 * typed-array allocation. Typed errors per format. Strict parsers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ImageFormat,
  ImageFile,
  PbmFile,
  PgmFile,
  PpmFile,
  PfmFile,
  QoiFile,
  TiffFile,
  TgaFile,
  XbmFile,
  PcxFile,
  XpmFile,
  IcnsFile,
} from './parser.ts';

// ---------------------------------------------------------------------------
// TIFF types (direct from tiff.ts)
// ---------------------------------------------------------------------------

export type {
  TiffByteOrder,
  TiffPhotometric,
  TiffCompression,
  TiffPredictor,
  TiffPlanarConfig,
  TiffOpaqueTag,
  TiffPage,
  TiffNormalisation,
} from './tiff.ts';
export type { NetpbmMagic } from './netpbm.ts';

// ---------------------------------------------------------------------------
// TGA types (direct from tga.ts)
// ---------------------------------------------------------------------------

export type {
  TgaImageType,
  TgaPixelDepth,
  TgaOrigin,
  TgaColorMapEntrySize,
  TgaColorMap,
  TgaNormalisation,
} from './tga.ts';

// ---------------------------------------------------------------------------
// XBM types (direct from xbm.ts)
// ---------------------------------------------------------------------------

export type { XbmHotspot } from './xbm.ts';

// ---------------------------------------------------------------------------
// XPM types (direct from xpm.ts)
// ---------------------------------------------------------------------------

export type { XpmHotspot } from './xpm.ts';

// ---------------------------------------------------------------------------
// PCX types (direct from pcx.ts)
// ---------------------------------------------------------------------------

export type {
  PcxVersion,
  PcxBitsPerPixel,
  PcxNPlanes,
  PcxKind,
  PcxNormalisation,
} from './pcx.ts';

// ---------------------------------------------------------------------------
// ICNS types (direct from icns.ts)
// ---------------------------------------------------------------------------

export type {
  IcnsIconKind,
  IcnsHighResSubFormat,
  IcnsFourCC,
  IcnsOpaqueElement,
  IcnsIcon,
  IcnsNormalisation,
} from './icns.ts';

// ---------------------------------------------------------------------------
// PBM API
// ---------------------------------------------------------------------------

export { parsePbm, serializePbm } from './netpbm.ts';

// ---------------------------------------------------------------------------
// PGM API
// ---------------------------------------------------------------------------

export { parsePgm, serializePgm } from './netpbm.ts';

// ---------------------------------------------------------------------------
// PPM API
// ---------------------------------------------------------------------------

export { parsePpm, serializePpm } from './netpbm.ts';

// ---------------------------------------------------------------------------
// PFM API
// ---------------------------------------------------------------------------

export { parsePfm, serializePfm } from './pfm.ts';

// ---------------------------------------------------------------------------
// QOI API
// ---------------------------------------------------------------------------

export { parseQoi, serializeQoi } from './qoi.ts';

// ---------------------------------------------------------------------------
// TIFF API
// ---------------------------------------------------------------------------

export {
  parseTiff,
  serializeTiff,
  serializeTiffWithNormalisations,
  packBitsDecode,
} from './tiff.ts';
export { lzwDecode } from './tiff-lzw.ts';

// ---------------------------------------------------------------------------
// TGA API
// ---------------------------------------------------------------------------

export { parseTga, serializeTga, decodeTgaRle, isTgaHeader } from './tga.ts';

// ---------------------------------------------------------------------------
// XBM API
// ---------------------------------------------------------------------------

export { parseXbm, serializeXbm, isXbmHeader } from './xbm.ts';

// ---------------------------------------------------------------------------
// PCX API
// ---------------------------------------------------------------------------

export { parsePcx, serializePcx, decodePcxRle } from './pcx.ts';

// ---------------------------------------------------------------------------
// XPM API
// ---------------------------------------------------------------------------

export { parseXpm, serializeXpm, isXpmHeader, isCIdentifier } from './xpm.ts';

// ---------------------------------------------------------------------------
// ICNS API
// ---------------------------------------------------------------------------

export { parseIcns, serializeIcns } from './icns.ts';

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export { parseImage } from './parser.ts';
export { serializeImage } from './serializer.ts';
export { detectImageFormat } from './detect.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export {
  ImageLegacyBackend,
  PBM_FORMAT,
  PGM_FORMAT,
  PPM_FORMAT,
  PFM_FORMAT,
  QOI_FORMAT,
  TIFF_FORMAT,
  TGA_FORMAT,
  XBM_FORMAT,
  PCX_FORMAT,
  XPM_FORMAT,
  ICNS_FORMAT,
} from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  ImageInputTooLargeError,
  ImagePixelCapError,
  PbmBadMagicError,
  PbmBadAsciiByteError,
  PbmSizeMismatchError,
  PgmBadMagicError,
  PgmBadMaxvalError,
  PgmSampleOutOfRangeError,
  PpmBadMagicError,
  PpmSampleOutOfRangeError,
  PfmBadMagicError,
  PfmBadScaleError,
  QoiTooShortError,
  QoiBadMagicError,
  QoiBadHeaderError,
  QoiMissingEndMarkerError,
  QoiSizeMismatchError,
  ImageUnsupportedFormatError,
  TiffBadMagicError,
  TiffUnsupportedFeatureError,
  TiffBadIfdError,
  TiffCircularIfdError,
  TiffTooManyPagesError,
  TiffBadTagValueError,
  TiffPackBitsDecodeError,
  TiffLzwDecodeError,
  TiffDeflateDecodeError,
  TgaBadHeaderError,
  TgaUnsupportedImageTypeError,
  TgaNoImageDataError,
  TgaUnsupportedFeatureError,
  TgaTruncatedError,
  TgaRleDecodeError,
  TgaBadFooterError,
  XbmBadHeaderError,
  XbmMissingDefineError,
  XbmPrefixMismatchError,
  XbmBadHexByteError,
  XbmSizeMismatchError,
  XbmBadIdentifierError,
  PcxBadMagicError,
  PcxBadVersionError,
  PcxBadEncodingError,
  PcxBadHeaderError,
  PcxUnsupportedFeatureError,
  PcxRleDecodeError,
  XpmBadHeaderError,
  XpmBadValuesError,
  XpmBadColorDefError,
  XpmBadHexColorError,
  XpmUnknownColorError,
  XpmDuplicateKeyError,
  XpmSizeMismatchError,
  XpmUnknownKeyError,
  XpmTooManyColorsError,
  IcnsBadMagicError,
  IcnsBadHeaderSizeError,
  IcnsBadElementError,
  IcnsTooManyElementsError,
  IcnsUnsupportedFeatureError,
  IcnsPackBitsDecodeError,
  IcnsMaskSizeMismatchError,
} from './errors.ts';
