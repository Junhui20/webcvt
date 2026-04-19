/**
 * Shared constants for @webcvt/container-webm.
 *
 * All security caps are derived from the design note §"Security caps".
 * Centralised here so parser.ts, serializer.ts, and backend.ts cannot drift.
 */

/** Maximum input buffer size accepted by parseWebm (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/**
 * Maximum size for any single non-Cluster non-Segment EBML element (64 MiB).
 * Cluster and Segment are exempted or have their own caps.
 */
export const MAX_ELEMENT_PAYLOAD_BYTES = 64 * 1024 * 1024;

/** Maximum size for a single Cluster element (256 MiB). */
export const MAX_CLUSTER_BYTES = 256 * 1024 * 1024;

/** Maximum total EBML element count across the entire file. */
export const MAX_ELEMENTS_PER_FILE = 100_000;

/**
 * Maximum EBML element nesting depth (iterative stack depth cap).
 * WebM deepest legitimate path is EBML → Segment → Cluster → SimpleBlock (~4 levels).
 * 8 gives comfortable headroom against adversarial deep nesting.
 */
export const MAX_NEST_DEPTH = 8;

/** Maximum number of blocks per track (generous given the 200 MiB input cap). */
export const MAX_BLOCKS_PER_TRACK = 10_000_000;

/** Maximum VINT width in bytes per RFC 8794. */
export const MAX_VINT_WIDTH = 8;

/** Maximum CodecPrivate payload per track (1 MiB; Vorbis init is typically 5-20 KB). */
export const MAX_CODEC_PRIVATE_BYTES = 1 * 1024 * 1024;

/** Maximum number of CuePoint entries in the Cues element. */
export const MAX_CUE_POINTS = 1_000_000;

/** Default TimecodeScale when absent from Info (1 ms = 1,000,000 ns per tick). */
export const DEFAULT_TIMECODE_SCALE = 1_000_000;

// ---------------------------------------------------------------------------
// EBML element IDs (numeric, with leading length-marker bit retained)
// ---------------------------------------------------------------------------

export const ID_EBML = 0x1a45dfa3;
export const ID_SEGMENT = 0x18538067;

// EBML header children
export const ID_EBML_VERSION = 0x4286;
export const ID_EBML_READ_VERSION = 0x42f7;
export const ID_EBML_MAX_ID_LENGTH = 0x42f2;
export const ID_EBML_MAX_SIZE_LENGTH = 0x42f3;
export const ID_DOCTYPE = 0x4282;
export const ID_DOCTYPE_VERSION = 0x4287;
export const ID_DOCTYPE_READ_VERSION = 0x4285;

// Segment children
export const ID_SEEK_HEAD = 0x114d9b74;
export const ID_INFO = 0x1549a966;
export const ID_TRACKS = 0x1654ae6b;
export const ID_CLUSTER = 0x1f43b675;
export const ID_CUES = 0x1c53bb6b;
export const ID_VOID = 0xec;

// SeekHead children
export const ID_SEEK = 0x4dbb;
export const ID_SEEK_ID = 0x53ab;
export const ID_SEEK_POSITION = 0x53ac;

// Info children
export const ID_TIMECODE_SCALE = 0x2ad7b1;
export const ID_DURATION = 0x4489;
export const ID_MUXING_APP = 0x4d80;
export const ID_WRITING_APP = 0x5741;
export const ID_DATE_UTC = 0x4461;

// Tracks children
export const ID_TRACK_ENTRY = 0xae;
export const ID_TRACK_NUMBER = 0xd7;
export const ID_TRACK_UID = 0x73c5;
export const ID_TRACK_TYPE = 0x83;
export const ID_FLAG_ENABLED = 0xb9;
export const ID_FLAG_DEFAULT = 0x88;
export const ID_FLAG_LACING = 0x9c;
export const ID_DEFAULT_DURATION = 0x23e383;
export const ID_CODEC_ID = 0x86;
export const ID_CODEC_PRIVATE = 0x63a2;
export const ID_CODEC_DELAY = 0x56aa;
export const ID_SEEK_PRE_ROLL = 0x56bb;
export const ID_LANGUAGE = 0x22b59c;

// Video sub-element IDs
export const ID_VIDEO = 0xe0;
export const ID_PIXEL_WIDTH = 0xb0;
export const ID_PIXEL_HEIGHT = 0xba;
export const ID_DISPLAY_WIDTH = 0x54b0;
export const ID_DISPLAY_HEIGHT = 0x54ba;

// Audio sub-element IDs
export const ID_AUDIO = 0xe1;
export const ID_SAMPLING_FREQUENCY = 0xb5;
export const ID_CHANNELS = 0x9f;
export const ID_BIT_DEPTH = 0x6264;

// Cluster children
export const ID_TIMECODE = 0xe7;
export const ID_SIMPLE_BLOCK = 0xa3;

// Cues children
export const ID_CUE_POINT = 0xbb;
export const ID_CUE_TIME = 0xb3;
export const ID_CUE_TRACK_POSITIONS = 0xb7;
export const ID_CUE_TRACK = 0xf7;
export const ID_CUE_CLUSTER_POSITION = 0xf1;
export const ID_CUE_RELATIVE_POSITION = 0xf0;
export const ID_CUE_DURATION = 0xb2;

// ---------------------------------------------------------------------------
// Codec ID allowlist (exact string match, case-sensitive)
// ---------------------------------------------------------------------------

export const ALLOWED_CODEC_IDS = new Set(['V_VP8', 'V_VP9', 'A_VORBIS', 'A_OPUS']);

// ---------------------------------------------------------------------------
// MIME types handled by this backend
// ---------------------------------------------------------------------------

export const WEBM_MIMES = new Set(['video/webm', 'audio/webm']);

// ---------------------------------------------------------------------------
// Serializer layout constants
// ---------------------------------------------------------------------------

/** Reserved byte budget for the SeekHead element in the muxer output. */
export const SEEK_HEAD_RESERVED_BYTES = 96;

/** VINT width used for Segment.size in the muxer (always 8 bytes for back-patching). */
export const SEGMENT_SIZE_VINT_WIDTH = 8;
