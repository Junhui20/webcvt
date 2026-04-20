/**
 * Core types for @webcvt/image-animation.
 *
 * Discriminated union over the three animated image formats: GIF, APNG, animated WebP.
 * Shared AnimationFrame type normalises per-frame metadata across formats.
 */

// ---------------------------------------------------------------------------
// Discriminated union tags
// ---------------------------------------------------------------------------

/** Discriminated tag for top-level dispatch. */
export type AnimationFormat = 'gif' | 'apng' | 'webp-anim';

// ---------------------------------------------------------------------------
// Normalised per-frame enumerations
// ---------------------------------------------------------------------------

/**
 * Disposal method — normalised across formats.
 *
 * - 'none': keep frame on canvas (GIF disposal 0/1, APNG APNG_DISPOSE_OP_NONE, WebP-anim no-dispose)
 * - 'background': clear frame region to transparent/background (GIF disposal 2, APNG APNG_DISPOSE_OP_BACKGROUND, WebP-anim dispose)
 * - 'previous': restore prior canvas state (APNG APNG_DISPOSE_OP_PREVIOUS only; GIF disposal 3 maps here too)
 */
export type DisposalMethod = 'none' | 'background' | 'previous';

/**
 * Blend mode — normalised across formats.
 *
 * - 'source': overwrite (GIF default, APNG blend_op=0, WebP-anim "no blend" / Trap §22 bit=1)
 * - 'over': alpha-composite (Porter-Duff "over"; APNG blend_op=1, WebP-anim blend / Trap §22 bit=0)
 */
export type BlendMode = 'source' | 'over';

// ---------------------------------------------------------------------------
// AnimationFrame
// ---------------------------------------------------------------------------

/**
 * One frame of an animated image.
 *
 * - For GIF: pixelData is set (decoded RGBA Uint8Array, row-major top-down).
 * - For APNG / WebP-anim: payloadBytes is set (raw zlib-deflate or VP8/VP8L bitstream).
 *   subFormat is set for WebP-anim only.
 */
export interface AnimationFrame {
  /** Frame index in the animation sequence (0-based). */
  index: number;
  /** X offset of frame's top-left corner within the canvas. */
  x: number;
  /** Y offset of frame's top-left corner within the canvas. */
  y: number;
  width: number;
  height: number;
  /** Frame display duration in milliseconds. */
  durationMs: number;
  disposalMethod: DisposalMethod;
  blendMode: BlendMode;
  /**
   * Decoded RGBA pixel data (row-major, top-down).
   * Only set for GIF; undefined for APNG and WebP-anim.
   */
  pixelData?: Uint8Array;
  /**
   * Raw encoded payload bytes:
   * - APNG: zlib-wrapped deflate stream (use DecompressionStream('deflate'), NOT 'deflate-raw').
   * - WebP-anim: VP8 or VP8L sub-frame bitstream (use libwebp / backend-wasm).
   * Undefined for GIF.
   */
  payloadBytes?: Uint8Array;
  /**
   * Sub-format of payloadBytes for WebP-anim frames.
   * 'VP8' = lossy, 'VP8L' = lossless. Undefined for GIF and APNG.
   */
  subFormat?: 'VP8' | 'VP8L';
}

// ---------------------------------------------------------------------------
// GifFile
// ---------------------------------------------------------------------------

/** GIF: container-level data + decoded frames. */
export interface GifFile {
  format: 'gif';
  variant: 'GIF87a' | 'GIF89a';
  /** Logical screen width. */
  canvasWidth: number;
  /** Logical screen height. */
  canvasHeight: number;
  /**
   * Loop count from NETSCAPE2.0 application extension.
   * 0 = infinite, 1 = play once (default when no NETSCAPE2.0 found), ≥2 = explicit count.
   */
  loopCount: number;
  /** Background colour index into globalColorTable. Undefined if no GCT. */
  backgroundColorIndex?: number;
  /** Global Color Table (RGB triplets, length = entries * 3). Undefined if absent. */
  globalColorTable?: Uint8Array;
  /** Pixel aspect ratio byte from the LSD. 0 = square pixels (most common). */
  pixelAspectRatio: number;
  /** Decoded frames. Always at least 1 for a valid GIF. */
  frames: AnimationFrame[];
  /** Comment Extension blocks (ASCII text). Round-tripped on serialize if populated. */
  commentBlocks: string[];
}

// ---------------------------------------------------------------------------
// ApngFile
// ---------------------------------------------------------------------------

/** APNG: container-level data + raw compressed frame payloads. */
export interface ApngFile {
  format: 'apng';
  /** Canvas width from the IHDR chunk. */
  canvasWidth: number;
  /** Canvas height from the IHDR chunk. */
  canvasHeight: number;
  /** num_plays from acTL; 0 = infinite. */
  numPlays: number;
  /** num_frames from acTL. MUST equal frames.length. */
  numFrames: number;
  /**
   * True if the IDAT chunk represents the first animation frame
   * (fcTL appears before IDAT). False if IDAT is a hidden default image.
   * Trap §5.
   */
  idatIsFirstFrame: boolean;
  /**
   * Frames in animation sequence order. payloadBytes contains the
   * zlib-compressed pixel stream for downstream DecompressionStream('deflate').
   */
  frames: AnimationFrame[];
  /**
   * All other PNG chunks (IHDR, PLTE, tRNS, gAMA, sBIT, iCCP, etc.) preserved
   * verbatim for round-trip. Order is preserved.
   */
  ancillaryChunks: { type: string; data: Uint8Array }[];
}

// ---------------------------------------------------------------------------
// WebpAnimFile
// ---------------------------------------------------------------------------

/** Animated WebP: container-level data + raw VP8/VP8L frame payloads. */
export interface WebpAnimFile {
  format: 'webp-anim';
  /** Canvas width from VP8X (already +1 corrected, Trap §10). */
  canvasWidth: number;
  /** Canvas height from VP8X (already +1 corrected, Trap §10). */
  canvasHeight: number;
  /** Background colour from ANIM chunk, ARGB layout (uint32 LE). */
  backgroundColor: number;
  /** loop_count from ANIM; 0 = infinite. */
  loopCount: number;
  /** True if any frame has alpha (VP8X flags bit 4). */
  hasAlpha: boolean;
  /**
   * Frames in container order. payloadBytes contains the VP8 or VP8L sub-frame
   * as raw bytes (without the outer ANMF header). subFormat tells consumers
   * which decoder to invoke via backend-wasm.
   */
  frames: AnimationFrame[];
  /**
   * Optional metadata chunks preserved verbatim: ICCP, EXIF, XMP, etc.
   * Order is preserved relative to ANIM/ANMF.
   */
  metadataChunks: { fourcc: string; payload: Uint8Array }[];
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/** Discriminated union returned by the top-level dispatcher. */
export type AnimationFile = GifFile | ApngFile | WebpAnimFile;
