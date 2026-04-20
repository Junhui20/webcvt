/**
 * @webcvt/image-animation — Public API
 *
 * Supported animated formats (first pass — Phase 4):
 *   GIF (GIF87a / GIF89a): full container walk + LZW pixel decode
 *   APNG (PNG with acTL/fcTL/fdAT): container walk, raw zlib payload output
 *   Animated WebP (RIFF/VP8X with animation flag): RIFF walk, raw VP8/VP8L output
 *
 * No cross-format conversion — each format is parse/serialize-only within its type.
 * No auto-detection inside parseAnimation — pass format explicitly.
 * No streaming — all operations are fully buffered.
 * GIF pixel decode is internal; APNG/WebP pixel decode deferred to backend-wasm.
 *
 * Security: 200 MiB input cap, MAX_FRAMES = 4096, dimension caps, CRC validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AnimationFormat,
  AnimationFrame,
  DisposalMethod,
  BlendMode,
  GifFile,
  ApngFile,
  WebpAnimFile,
  AnimationFile,
} from './types.ts';

// ---------------------------------------------------------------------------
// GIF API
// ---------------------------------------------------------------------------

export { parseGif, serializeGif } from './gif.ts';

// ---------------------------------------------------------------------------
// APNG API
// ---------------------------------------------------------------------------

export { parseApng, serializeApng } from './apng.ts';

// ---------------------------------------------------------------------------
// Animated WebP API
// ---------------------------------------------------------------------------

export { parseWebpAnim, serializeWebpAnim } from './webp-anim.ts';

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export { parseAnimation } from './parser.ts';
export { serializeAnimation } from './serializer.ts';
export { detectAnimationFormat } from './detect.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export {
  AnimationBackend,
  GIF_FORMAT,
  APNG_FORMAT,
  WEBP_ANIM_FORMAT,
} from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  ImageInputTooLargeError,
  AnimationUnsupportedFormatError,
  GifTooShortError,
  GifBadSignatureError,
  GifBadDimensionError,
  GifNoPaletteError,
  GifFrameOutOfBoundsError,
  GifUnknownExtensionError,
  GifBadBlockIntroError,
  GifLzwInvalidCodeError,
  GifLzwTruncatedError,
  GifTooManyColorsError,
  ApngTooShortError,
  ApngBadSignatureError,
  ApngBadCrcError,
  ApngChunkTooLargeError,
  ApngBadSequenceError,
  ApngFdatTooShortError,
  ApngUnknownCriticalChunkError,
  ApngFrameCountMismatchError,
  ApngHiddenDefaultNotSupportedError,
  ApngFirstFramePreviousError,
  ApngZeroFramesError,
  WebpAnimTooShortError,
  WebpBadRiffError,
  WebpAnimMissingVp8xError,
  WebpStaticNotSupportedError,
  WebpChunkTooLargeError,
  WebpAnimUnknownChunkError,
  WebpVp8lBadSignatureError,
  WebpBadDimensionError,
  WebpFrameOutOfBoundsError,
  WebpAnmfTooShortError,
  WebpAnimOddOffsetError,
  WebpMissingSubFrameError,
} from './errors.ts';
