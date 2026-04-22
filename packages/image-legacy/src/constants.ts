/**
 * Security caps and magic-byte constants for @catlabtech/webcvt-image-legacy.
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

// ---------------------------------------------------------------------------
// TGA constants
// ---------------------------------------------------------------------------

/** Primary MIME type for TGA images. */
export const TGA_MIME = 'image/x-tga';

/** Alternative MIME types accepted by the backend. */
export const TGA_MIME_ALT1 = 'image/tga';
export const TGA_MIME_ALT2 = 'image/x-targa';

/**
 * TGA 2.0 footer signature — exactly 18 bytes:
 * 'TRUEVISION-XFILE' (16 ASCII chars) + '.' (0x2E) + NUL (0x00).
 * Located at file.length - 26 + 8 (offsets bytes 8..25 of the 26-byte footer).
 */
export const TGA_FOOTER_SIGNATURE = new Uint8Array([
  0x54,
  0x52,
  0x55,
  0x45,
  0x56,
  0x49,
  0x53,
  0x49,
  0x4f,
  0x4e, // 'TRUEVISION'
  0x2d,
  0x58,
  0x46,
  0x49,
  0x4c,
  0x45, // '-XFILE'
  0x2e,
  0x00, // '.\0'
]);

/** Size of the TGA fixed header in bytes. */
export const TGA_HEADER_SIZE = 18;

/** Size of the TGA 2.0 footer in bytes. */
export const TGA_FOOTER_SIZE = 26;

/**
 * Documentary constant: the maximum expansion ratio for a single RLE packet
 * is 128:1 (one header byte → 128 pixels). Used as a comment reference only;
 * actual RLE bounds use the pre-allocated output buffer size.
 */
export const MAX_RLE_EXPANSION_RATIO = 128;

// ---------------------------------------------------------------------------
// XBM constants
// ---------------------------------------------------------------------------

/** Primary MIME type for XBM images (X11 Bitmap). */
export const XBM_MIME = 'image/x-xbitmap';

/** Alternative MIME type accepted by the backend. */
export const XBM_MIME_ALT = 'image/x-xbm';

/**
 * Default identifier prefix used by the serializer when XbmFile.prefix is
 * empty or missing.
 */
export const XBM_DEFAULT_PREFIX = 'image';

/** Number of hex-byte literals emitted per line in canonical serialized output. */
export const XBM_BYTES_PER_LINE = 12;

/**
 * Maximum length for an XBM identifier prefix (extracted from the `_width`
 * define). Defends against degenerate inputs with very long identifiers.
 */
export const XBM_MAX_IDENTIFIER_LENGTH = 256;

// ---------------------------------------------------------------------------
// PCX constants
// ---------------------------------------------------------------------------

/** PCX manufacturer byte — must be 0x0A in every valid PCX file. */
export const PCX_MAGIC = 0x0a;

/** PCX encoding value — 1 = RLE (the only defined encoding). */
export const PCX_ENCODING_RLE = 0x01;

/** Sentinel byte that precedes the 768-byte VGA palette footer (version 5 only). */
export const PCX_PALETTE_SENTINEL = 0x0c;

/** Size of the fixed PCX header in bytes. */
export const PCX_HEADER_SIZE = 128;

/** Total size of the VGA palette footer: 1 sentinel + 768 palette bytes. */
export const PCX_PALETTE_FOOTER_SIZE = 769;

/** Size of the EGA palette block inside the header (bytes 16–63). */
export const PCX_EGA_PALETTE_SIZE = 48;

/** Size of the RGB palette data portion of the VGA footer (bytes 1–768). */
export const PCX_VGA_PALETTE_SIZE = 768;

/** Maximum count for a single PCX RLE run (6-bit field, 0x3F). */
export const PCX_MAX_RUN = 63;

/** Primary MIME type for PCX images. */
export const PCX_MIME = 'image/x-pcx';

/** Alternative MIME type for PCX images. */
export const PCX_MIME_ALT = 'image/pcx';

// ---------------------------------------------------------------------------
// ICNS constants
// ---------------------------------------------------------------------------

/** Primary MIME type for ICNS images. */
export const ICNS_MIME = 'image/icns';

/** Alternative MIME type accepted by the backend. */
export const ICNS_MIME_ALT = 'image/x-icns';

/** ICNS magic bytes: 'icns' (0x69 0x63 0x6E 0x73). */
export const ICNS_MAGIC = new Uint8Array([0x69, 0x63, 0x6e, 0x73]);

/** ICNS file header size in bytes (FourCC + uint32 totalSize). */
export const ICNS_HEADER_SIZE = 8;

/** FourCC for the optional Table of Contents element (byte-exact, trailing space). */
export const ICNS_TOC_FOURCC = 'TOC ';

/** Maximum number of ICNS elements to parse (security cap). */
export const MAX_ICNS_ELEMENTS = 64;

/** PNG signature: 8 bytes identifying a PNG payload. */
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG 2000 signature: 12 bytes identifying a JP2 payload. */
export const JP2_SIGNATURE = new Uint8Array([
  0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
]);

// ---------------------------------------------------------------------------
// XPM constants
// ---------------------------------------------------------------------------

/** Primary MIME type for XPM images (X PixMap). */
export const XPM_MIME = 'image/x-xpixmap';

/** Alternative MIME type accepted by the backend. */
export const XPM_MIME_ALT = 'image/x-xpm';

/**
 * Default C identifier name used by the serializer when XpmFile.name is
 * empty or missing.
 */
export const XPM_DEFAULT_NAME = 'image';

/**
 * Maximum number of unique colours in a single XPM file.
 * Defends against degenerate colour tables on parse and serialize.
 */
export const XPM_MAX_COLORS = 1024;

/**
 * Maximum chars_per_pixel value supported.
 * Only 1 and 2 are in scope; values > 2 are rejected.
 */
export const XPM_MAX_CHARS_PER_PIXEL = 2;

/**
 * The 93 printable ASCII characters that are valid as pixel key characters.
 * All printable ASCII (0x20–0x7E) except double-quote (0x22) and
 * backslash (0x5C, which would require escaping in C string literals).
 *
 * The cpp=1 threshold is ≤92 unique colours (first 92 alphabet chars suffice);
 * cpp=2 is required for 93 or more unique colours.
 */
export const XPM_KEY_ALPHABET =
  ` !#$%&'()*+,-./0123456789:;<=>?@` +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~';
