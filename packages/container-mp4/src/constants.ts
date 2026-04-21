/**
 * Shared constants for @webcvt/container-mp4.
 *
 * Centralising limits here ensures parser.ts, serializer.ts, and backend.ts
 * cannot drift from each other. All security caps are derived from the design
 * note §"Security caps".
 */

/** Maximum input buffer size accepted by parseMp4 (200 MiB). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/**
 * Maximum size for any single non-mdat box (64 MiB).
 * mdat is exempted because it holds the bulk sample data.
 */
export const MAX_BOX_SIZE_NON_MDAT = 64 * 1024 * 1024;

/** Maximum total number of boxes allowed per file (guards deeply-nested or repeated boxes). */
export const MAX_BOXES_PER_FILE = 10_000;

/**
 * Maximum container descent depth (iterative stack depth cap).
 * moov → trak → mdia → minf → stbl → stsd → mp4a → esds is already 8 deep,
 * so 10 is tight by design — it forces an iterative stack rather than unbounded recursion.
 */
export const MAX_DEPTH = 10;

/**
 * Maximum entry_count for stsz, stts, stsc, stco/co64, stsd, dref tables.
 * Guards against pathological memory allocation from crafted entry counts.
 */
export const MAX_TABLE_ENTRIES = 1_000_000;

/**
 * Maximum size for an esds descriptor payload (16 MiB).
 * Bounds the variable-length descriptor reader against crafted size fields.
 */
export const MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024;

/**
 * Accepted major and compatible brands.
 * Phase 3 sub-pass D adds fragmented-MP4 brands (iso5, iso6, dash, cmfc, cmf2, iso9).
 */
export const ACCEPTED_BRANDS = new Set([
  'mp42',
  'M4A ',
  'M4V ',
  'isom',
  'qt  ',
  // Fragmented MP4 / CMAF brands added in sub-pass D:
  'iso5',
  'iso6',
  'dash',
  'cmfc',
  'cmf2',
  'iso9',
]);

/**
 * Fragmented MP4 brands formerly rejected; now empty — all brands accepted
 * and distinguishment is done by mvex presence at parse time.
 */
export const REJECTED_BRANDS = new Set<string>();

/**
 * Four-CC for boxes that are known ISO-base containers (children parsed by box-tree walker).
 *
 * 'meta' is intentionally excluded: it is a FullBox container whose first 4 bytes
 * are version+flags, not a child box header. Walking inside meta without skipping
 * the FullBox prefix misreads its content. We never need to walk meta for audio M4A
 * parsing; udta is included so its children are visible but meta itself is opaque.
 *
 * Phase 3 sub-pass D additions: 'mvex', 'moof', 'traf'.
 */
export const CONTAINER_BOX_TYPES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'dinf',
  'stbl',
  'udta',
  'edts',
  // Fragmented MP4 containers (sub-pass D):
  'mvex',
  'moof',
  'traf',
]);

// ---------------------------------------------------------------------------
// Fragmented MP4 security caps (sub-pass D)
// ---------------------------------------------------------------------------

/** Maximum number of movie fragments (moof boxes) per file. */
export const MAX_FRAGMENTS = 100_000;

/** Maximum sample_count per trun box. */
export const MAX_SAMPLES_PER_TRUN = 1_000_000;

/** Maximum number of traf boxes per moof. */
export const MAX_TRAFS_PER_MOOF = 64;

/** Maximum number of trex boxes per mvex. Real files have one per track. */
export const MAX_TREX_PER_MVEX = 256;

/** Maximum number of sidx references per sidx box (D.3). */
export const MAX_SIDX_REFERENCES = 65_536;

/** Maximum sidx nesting depth (D.3). */
export const MAX_SIDX_DEPTH = 8;

/** Canonical output brand set when synthesising a new M4A file. */
export const CANONICAL_MAJOR_BRAND = 'mp42';
export const CANONICAL_COMPATIBLE_BRANDS = ['isom', 'mp42', 'M4A '];

/**
 * Maximum entry_count allowed in an `elst` (Edit List) box.
 * Real files have ≤4 entries. 4096 keeps worst-case allocation under 100 KB.
 */
export const MAX_ELST_ENTRIES = 4096;

// ---------------------------------------------------------------------------
// udta/meta/ilst security caps
// ---------------------------------------------------------------------------

/**
 * Maximum number of ilst child atoms (metadata entries).
 * Real files have ≤30 entries. 1024 is a generous cap.
 */
export const MAX_METADATA_ATOMS = 1024;

/**
 * Maximum payload bytes for a single non-cover-art metadata atom (4 MiB).
 * Bounds memory use from crafted large payloads.
 */
export const MAX_METADATA_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Maximum payload bytes for a single cover art (covr) data atom (16 MiB).
 * Cover images can legitimately be large (high-res album art).
 */
export const MAX_COVER_ART_BYTES = 16 * 1024 * 1024;
