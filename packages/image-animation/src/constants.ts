/**
 * Security caps, magic bytes, and format constants for @webcvt/image-animation.
 *
 * All values are derived from the design note security caps section.
 * Every format module references these; do NOT hardcode inline.
 */

// ---------------------------------------------------------------------------
// Security caps — validate ALL before typed-array allocation
// ---------------------------------------------------------------------------

/** Maximum raw input size: 200 MiB. */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Maximum pixel count per frame: 16384 × 16384 = 268,435,456. */
export const MAX_PIXELS = 16384 * 16384;

/** Maximum pixel byte count: 1 GiB. Belt-and-braces with MAX_PIXELS. */
export const MAX_PIXEL_BYTES = 1024 * 1024 * 1024;

/** Maximum dimension per axis: 16384. */
export const MAX_DIM = 16384;

/** Maximum number of frames across all animated formats (Trap §19). */
export const MAX_FRAMES = 4096;

/** Maximum total frame bytes: canvas-width * canvas-height * 4 * numFrames must be below this. */
export const MAX_TOTAL_FRAME_BYTES = 1024 * 1024 * 1024; // 1 GiB

/** Maximum size of a single PNG chunk data field. */
export const MAX_PNG_CHUNK_BYTES = 100 * 1024 * 1024; // 100 MiB

/** Maximum size of a single RIFF chunk. */
export const MAX_RIFF_CHUNK_BYTES = 200 * 1024 * 1024; // 200 MiB

/** Maximum GIF frame compressed bytes (design note §security-caps). */
export const MAX_GIF_FRAME_BYTES = 16 * 1024 * 1024; // 16 MiB

/** Maximum size for IDAT/fdAT chunk splits on serialization. */
export const MAX_IDAT_CHUNK_SIZE = 8 * 1024; // 8 KiB

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const GIF_MIME = 'image/gif';
export const APNG_MIME = 'image/apng';
export const WEBP_MIME = 'image/webp';

// ---------------------------------------------------------------------------
// GIF magic bytes
// ---------------------------------------------------------------------------

/** GIF87a signature bytes: 'G', 'I', 'F', '8', '7', 'a' */
export const GIF87A_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);

/** GIF89a signature bytes: 'G', 'I', 'F', '8', '9', 'a' */
export const GIF89A_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

// ---------------------------------------------------------------------------
// PNG / APNG magic bytes
// ---------------------------------------------------------------------------

/** PNG signature: 89 50 4E 47 0D 0A 1A 0A */
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// WebP / RIFF magic bytes
// ---------------------------------------------------------------------------

/** RIFF FourCC as byte array. */
export const RIFF_MAGIC = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // 'RIFF'

/** WEBP FourCC as byte array. */
export const WEBP_FOURCC = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // 'WEBP'

// ---------------------------------------------------------------------------
// GIF block codes
// ---------------------------------------------------------------------------

export const GIF_EXTENSION_INTRODUCER = 0x21;
export const GIF_IMAGE_SEPARATOR = 0x2c;
export const GIF_TRAILER = 0x3b;

export const GIF_GCE_LABEL = 0xf9;
export const GIF_APP_LABEL = 0xff;
export const GIF_COMMENT_LABEL = 0xfe;
export const GIF_PLAINTEXT_LABEL = 0x01;

export const NETSCAPE2_IDENTIFIER = 'NETSCAPE2.0';

// ---------------------------------------------------------------------------
// APNG chunk types
// ---------------------------------------------------------------------------

export const CHUNK_IHDR = 'IHDR';
export const CHUNK_IDAT = 'IDAT';
export const CHUNK_IEND = 'IEND';
export const CHUNK_ACTL = 'acTL';
export const CHUNK_FCTL = 'fcTL';
export const CHUNK_FDAT = 'fdAT';

/** APNG dispose_op values. */
export const APNG_DISPOSE_OP_NONE = 0;
export const APNG_DISPOSE_OP_BACKGROUND = 1;
export const APNG_DISPOSE_OP_PREVIOUS = 2;

/** APNG blend_op values. */
export const APNG_BLEND_OP_SOURCE = 0;
export const APNG_BLEND_OP_OVER = 1;

// ---------------------------------------------------------------------------
// WebP FourCC strings
// ---------------------------------------------------------------------------

export const FOURCC_VP8X = 'VP8X';
export const FOURCC_VP8 = 'VP8 '; // trailing space — Trap §13
export const FOURCC_VP8L = 'VP8L';
export const FOURCC_ANIM = 'ANIM';
export const FOURCC_ANMF = 'ANMF';
export const FOURCC_ALPH = 'ALPH';
export const FOURCC_ICCP = 'ICCP';
export const FOURCC_EXIF = 'EXIF';
export const FOURCC_XMP = 'XMP '; // trailing space per spec

/** VP8X animation flag is bit 1 (Trap §20). */
export const VP8X_ANIMATION_FLAG = 1 << 1;

/** VP8L lossless signature byte. */
export const VP8L_SIGNATURE = 0x2f;
