/**
 * Typed error classes for @catlabtech/webcvt-image-animation.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error from image-animation — always use a typed subclass.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// Universal / shared errors
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

/** Thrown when the animation backend receives an unsupported MIME. */
export class AnimationUnsupportedFormatError extends WebcvtError {
  constructor(mime: string) {
    super('ANIMATION_UNSUPPORTED_FORMAT', `image-animation does not support MIME '${mime}'.`);
    this.name = 'AnimationUnsupportedFormatError';
  }
}

// ---------------------------------------------------------------------------
// GIF errors
// ---------------------------------------------------------------------------

/** Thrown when a GIF input is shorter than the minimum valid size. */
export class GifTooShortError extends WebcvtError {
  constructor(length: number) {
    super('GIF_TOO_SHORT', `GIF: input is ${length} bytes; minimum valid GIF is 14 bytes.`);
    this.name = 'GifTooShortError';
  }
}

/** Thrown when the first 6 bytes are not 'GIF87a' or 'GIF89a'. */
export class GifBadSignatureError extends WebcvtError {
  constructor(got: string) {
    super('GIF_BAD_SIGNATURE', `GIF: expected signature 'GIF87a' or 'GIF89a', got '${got}'.`);
    this.name = 'GifBadSignatureError';
  }
}

/** Thrown when the canvas dimensions are out of valid range. */
export class GifBadDimensionError extends WebcvtError {
  constructor(axis: 'width' | 'height', value: number) {
    super('GIF_BAD_DIMENSION', `GIF: canvas ${axis} ${value} is out of range [1, 16384].`);
    this.name = 'GifBadDimensionError';
  }
}

/** Thrown when a frame has no usable palette (no GCT and no LCT). */
export class GifNoPaletteError extends WebcvtError {
  constructor(frameIndex: number) {
    super(
      'GIF_NO_PALETTE',
      `GIF: frame ${frameIndex} has no Local Color Table and the file has no Global Color Table.`,
    );
    this.name = 'GifNoPaletteError';
  }
}

/** Thrown when a frame extends outside the canvas. */
export class GifFrameOutOfBoundsError extends WebcvtError {
  constructor(frameIndex: number, axis: 'x' | 'y') {
    super(
      'GIF_FRAME_OUT_OF_BOUNDS',
      `GIF: frame ${frameIndex} extends beyond the canvas ${axis === 'x' ? 'width' : 'height'}.`,
    );
    this.name = 'GifFrameOutOfBoundsError';
  }
}

/** Thrown when the GIF block stream contains an unknown extension label. */
export class GifUnknownExtensionError extends WebcvtError {
  constructor(label: number) {
    super(
      'GIF_UNKNOWN_EXTENSION',
      `GIF: unknown extension label 0x${label.toString(16).padStart(2, '0')}.`,
    );
    this.name = 'GifUnknownExtensionError';
  }
}

/** Thrown when an unrecognized block introducer byte is encountered. */
export class GifBadBlockIntroError extends WebcvtError {
  constructor(intro: number, offset: number) {
    super(
      'GIF_BAD_BLOCK_INTRO',
      `GIF: unexpected block introducer 0x${intro.toString(16).padStart(2, '0')} at offset ${offset}.`,
    );
    this.name = 'GifBadBlockIntroError';
  }
}

/** Thrown when LZW encounters an invalid code (not in dictionary and not kwkwk). */
export class GifLzwInvalidCodeError extends WebcvtError {
  constructor(code: number) {
    super(
      'GIF_LZW_INVALID_CODE',
      `GIF LZW: encountered code ${code} which is beyond the current dictionary size.`,
    );
    this.name = 'GifLzwInvalidCodeError';
  }
}

/** Thrown when LZW stream produces fewer pixels than the frame expects. */
export class GifLzwTruncatedError extends WebcvtError {
  constructor(got: number, expected: number) {
    super(
      'GIF_LZW_TRUNCATED',
      `GIF LZW: stream produced ${got} pixels but frame expects ${expected}.`,
    );
    this.name = 'GifLzwTruncatedError';
  }
}

/** Thrown when serializing a GIF frame that uses more than 256 unique colours. */
export class GifTooManyColorsError extends WebcvtError {
  constructor(frameIndex: number, count: number) {
    super(
      'GIF_TOO_MANY_COLORS',
      `GIF: frame ${frameIndex} has ${count} unique colours; maximum is 256 (palette quantisation is deferred).`,
    );
    this.name = 'GifTooManyColorsError';
  }
}

/** Thrown when the number of GIF frames exceeds MAX_FRAMES. */
export class GifTooManyFramesError extends WebcvtError {
  constructor(count: number, max: number) {
    super('GIF_TOO_MANY_FRAMES', `GIF: encountered ${count} frames; maximum allowed is ${max}.`);
    this.name = 'GifTooManyFramesError';
  }
}

/**
 * Thrown when a GIF LZW sub-block accumulation exceeds MAX_GIF_FRAME_BYTES,
 * OR when a frame's pixel count exceeds MAX_PIXELS.
 *
 * The `kind` discriminator distinguishes the two cases:
 * - 'bytes': compressed byte cap exceeded
 * - 'pixels': raw pixel cap exceeded
 */
export class GifFrameTooLargeError extends WebcvtError {
  constructor(frameIndexOrKind: number | 'pixels', got: number, max: number) {
    const subject =
      typeof frameIndexOrKind === 'number'
        ? `GIF: frame ${frameIndexOrKind} compressed LZW data is ${got} bytes; maximum allowed is ${max} bytes.`
        : `GIF: frame pixel count ${got} exceeds the cap of ${max} pixels.`;
    super('GIF_FRAME_TOO_LARGE', subject);
    this.name = 'GifFrameTooLargeError';
  }
}

/** Thrown when the lzwMinCodeSize byte is outside the valid range [2, 8]. */
export class GifBadLzwMinCodeSizeError extends WebcvtError {
  constructor(value: number) {
    super(
      'GIF_BAD_LZW_MIN_CODE_SIZE',
      `GIF: lzwMinCodeSize ${value} is outside the valid range [2, 8].`,
    );
    this.name = 'GifBadLzwMinCodeSizeError';
  }
}

/** Thrown when a NETSCAPE2.0 extension sub-block is truncated. */
export class GifTruncatedExtensionError extends WebcvtError {
  constructor(extName: string) {
    super(
      'GIF_TRUNCATED_EXTENSION',
      `GIF: ${extName} extension sub-block is truncated or malformed.`,
    );
    this.name = 'GifTruncatedExtensionError';
  }
}

// ---------------------------------------------------------------------------
// APNG errors
// ---------------------------------------------------------------------------

/** Thrown when an APNG input is shorter than the minimum valid size. */
export class ApngTooShortError extends WebcvtError {
  constructor(length: number) {
    super('APNG_TOO_SHORT', `APNG: input is ${length} bytes; minimum valid APNG is 44 bytes.`);
    this.name = 'ApngTooShortError';
  }
}

/** Thrown when the first 8 bytes do not match the PNG signature. */
export class ApngBadSignatureError extends WebcvtError {
  constructor() {
    super('APNG_BAD_SIGNATURE', 'APNG: PNG signature mismatch (expected 89 50 4E 47 0D 0A 1A 0A).');
    this.name = 'ApngBadSignatureError';
  }
}

/** Thrown when a chunk's CRC-32 does not match (Trap §8). */
export class ApngBadCrcError extends WebcvtError {
  constructor(type: string, offset: number, expected: number, got: number) {
    super(
      'APNG_BAD_CRC',
      `APNG: chunk '${type}' at offset ${offset} has CRC 0x${got.toString(16)} but expected 0x${expected.toString(16)}.`,
    );
    this.name = 'ApngBadCrcError';
  }
}

/** Thrown when a chunk's declared length exceeds MAX_PNG_CHUNK_BYTES. */
export class ApngChunkTooLargeError extends WebcvtError {
  constructor(type: string, length: number, max: number) {
    super(
      'APNG_CHUNK_TOO_LARGE',
      `APNG: chunk '${type}' declares length ${length} which exceeds the cap of ${max} bytes.`,
    );
    this.name = 'ApngChunkTooLargeError';
  }
}

/** Thrown when a sequence_number does not match the expected value (Trap §1). */
export class ApngBadSequenceError extends WebcvtError {
  constructor(chunkType: string, expected: number, got: number) {
    super(
      'APNG_BAD_SEQUENCE',
      `APNG: ${chunkType} chunk has sequence_number ${got} but expected ${expected}.`,
    );
    this.name = 'ApngBadSequenceError';
  }
}

/** Thrown when an fdAT chunk's data is shorter than the 4-byte sequence prefix. */
export class ApngFdatTooShortError extends WebcvtError {
  constructor(length: number) {
    super(
      'APNG_FDAT_TOO_SHORT',
      `APNG: fdAT chunk data is ${length} bytes; minimum is 4 bytes (sequence_number prefix + at least 0 bytes payload).`,
    );
    this.name = 'ApngFdatTooShortError';
  }
}

/** Thrown when an unknown critical chunk is encountered (uppercase first letter). */
export class ApngUnknownCriticalChunkError extends WebcvtError {
  constructor(type: string) {
    super(
      'APNG_UNKNOWN_CRITICAL_CHUNK',
      `APNG: unknown critical chunk type '${type}' (critical = first letter uppercase).`,
    );
    this.name = 'ApngUnknownCriticalChunkError';
  }
}

/** Thrown when frames.length !== acTL.numFrames after parsing IEND. */
export class ApngFrameCountMismatchError extends WebcvtError {
  constructor(declared: number, actual: number) {
    super(
      'APNG_FRAME_COUNT_MISMATCH',
      `APNG: acTL declared ${declared} frames but parsed ${actual} frames.`,
    );
    this.name = 'ApngFrameCountMismatchError';
  }
}

/** Thrown when serializing an APNG with idatIsFirstFrame=false (deferred). */
export class ApngHiddenDefaultNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'APNG_HIDDEN_DEFAULT_NOT_SUPPORTED',
      'APNG: serializing with idatIsFirstFrame=false (hidden default IDAT image) is not supported in first-pass implementation.',
    );
    this.name = 'ApngHiddenDefaultNotSupportedError';
  }
}

/** Thrown if the first frame uses dispose_op=2 (APNG_DISPOSE_OP_PREVIOUS). */
export class ApngFirstFramePreviousError extends WebcvtError {
  constructor() {
    super(
      'APNG_FIRST_FRAME_PREVIOUS',
      'APNG: first animation frame MUST NOT use dispose_op=2 (APNG_DISPOSE_OP_PREVIOUS) — no prior canvas state exists.',
    );
    this.name = 'ApngFirstFramePreviousError';
  }
}

/** Thrown when acTL has zero frames. */
export class ApngZeroFramesError extends WebcvtError {
  constructor() {
    super('APNG_ZERO_FRAMES', 'APNG: acTL declares 0 frames; minimum is 1.');
    this.name = 'ApngZeroFramesError';
  }
}

/** Thrown when acTL numFrames exceeds MAX_FRAMES. */
export class ApngTooManyFramesError extends WebcvtError {
  constructor(numFrames: number, max: number) {
    super(
      'APNG_TOO_MANY_FRAMES',
      `APNG: acTL declares ${numFrames} frames; maximum allowed is ${max}.`,
    );
    this.name = 'ApngTooManyFramesError';
  }
}

/** Thrown when the multiplicative frame byte cap is exceeded. */
export class ApngFramesBytesExceededError extends WebcvtError {
  constructor(totalBytes: number, max: number) {
    super(
      'APNG_FRAMES_BYTES_EXCEEDED',
      `APNG: total frame bytes ${totalBytes} exceeds the cap of ${max} bytes.`,
    );
    this.name = 'ApngFramesBytesExceededError';
  }
}

/** Thrown when canvas or frame dimensions are invalid. */
export class ApngBadDimensionError extends WebcvtError {
  constructor(axis: string, value: number) {
    super('APNG_BAD_DIMENSION', `APNG: ${axis} ${value} is out of range [1, 16384].`);
    this.name = 'ApngBadDimensionError';
  }
}

/** Thrown when a frame extends outside the canvas boundaries. */
export class ApngFrameOutOfBoundsError extends WebcvtError {
  constructor(seqNum: number, axis: string, edge: number, canvasDim: number) {
    super(
      'APNG_FRAME_OUT_OF_BOUNDS',
      `APNG: fcTL seq ${seqNum} ${axis}-edge ${edge} exceeds canvas dimension ${canvasDim}.`,
    );
    this.name = 'ApngFrameOutOfBoundsError';
  }
}

/** Thrown when IHDR does not appear as the first non-signature chunk. */
export class ApngChunkOrderError extends WebcvtError {
  constructor(firstType: string) {
    super(
      'APNG_CHUNK_ORDER',
      `APNG: IHDR must be the first chunk after the PNG signature; got '${firstType}'.`,
    );
    this.name = 'ApngChunkOrderError';
  }
}

/** Thrown when the PNG chunk stream ends before a complete chunk header can be read. */
export class ApngChunkStreamTruncatedError extends WebcvtError {
  constructor(offset: number) {
    super(
      'APNG_CHUNK_STREAM_TRUNCATED',
      `APNG: unexpected end of stream at offset ${offset} (need at least 8 bytes for chunk header).`,
    );
    this.name = 'ApngChunkStreamTruncatedError';
  }
}

/** Thrown when a chunk declares more bytes than are available in the input. */
export class ApngChunkTruncatedError extends WebcvtError {
  constructor(type: string, offset: number, declared: number) {
    super(
      'APNG_CHUNK_TRUNCATED',
      `APNG: chunk '${type}' at offset ${offset} declares ${declared} bytes but input is too short.`,
    );
    this.name = 'ApngChunkTruncatedError';
  }
}

// ---------------------------------------------------------------------------
// Animated WebP errors
// ---------------------------------------------------------------------------

/** Thrown when a WebP animated input is shorter than the minimum valid size. */
export class WebpAnimTooShortError extends WebcvtError {
  constructor(length: number) {
    super(
      'WEBP_ANIM_TOO_SHORT',
      `WebP-anim: input is ${length} bytes; minimum valid animated WebP is 60 bytes.`,
    );
    this.name = 'WebpAnimTooShortError';
  }
}

/** Thrown when the RIFF/WEBP header is invalid. */
export class WebpBadRiffError extends WebcvtError {
  constructor(message: string) {
    super('WEBP_BAD_RIFF', `WebP-anim: invalid RIFF header — ${message}.`);
    this.name = 'WebpBadRiffError';
  }
}

/** Thrown when VP8X chunk is missing or not the first chunk. */
export class WebpAnimMissingVp8xError extends WebcvtError {
  constructor(got: string) {
    super(
      'WEBP_ANIM_MISSING_VP8X',
      `WebP-anim: expected VP8X as first chunk after WEBP FourCC, got '${got}'.`,
    );
    this.name = 'WebpAnimMissingVp8xError';
  }
}

/** Thrown when VP8X animation flag (bit 1) is not set — file is static WebP. */
export class WebpStaticNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'WEBP_STATIC_NOT_SUPPORTED',
      'WebP-anim: VP8X animation flag (bit 1) is not set; this is a static WebP file. Use a future @catlabtech/webcvt-image-webp package.',
    );
    this.name = 'WebpStaticNotSupportedError';
  }
}

/** Thrown when a RIFF chunk size exceeds MAX_RIFF_CHUNK_BYTES. */
export class WebpChunkTooLargeError extends WebcvtError {
  constructor(fourcc: string, size: number, max: number) {
    super(
      'WEBP_CHUNK_TOO_LARGE',
      `WebP-anim: chunk '${fourcc}' declares size ${size} which exceeds the cap of ${max} bytes.`,
    );
    this.name = 'WebpChunkTooLargeError';
  }
}

/** Thrown when an unknown FourCC is encountered in the WebP chunk stream. */
export class WebpAnimUnknownChunkError extends WebcvtError {
  constructor(fourcc: string, offset: number) {
    super(
      'WEBP_ANIM_UNKNOWN_CHUNK',
      `WebP-anim: unknown chunk FourCC '${fourcc}' at offset ${offset}.`,
    );
    this.name = 'WebpAnimUnknownChunkError';
  }
}

/** Thrown when VP8L sub-frame is missing the 0x2F signature byte. */
export class WebpVp8lBadSignatureError extends WebcvtError {
  constructor(got: number) {
    super(
      'WEBP_VP8L_BAD_SIGNATURE',
      `WebP-anim: VP8L sub-frame must start with 0x2F signature byte, got 0x${got.toString(16).padStart(2, '0')}.`,
    );
    this.name = 'WebpVp8lBadSignatureError';
  }
}

/** Thrown when canvas dimensions from VP8X are out of valid range. */
export class WebpBadDimensionError extends WebcvtError {
  constructor(axis: 'width' | 'height', value: number) {
    super('WEBP_BAD_DIMENSION', `WebP-anim: canvas ${axis} ${value} is out of range [1, 16384].`);
    this.name = 'WebpBadDimensionError';
  }
}

/** Thrown when an ANMF frame extends outside the canvas. */
export class WebpFrameOutOfBoundsError extends WebcvtError {
  constructor(frameIndex: number, axis: 'x' | 'y') {
    super(
      'WEBP_FRAME_OUT_OF_BOUNDS',
      `WebP-anim: ANMF frame ${frameIndex} extends beyond the canvas ${axis === 'x' ? 'width' : 'height'}.`,
    );
    this.name = 'WebpFrameOutOfBoundsError';
  }
}

/** Thrown when an ANMF payload is shorter than the 16-byte header. */
export class WebpAnmfTooShortError extends WebcvtError {
  constructor(frameIndex: number, length: number) {
    super(
      'WEBP_ANMF_TOO_SHORT',
      `WebP-anim: ANMF frame ${frameIndex} payload is ${length} bytes; minimum is 16 bytes.`,
    );
    this.name = 'WebpAnmfTooShortError';
  }
}

/** Thrown when serializing a frame with an odd x or y offset. */
export class WebpAnimOddOffsetError extends WebcvtError {
  constructor(frameIndex: number, axis: 'x' | 'y', value: number) {
    super(
      'WEBP_ANIM_ODD_OFFSET',
      `WebP-anim: frame ${frameIndex} ${axis}-offset ${value} must be even (spec requires offset divisible by 2).`,
    );
    this.name = 'WebpAnimOddOffsetError';
  }
}

/** Thrown when a VP8 frame has no sub-frame chunk inside an ANMF. */
export class WebpMissingSubFrameError extends WebcvtError {
  constructor(frameIndex: number) {
    super(
      'WEBP_MISSING_SUB_FRAME',
      `WebP-anim: ANMF frame ${frameIndex} has no VP8 or VP8L sub-frame chunk.`,
    );
    this.name = 'WebpMissingSubFrameError';
  }
}

/** Thrown when the RIFF chunk stream ends before a complete chunk header can be read. */
export class WebpChunkStreamTruncatedError extends WebcvtError {
  constructor(offset: number) {
    super(
      'WEBP_CHUNK_STREAM_TRUNCATED',
      `WebP-anim: unexpected end of stream at offset ${offset} (need at least 8 bytes).`,
    );
    this.name = 'WebpChunkStreamTruncatedError';
  }
}

/** Thrown when a RIFF chunk declares more bytes than are available in the input. */
export class WebpChunkTruncatedError extends WebcvtError {
  constructor(fourcc: string, offset: number, declared: number) {
    super(
      'WEBP_CHUNK_TRUNCATED',
      `WebP-anim: chunk '${fourcc}' at offset ${offset} declares ${declared} bytes but input is too short.`,
    );
    this.name = 'WebpChunkTruncatedError';
  }
}
