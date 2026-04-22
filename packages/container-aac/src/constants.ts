/**
 * Shared constants for the @catlabtech/webcvt-container-aac package.
 *
 * Centralising limits here ensures backend.ts and parser.ts cannot drift.
 */

/** Maximum input buffer size accepted by parseAdts and AacBackend.convert (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/**
 * When scanning for the next 0xFFF sync after a parse error, cap the
 * search distance to prevent O(n) CPU DoS on pathological inputs.
 */
export const SYNC_SCAN_CAP = 1 * 1024 * 1024; // 1 MiB

/**
 * Threshold for declaring a stream corrupt: if more than this many sync candidates
 * were attempted and ALL were rejected, throw instead of returning empty frames.
 */
export const MIN_CANDIDATES_FOR_CORRUPT = 8;

/**
 * Maximum number of trailing junk bytes allowed after the last valid ADTS frame.
 * Some muxers pad files with zeros or garbage.
 */
export const MAX_TRAILING_JUNK = 4 * 1024; // 4 KiB

/** Minimum bytes needed to hold a 7-byte ADTS header. */
export const ADTS_MIN_HEADER_BYTES = 7;

/** Size of ADTS CRC field in bytes. */
export const ADTS_CRC_SIZE = 2;

/**
 * Maximum cumulative bytes scanned by scanForSync across the entire parser loop.
 * Bounds O(n²) worst-case on files with many junk windows interspersed between frames.
 * 16 MiB covers ~16 valid 1 MiB scan windows — generous for legitimate files with corrupt regions.
 */
export const MAX_TOTAL_SYNC_SCAN_BYTES = 16 * 1024 * 1024;
