/**
 * Security caps and magic-byte constants for @webcvt/image-legacy.
 *
 * All values derived from the design note §"Security caps".
 * Every format module references these constants; do not hardcode inline.
 */

// ---------------------------------------------------------------------------
// Security caps — validate ALL before typed-array allocation
// ---------------------------------------------------------------------------

/** Maximum raw input size: 200 MiB. */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Maximum pixel count: 16384 × 16384 = 268,435,456. */
export const MAX_PIXELS = 16384 * 16384;

/** Maximum pixel byte count: 1 GiB. Belt-and-braces with MAX_PIXELS. */
export const MAX_PIXEL_BYTES = 1024 * 1024 * 1024;

/** Maximum dimension per axis: 16384. */
export const MAX_DIM = 16384;

// ---------------------------------------------------------------------------
// Netpbm MIME types
// ---------------------------------------------------------------------------

export const PBM_MIME = 'image/x-portable-bitmap';
export const PGM_MIME = 'image/x-portable-graymap';
export const PPM_MIME = 'image/x-portable-pixmap';
export const PFM_MIME = 'image/x-portable-floatmap';
export const QOI_MIME = 'image/qoi';

// ---------------------------------------------------------------------------
// QOI opcode tags
// ---------------------------------------------------------------------------

/** QOI_OP_RGB — full RGB pixel, alpha unchanged. */
export const QOI_OP_RGB = 0xfe;

/** QOI_OP_RGBA — full RGBA pixel. */
export const QOI_OP_RGBA = 0xff;

/** QOI_OP_INDEX tag — 2-bit prefix 00. */
export const QOI_TAG_INDEX = 0x00;

/** QOI_OP_DIFF tag — 2-bit prefix 01. */
export const QOI_TAG_DIFF = 0x40;

/** QOI_OP_LUMA tag — 2-bit prefix 10. */
export const QOI_TAG_LUMA = 0x80;

/** QOI_OP_RUN tag — 2-bit prefix 11. */
export const QOI_TAG_RUN = 0xc0;

/** Maximum run length for QOI_OP_RUN: 62 pixels. */
export const QOI_MAX_RUN = 62;

/** QOI 8-byte end marker: 00 00 00 00 00 00 00 01. */
export const QOI_END_MARKER = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);

/** QOI magic bytes: "qoif" (0x71 0x6F 0x69 0x66). */
export const QOI_MAGIC = new Uint8Array([0x71, 0x6f, 0x69, 0x66]);

/** QOI header size in bytes. */
export const QOI_HEADER_SIZE = 14;

// ---------------------------------------------------------------------------
// TIFF constants
// ---------------------------------------------------------------------------

/** MIME type for TIFF images. */
export const TIFF_MIME = 'image/tiff';

/** TIFF little-endian (II) magic: 49 49 2A 00. */
export const TIFF_LE_MAGIC = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);

/** TIFF big-endian (MM) magic: 4D 4D 00 2A. */
export const TIFF_BE_MAGIC = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]);

/** Maximum number of IFD pages (chain length cap). */
export const MAX_PAGES = 1024;

/** Maximum IFD entry count per IFD. */
export const MAX_IFD_ENTRIES = 4096;

/**
 * Maximum LZW expansion ratio (compressed-to-decompressed).
 * Actual output bytes capped via MAX_DECOMPRESSED_STRIP_BYTES.
 */
export const MAX_LZW_EXPANSION_RATIO = 1024;

/** Maximum bytes for a single decompressed strip (256 MiB). */
export const MAX_DECOMPRESSED_STRIP_BYTES = 256 * 1024 * 1024;

/**
 * Maximum count for a single IFD tag value array.
 * 256M covers MAX_INPUT_BYTES / smallest type size (1 byte per BYTE element).
 * Prevents count × typeSize integer overflow before the downstream bounds check.
 */
export const MAX_TAG_VALUE_COUNT = 268_435_456; // 256M
