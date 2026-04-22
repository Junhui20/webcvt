/**
 * Shared constants for @catlabtech/webcvt-container-ts.
 *
 * All security caps are derived from the design note §"Security caps".
 * Centralised here so parser.ts, serializer.ts, and backend.ts cannot drift.
 */

// ---------------------------------------------------------------------------
// Security caps
// ---------------------------------------------------------------------------

/** Maximum input buffer size accepted by parseTs (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Maximum TS packet count (200 MiB / 188 + headroom). */
export const MAX_PACKETS = 1_200_000;

/** Maximum PSI section size in bytes. Spec max for PAT/PMT is 1024; SI tables 4096. */
export const MAX_PSI_SECTION_BYTES = 4096;

/** Maximum distinct PSI PIDs tracked. */
export const MAX_PSI_PIDS = 64;

/** Maximum elementary-stream PIDs per program. */
export const MAX_ES_PIDS = 16;

/** Maximum PES packet size (16 MiB). */
export const MAX_PES_BYTES = 16 * 1024 * 1024;

/** Maximum bytes to scan when acquiring sync (1 MiB). */
export const MAX_SYNC_SCAN_BYTES = 1 * 1024 * 1024;

/** Maximum packets to wait for PMT after PAT before throwing. */
export const MAX_PSI_WAIT_PACKETS = 500;

/** Discontinuity warning throttle — warn every N after the threshold. */
export const DISCONTINUITY_WARN_THRESHOLD = 100;
export const DISCONTINUITY_WARN_INTERVAL = 1000;

// ---------------------------------------------------------------------------
// TS packet constants
// ---------------------------------------------------------------------------

/** MPEG-TS packet size in bytes. */
export const TS_PACKET_SIZE = 188;

/** TS sync byte. */
export const TS_SYNC_BYTE = 0x47;

/** Well-known PIDs. */
export const PID_PAT = 0x0000;
export const PID_NULL = 0x1fff;

// ---------------------------------------------------------------------------
// Stream types (ISO/IEC 13818-1 Table 2-34)
// ---------------------------------------------------------------------------

/** H.264 / AVC video. */
export const STREAM_TYPE_AVC = 0x1b;

/** AAC ADTS audio (ISO/IEC 13818-7). */
export const STREAM_TYPE_AAC_ADTS = 0x0f;

/** MPEG-2 video (deferred). */
export const STREAM_TYPE_MPEG2_VIDEO = 0x02;

/** MPEG-1 video (deferred). */
export const STREAM_TYPE_MPEG1_VIDEO = 0x01;

/** MPEG-1/2 audio (deferred). */
export const STREAM_TYPE_MPEG1_AUDIO = 0x03;
export const STREAM_TYPE_MPEG2_AUDIO = 0x04;

/** Private PES (deferred — requires descriptor walk). */
export const STREAM_TYPE_PRIVATE_PES = 0x06;

/** HEVC video (deferred). */
export const STREAM_TYPE_HEVC = 0x24;

/** AC-3 audio (deferred). */
export const STREAM_TYPE_AC3 = 0x81;

/** E-AC-3 audio (deferred). */
export const STREAM_TYPE_EAC3 = 0x87;

/** DTS audio (deferred). */
export const STREAM_TYPE_DTS = 0x82;

/** Set of supported stream types in first pass. */
export const SUPPORTED_STREAM_TYPES = new Set([STREAM_TYPE_AVC, STREAM_TYPE_AAC_ADTS]);

// ---------------------------------------------------------------------------
// PSI table IDs
// ---------------------------------------------------------------------------

export const TABLE_ID_PAT = 0x00;
export const TABLE_ID_PMT = 0x02;

// ---------------------------------------------------------------------------
// Muxer defaults (HLS-style PID assignments)
// ---------------------------------------------------------------------------

/** Default PMT PID when building from scratch. */
export const DEFAULT_PMT_PID = 0x1000;

/** Default video ES PID. */
export const DEFAULT_VIDEO_PID = 0x0100;

/** Default audio ES PID. */
export const DEFAULT_AUDIO_PID = 0x0101;

/** PCR refresh interval in packets (~100ms worth at typical bitrates). */
export const PCR_REFRESH_INTERVAL_PACKETS = 50;

/** PSI refresh interval in packets. */
export const PSI_REFRESH_INTERVAL_PACKETS = 100;

// ---------------------------------------------------------------------------
// MIME type
// ---------------------------------------------------------------------------

export const TS_MIME = 'video/mp2t';
