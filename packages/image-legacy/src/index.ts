/**
 * @webcvt/image-legacy — Public API
 *
 * Supported formats (first pass — Phase 4):
 *   PBM (P1/P4), PGM (P2/P5), PPM (P3/P6), PFM (Pf/PF), QOI.
 *
 * Deferred (Phase 4.5+): TIFF, TGA, PCX, XBM, XPM, ICNS, CUR.
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
} from './parser.ts';
export type { NetpbmMagic } from './netpbm.ts';

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
} from './errors.ts';
