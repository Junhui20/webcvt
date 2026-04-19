/**
 * Shared constants for the @webcvt/container-ogg package.
 *
 * Centralising limits here ensures parser.ts, serializer.ts, and backend.ts
 * cannot drift from each other.
 */

/** Maximum input buffer size accepted by parseOgg and OggBackend.convert (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/**
 * Maximum number of pages to parse. Derived from 200 MiB / 100 bytes (min page)
 * ≈ 2 million pages. Prevents CPU DoS on pathological inputs.
 */
export const MAX_PAGES = 2_000_000;

/**
 * Maximum body size for a single Ogg page.
 * Segment table has at most 255 entries × 255 bytes each = 65,025 bytes.
 */
export const MAX_PAGE_BODY_BYTES = 255 * 255; // 65,025

/**
 * Maximum size of a single reassembled packet (across continued pages).
 * Caps unbounded growth from crafted continued-packet chains.
 */
export const MAX_PACKET_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Maximum total number of audio packets per logical stream.
 * Guards against pathological inputs with millions of zero-byte packets.
 */
export const MAX_PACKETS_PER_STREAM = 1_000_000;

/**
 * Maximum number of Vorbis-comment / OpusTags user comment fields.
 * Mirrors container-flac's decodeVorbisComment cap.
 */
export const MAX_COMMENT_COUNT = 100_000;

/**
 * Maximum byte length of a single Vorbis-comment / OpusTags comment field (1 MiB).
 */
export const MAX_COMMENT_BYTES = 1 * 1024 * 1024;

/**
 * When re-syncing after a parse error, cap the forward search at this many bytes
 * per call to prevent O(n) CPU DoS on pathological inputs (mirrors AAC SYNC_SCAN_CAP).
 */
export const SYNC_SCAN_CAP = 1 * 1024 * 1024; // 1 MiB

/**
 * Maximum cumulative bytes scanned during sync recovery across the entire parser loop.
 * Bounds O(n²) worst-case on files with many junk regions.
 */
export const MAX_TOTAL_SYNC_SCAN_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * CRC corruption threshold: if more than this fraction of pages fail CRC and
 * zero packets were emitted, the stream is declared corrupt.
 */
export const CRC_CORRUPT_THRESHOLD = 0.5;

/**
 * Minimum pages attempted before applying the CRC corruption fraction check.
 */
export const MIN_PAGES_FOR_CORRUPT_CHECK = 8;

/** Ogg capture pattern as a byte array. */
export const OGG_CAPTURE_PATTERN = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // "OggS"

/** Ogg stream structure version — must be 0. */
export const OGG_STREAM_VERSION = 0;

/** Fixed-size Ogg page header (before segment table). */
export const OGG_PAGE_HEADER_BASE = 27;

/** Default target page body size for the serializer (bytes). */
export const DEFAULT_PAGE_BODY_SIZE = 4096;

/** Opus pre_skip default: 80 ms × 48 kHz = 3840 samples (RFC 7845 §4.2). */
export const OPUS_DEFAULT_PRE_SKIP = 3840;

/** Granule position value meaning "no packet completed on this page" (RFC 3533). */
export const GRANULE_POSITION_NONE = -1n;
