/**
 * Shared constants for @webcvt/archive-zip.
 *
 * All security caps are derived from the design note §"Security caps".
 * Centralised here so parser.ts, zip-parser.ts, tar-parser.ts, and
 * backend.ts cannot drift.
 */

// ---------------------------------------------------------------------------
// Security caps
// ---------------------------------------------------------------------------

/** Maximum input buffer size (200 MiB). Must be the FIRST check in all parsers. */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Maximum uncompressed size per entry (256 MiB). */
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

/** Maximum cumulative uncompressed size across all entries (512 MiB). */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/** Maximum compression ratio per entry before decompression is rejected (1000:1). */
export const MAX_COMPRESSION_RATIO = 1000;

/**
 * Maximum number of entries in a ZIP archive.
 * The ZIP EOCD stores entry counts in a uint16 field (max 65534 before the 0xFFFF ZIP64
 * sentinel). We use 65536 as the enforced limit per the design note §"Security caps",
 * which specifies this value explicitly as the maximum for standard (non-ZIP64) archives.
 */
export const MAX_ZIP_ENTRIES = 65536;

/** Maximum number of entries in a TAR archive. */
export const MAX_TAR_ENTRIES = 65536;

/** Maximum ZIP file comment length in bytes (caps the EOCD backward search). */
export const MAX_ZIP_COMMENT_BYTES = 4096;

/** Maximum entry name length in bytes for ZIP entries. */
export const MAX_ZIP_NAME_BYTES = 4096;

/** Maximum entry name length in bytes for TAR entries (POSIX limit). */
export const MAX_TAR_NAME_BYTES = 255;

// ---------------------------------------------------------------------------
// ZIP magic signatures (little-endian)
// ---------------------------------------------------------------------------

/** ZIP local file header signature: PK\x03\x04 */
export const ZIP_LOCAL_HEADER_SIG = 0x04034b50;

/** ZIP central directory header signature: PK\x01\x02 */
export const ZIP_CENTRAL_DIR_SIG = 0x02014b50;

/** ZIP end of central directory signature: PK\x05\x06 */
export const ZIP_EOCD_SIG = 0x06054b50;

/** ZIP64 end of central directory signature (rejected — deferred). */
export const ZIP64_EOCD_SIG = 0x06064b50;

/** ZIP data descriptor optional signature: PK\x07\x08 */
export const ZIP_DATA_DESCRIPTOR_SIG = 0x08074b50;

// ---------------------------------------------------------------------------
// ZIP structure sizes (bytes)
// ---------------------------------------------------------------------------

/** Fixed size of the EOCD record (without comment). */
export const ZIP_EOCD_FIXED_SIZE = 22;

/** Fixed size of a local file header (without name/extra). */
export const ZIP_LOCAL_HEADER_FIXED_SIZE = 30;

/** Fixed size of a central directory header (without name/extra/comment). */
export const ZIP_CENTRAL_DIR_FIXED_SIZE = 46;

// ---------------------------------------------------------------------------
// ZIP compression methods
// ---------------------------------------------------------------------------

/** Stored (no compression). */
export const ZIP_METHOD_STORED = 0;

/** Deflate (raw Deflate, RFC 1951). Use 'deflate-raw' with DecompressionStream. */
export const ZIP_METHOD_DEFLATE = 8;

// ---------------------------------------------------------------------------
// ZIP general-purpose bit flags
// ---------------------------------------------------------------------------

/** Bit 0: entry is encrypted (rejected). */
export const ZIP_FLAG_ENCRYPTED = 0x0001;

/** Bit 3: sizes are in data descriptor (local header sizes = 0). */
export const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;

/** Bit 11: filename is UTF-8. */
export const ZIP_FLAG_UTF8 = 0x0800;

// ---------------------------------------------------------------------------
// ZIP sentinel values indicating ZIP64 (rejected)
// ---------------------------------------------------------------------------

export const ZIP64_SENTINEL_U16 = 0xffff;
export const ZIP64_SENTINEL_U32 = 0xffffffff;

// ---------------------------------------------------------------------------
// TAR structure sizes
// ---------------------------------------------------------------------------

/** TAR block size in bytes. */
export const TAR_BLOCK_SIZE = 512;

/** TAR end-of-archive marker: two consecutive all-zero blocks. */
export const TAR_EOA_BLOCKS = 2;

// ---------------------------------------------------------------------------
// TAR offsets within a 512-byte header block
// ---------------------------------------------------------------------------

export const TAR_OFF_NAME = 0;
export const TAR_LEN_NAME = 100;
export const TAR_OFF_MODE = 100;
export const TAR_LEN_MODE = 8;
export const TAR_OFF_UID = 108;
export const TAR_LEN_UID = 8;
export const TAR_OFF_GID = 116;
export const TAR_LEN_GID = 8;
export const TAR_OFF_SIZE = 124;
export const TAR_LEN_SIZE = 12;
export const TAR_OFF_MTIME = 136;
export const TAR_LEN_MTIME = 12;
export const TAR_OFF_CHKSUM = 148;
export const TAR_LEN_CHKSUM = 8;
export const TAR_OFF_TYPEFLAG = 156;
export const TAR_OFF_LINKNAME = 157;
export const TAR_LEN_LINKNAME = 100;
export const TAR_OFF_MAGIC = 257;
export const TAR_LEN_MAGIC = 6;
export const TAR_OFF_VERSION = 263;
export const TAR_LEN_VERSION = 2;
export const TAR_OFF_UNAME = 265;
export const TAR_LEN_UNAME = 32;
export const TAR_OFF_GNAME = 297;
export const TAR_LEN_GNAME = 32;
export const TAR_OFF_DEVMAJOR = 329;
export const TAR_LEN_DEVMAJOR = 8;
export const TAR_OFF_DEVMINOR = 337;
export const TAR_LEN_DEVMINOR = 8;
export const TAR_OFF_PREFIX = 345;
export const TAR_LEN_PREFIX = 155;

// ---------------------------------------------------------------------------
// TAR typeflags
// ---------------------------------------------------------------------------

export const TAR_TYPEFLAG_FILE_NUL = '\0';
export const TAR_TYPEFLAG_FILE = '0';
export const TAR_TYPEFLAG_HARDLINK = '1';
export const TAR_TYPEFLAG_SYMLINK = '2';
export const TAR_TYPEFLAG_CHARDEV = '3';
export const TAR_TYPEFLAG_BLOCKDEV = '4';
export const TAR_TYPEFLAG_DIRECTORY = '5';
export const TAR_TYPEFLAG_FIFO = '6';
export const TAR_TYPEFLAG_PAX_EXTENDED = 'x';
export const TAR_TYPEFLAG_PAX_GLOBAL = 'g';

// ---------------------------------------------------------------------------
// TAR ustar magic
// ---------------------------------------------------------------------------

/** "ustar\0" — 6 bytes. Required for POSIX ustar format. */
export const TAR_MAGIC = 'ustar\0';

/** "00" — version string for POSIX ustar. */
export const TAR_VERSION = '00';

// ---------------------------------------------------------------------------
// GZip magic
// ---------------------------------------------------------------------------

/** GZip member magic bytes: 0x1F 0x8B */
export const GZIP_MAGIC_0 = 0x1f;
export const GZIP_MAGIC_1 = 0x8b;

/** GZip compression method: 0x08 = Deflate */
export const GZIP_CM_DEFLATE = 0x08;

// GZip flag bits
export const GZIP_FLAG_FTEXT = 0x01;
export const GZIP_FLAG_FHCRC = 0x02;
export const GZIP_FLAG_FEXTRA = 0x04;
export const GZIP_FLAG_FNAME = 0x08;
export const GZIP_FLAG_FCOMMENT = 0x10;

// ---------------------------------------------------------------------------
// bzip2 / xz magic (detection only — native parsing deferred to backend-wasm)
// ---------------------------------------------------------------------------

/** bzip2 magic: "BZh" = 0x42 0x5A 0x68 */
export const BZ2_MAGIC = [0x42, 0x5a, 0x68] as const;

/** xz magic: 0xFD 0x37 0x7A 0x58 0x5A 0x00 */
export const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] as const;

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const ZIP_MIME = 'application/zip';
export const TAR_MIME = 'application/x-tar';
export const GZIP_MIME = 'application/gzip';
export const TGZ_MIME = 'application/gzip'; // same MIME, different extension
export const BZ2_MIME = 'application/x-bzip2';
export const XZ_MIME = 'application/x-xz';

// ---------------------------------------------------------------------------
// Serializer defaults
// ---------------------------------------------------------------------------

/**
 * Minimum entry size (bytes) at which Deflate compression is used
 * in serializeZip when opts.method is omitted.
 */
export const ZIP_COMPRESS_THRESHOLD = 64;

/** Version needed to extract for standard ZIP (no encryption, no ZIP64). */
export const ZIP_VERSION_NEEDED = 20;

/** Version made by: 0x0314 = UNIX host, version 3.14. */
export const ZIP_VERSION_MADE_BY = 0x0314;
