/**
 * Shared constants for @catlabtech/webcvt-font.
 *
 * Font containers (sfnt / WOFF) are untrusted input. Every cap below bounds CPU
 * and memory so a hostile or malformed file — including a decompression bomb —
 * cannot exhaust the host. Modules reference these constants; do not hardcode
 * the values inline.
 *
 * Clean-room: structures implemented from the OpenType spec (ISO/IEC 14496-22 /
 * Microsoft OpenType) and the WOFF 1.0 W3C Recommendation, not ported from any
 * existing library.
 */

// ---------------------------------------------------------------------------
// Security caps
// ---------------------------------------------------------------------------

/** Maximum raw input size in bytes (64 MiB). Checked BEFORE any parsing. */
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;

/**
 * Maximum number of tables in an sfnt / WOFF directory (4096). A real font has
 * a few dozen tables; an absurd count signals a malformed or hostile file.
 */
export const MAX_TABLES = 4096;

/**
 * Maximum size of a single (uncompressed) table in bytes (64 MiB). Applied to
 * sfnt table lengths and to WOFF `origLength` (the declared decompressed size)
 * so a single declared-huge table cannot trigger a giant allocation.
 */
export const MAX_TABLE_BYTES = 64 * 1024 * 1024;

/**
 * Cumulative decompressed-bytes cap across all WOFF tables (256 MiB). A
 * decompression-bomb guard: decompression is aborted (streaming, before the
 * full allocation) once the running total would exceed this budget.
 */
export const MAX_TOTAL_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

// ---------------------------------------------------------------------------
// sfnt offset-table layout (bytes)
// ---------------------------------------------------------------------------

/** Size of the sfnt offset table (header): version + 4 u16 fields. */
export const SFNT_HEADER_SIZE = 12;

/** Size of one sfnt table-directory record: tag + checksum + offset + length. */
export const SFNT_TABLE_RECORD_SIZE = 16;

// ---------------------------------------------------------------------------
// WOFF layout (bytes) — WOFF 1.0 §"WOFF Header" / §"Table Directory"
// ---------------------------------------------------------------------------

/** Size of the WOFF file header. */
export const WOFF_HEADER_SIZE = 44;

/** Size of one WOFF table-directory entry. */
export const WOFF_TABLE_RECORD_SIZE = 20;

// ---------------------------------------------------------------------------
// sfnt / WOFF magic numbers (u32, big-endian)
// ---------------------------------------------------------------------------

/** TrueType outline sfnt version: 0x00010000. */
export const SFNT_VERSION_TRUETYPE = 0x00010000;

/** CFF/OpenType outline sfnt flavor: ASCII 'OTTO'. */
export const SFNT_FLAVOR_OTTO = 0x4f54544f;

/** Apple legacy TrueType flavor: ASCII 'true'. */
export const SFNT_FLAVOR_TRUE = 0x74727565;

/** Apple legacy TrueType flavor: ASCII 'typ1' (PostScript Type 1 in sfnt). */
export const SFNT_FLAVOR_TYP1 = 0x74797031;

/** TrueType/OpenType Collection magic: ASCII 'ttcf' (out of scope). */
export const SFNT_FLAVOR_TTCF = 0x74746366;

/** WOFF 1.0 signature: ASCII 'wOFF'. */
export const WOFF_SIGNATURE = 0x774f4646;

/** WOFF 2.0 signature: ASCII 'wOF2' (out of scope — Brotli + glyf transform). */
export const WOFF2_SIGNATURE = 0x774f4632;

// ---------------------------------------------------------------------------
// head-table checksum constant
// ---------------------------------------------------------------------------

/**
 * Magic value used to derive head.checkSumAdjustment: the adjustment is
 * (0xB1B0AFBA − wholeFileChecksum) mod 2^32 (OpenType spec, "Calculating
 * checksums").
 */
export const HEAD_CHECKSUM_MAGIC = 0xb1b0afba;

/** Byte offset of checkSumAdjustment within the head table. */
export const HEAD_CHECKSUM_ADJUSTMENT_OFFSET = 8;

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

/** Canonical MIME type for a TrueType-flavoured sfnt font. */
export const TTF_MIME = 'font/ttf';

/** Canonical MIME type for an OpenType/CFF-flavoured sfnt font. */
export const OTF_MIME = 'font/otf';

/** Canonical MIME type for a WOFF 1.0 font. */
export const WOFF_MIME = 'font/woff';
