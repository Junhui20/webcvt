/**
 * Sample table box parsers and serializers.
 *
 * Boxes covered:
 *   stts — Time-to-Sample (§8.6.1.2), RLE-encoded (Trap §10)
 *   stsc — Sample-to-Chunk (§8.7.4), RLE-encoded (Trap §3)
 *   stsz — Sample Size (§8.7.3.2), constant or per-sample (Trap §5)
 *   stco — Chunk Offset 32-bit (§8.7.5)
 *   co64 — Chunk Offset 64-bit (§8.7.5), (Trap §4)
 *
 * All are FullBoxes: version(u8) + flags(u24) before the table data.
 * Entry counts are capped at MAX_TABLE_ENTRIES (1,000,000).
 * All fields are big-endian (Trap §7).
 *
 * Sample table computation:
 *   - sampleOffsets[i]: computed from stsc (which chunk) + stco/co64 (chunk offset)
 *     + stsz (cumulative per-sample sizes within the chunk).
 *   - sampleDeltas[i]: expanded from stts RLE entries.
 *   - sampleSizes[i]: expanded from stsz.
 *
 * Box ordering: readers tolerate any order (Trap §12). Writers emit:
 *   stsd → stts → stsc → stsz → stco/co64 (canonical order).
 */

import { MAX_TABLE_ENTRIES } from '../constants.ts';
import { Mp4InvalidBoxError, Mp4TableTooLargeError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw parsed stts (time-to-sample) RLE table. */
export interface SttsEntry {
  sampleCount: number;
  sampleDelta: number;
}

/** Raw parsed stsc (sample-to-chunk) RLE table. */
export interface StscEntry {
  firstChunk: number; // 1-based chunk index
  samplesPerChunk: number;
  sampleDescriptionIndex: number;
}

/** Parsed stco/co64 chunk offset table. */
export interface StcoTable {
  /** Chunk offsets as numbers (both u32 stco and u64 co64 are widened to number). */
  offsets: readonly number[];
  /** 'stco' or 'co64' — used to decide serialization format. */
  variant: 'stco' | 'co64';
}

/** Computed, expanded sample table (after RLE expansion). */
export interface Mp4SampleTable {
  /** Per-sample byte length. */
  sampleSizes: Uint32Array;
  /** Per-sample absolute file offset (as number; files < 2^53 bytes are safe). */
  sampleOffsets: Float64Array;
  /** Per-sample duration in mdhd.timescale units. */
  sampleDeltas: Uint32Array;
  sampleCount: number;
}

// ---------------------------------------------------------------------------
// stts parser
// ---------------------------------------------------------------------------

/**
 * Parse the stts FullBox payload.
 * Returns the raw RLE entries (not expanded — expansion happens in buildSampleTable).
 */
export function parseStts(payload: Uint8Array): SttsEntry[] {
  // FullBox: version(1)+flags(3) = 4 bytes, entry_count(4) = 4 bytes → 8 bytes
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError('stts payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const entryCount = view.getUint32(4, false);

  if (entryCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError('stts', entryCount, MAX_TABLE_ENTRIES);
  }
  if (payload.length < 8 + entryCount * 8) {
    throw new Mp4InvalidBoxError(`stts payload too short for ${entryCount} entries.`);
  }

  const entries: SttsEntry[] = [];
  let off = 8;
  for (let i = 0; i < entryCount; i++) {
    const sampleCount = view.getUint32(off, false);
    const sampleDelta = view.getUint32(off + 4, false);
    entries.push({ sampleCount, sampleDelta });
    off += 8;
  }
  return entries;
}

/**
 * Serialize stts entries to FullBox payload bytes (including the box header).
 */
export function serializeStts(entries: SttsEntry[]): Uint8Array {
  const payloadSize = 8 + entries.length * 8;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x74;
  out[7] = 0x73; // 'stts'
  // version=0, flags=0 at 8-11
  view.setUint32(12, entries.length, false);
  let off = 16;
  for (const e of entries) {
    view.setUint32(off, e.sampleCount, false);
    view.setUint32(off + 4, e.sampleDelta, false);
    off += 8;
  }
  return out;
}

// ---------------------------------------------------------------------------
// stsc parser
// ---------------------------------------------------------------------------

/**
 * Parse the stsc FullBox payload.
 */
export function parseStsc(payload: Uint8Array): StscEntry[] {
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError('stsc payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const entryCount = view.getUint32(4, false);

  if (entryCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError('stsc', entryCount, MAX_TABLE_ENTRIES);
  }
  if (payload.length < 8 + entryCount * 12) {
    throw new Mp4InvalidBoxError(`stsc payload too short for ${entryCount} entries.`);
  }

  const entries: StscEntry[] = [];
  let off = 8;
  for (let i = 0; i < entryCount; i++) {
    const firstChunk = view.getUint32(off, false);
    const samplesPerChunk = view.getUint32(off + 4, false);
    const sampleDescriptionIndex = view.getUint32(off + 8, false);
    entries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex });
    off += 12;
  }
  return entries;
}

/**
 * Serialize stsc entries (including box header).
 */
export function serializeStsc(entries: StscEntry[]): Uint8Array {
  const payloadSize = 8 + entries.length * 12;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x73;
  out[7] = 0x63; // 'stsc'
  view.setUint32(12, entries.length, false);
  let off = 16;
  for (const e of entries) {
    view.setUint32(off, e.firstChunk, false);
    view.setUint32(off + 4, e.samplesPerChunk, false);
    view.setUint32(off + 8, e.sampleDescriptionIndex, false);
    off += 12;
  }
  return out;
}

// ---------------------------------------------------------------------------
// stsz parser
// ---------------------------------------------------------------------------

/**
 * Parse the stsz FullBox payload.
 *
 * Trap §5: if sample_size != 0 all samples have that constant size and
 * no per-sample table is present. If sample_size == 0, a per-sample
 * table of sample_count u32 entries follows.
 */
export function parseStsz(payload: Uint8Array): Uint32Array {
  // version(1)+flags(3)+sample_size(4)+sample_count(4) = 12 bytes minimum
  if (payload.length < 12) {
    throw new Mp4InvalidBoxError('stsz payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const sampleSize = view.getUint32(4, false);
  const sampleCount = view.getUint32(8, false);

  if (sampleCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError('stsz', sampleCount, MAX_TABLE_ENTRIES);
  }

  if (sampleSize !== 0) {
    // Constant size — broadcast into a typed array.
    const sizes = new Uint32Array(sampleCount);
    sizes.fill(sampleSize);
    return sizes;
  }

  // Per-sample table.
  if (payload.length < 12 + sampleCount * 4) {
    throw new Mp4InvalidBoxError(`stsz payload too short for ${sampleCount} per-sample entries.`);
  }
  const sizes = new Uint32Array(sampleCount);
  let off = 12;
  for (let i = 0; i < sampleCount; i++) {
    sizes[i] = view.getUint32(off, false);
    off += 4;
  }
  return sizes;
}

/**
 * Serialize stsz (including box header) from a per-sample sizes array.
 * Always writes per-sample table format (sample_size=0) for generality.
 */
export function serializeStsz(sizes: Uint32Array): Uint8Array {
  const payloadSize = 12 + sizes.length * 4;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x73;
  out[7] = 0x7a; // 'stsz'
  // version=0, flags=0
  view.setUint32(12, 0, false); // sample_size = 0 (per-sample table)
  view.setUint32(16, sizes.length, false);
  let off = 20;
  for (let i = 0; i < sizes.length; i++) {
    view.setUint32(off, sizes[i] ?? 0, false);
    off += 4;
  }
  return out;
}

// ---------------------------------------------------------------------------
// stco / co64 parser
// ---------------------------------------------------------------------------

/**
 * Parse either stco (32-bit) or co64 (64-bit) chunk offset FullBox payload.
 *
 * Trap §4: exactly one of stco or co64 is present. Reader handles both;
 * co64 offsets are treated as number (safe up to 2^53 for realistic files).
 */
export function parseStcoOrCo64(payload: Uint8Array, variant: 'stco' | 'co64'): StcoTable {
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError(`${variant} payload too short.`);
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const entryCount = view.getUint32(4, false);

  if (entryCount > MAX_TABLE_ENTRIES) {
    throw new Mp4TableTooLargeError(variant, entryCount, MAX_TABLE_ENTRIES);
  }

  const offsets: number[] = [];

  if (variant === 'stco') {
    if (payload.length < 8 + entryCount * 4) {
      throw new Mp4InvalidBoxError(`stco payload too short for ${entryCount} entries.`);
    }
    let off = 8;
    for (let i = 0; i < entryCount; i++) {
      offsets.push(view.getUint32(off, false));
      off += 4;
    }
  } else {
    // co64: 8 bytes per entry (u64, big-endian)
    if (payload.length < 8 + entryCount * 8) {
      throw new Mp4InvalidBoxError(`co64 payload too short for ${entryCount} entries.`);
    }
    let off = 8;
    for (let i = 0; i < entryCount; i++) {
      const hi = view.getUint32(off, false);
      const lo = view.getUint32(off + 4, false);
      offsets.push(hi * 0x100000000 + lo);
      off += 8;
    }
  }

  return { offsets, variant };
}

/**
 * Serialize stco (including box header) from an array of chunk offsets.
 * Caller must have already verified all offsets fit in u32 when writing stco.
 */
export function serializeStco(offsets: readonly number[]): Uint8Array {
  const payloadSize = 8 + offsets.length * 4;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x73;
  out[5] = 0x74;
  out[6] = 0x63;
  out[7] = 0x6f; // 'stco'
  view.setUint32(12, offsets.length, false);
  let off = 16;
  for (const o of offsets) {
    view.setUint32(off, o >>> 0, false);
    off += 4;
  }
  return out;
}

/**
 * Serialize co64 (including box header) from an array of chunk offsets.
 */
export function serializeCo64(offsets: readonly number[]): Uint8Array {
  const payloadSize = 8 + offsets.length * 8;
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, boxSize, false);
  out[4] = 0x63;
  out[5] = 0x6f;
  out[6] = 0x36;
  out[7] = 0x34; // 'co64'
  view.setUint32(12, offsets.length, false);
  let off = 16;
  for (const o of offsets) {
    const hi = Math.floor(o / 0x100000000);
    const lo = o >>> 0;
    view.setUint32(off, hi, false);
    view.setUint32(off + 4, lo, false);
    off += 8;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sample table builder
// ---------------------------------------------------------------------------

/**
 * Build the flat, expanded Mp4SampleTable from raw parsed box data.
 *
 * Algorithm:
 *   1. Expand stts RLE → sampleDeltas (Trap §10).
 *   2. Expand stsz → sampleSizes (Trap §5, already done in parseStsz).
 *   3. Expand stsc RLE + stco offsets → sampleOffsets (Trap §3):
 *      For each chunk index c (1-based):
 *        Find the stsc entry that governs chunk c (last entry with firstChunk <= c).
 *        For each sample s within the chunk:
 *          sampleOffset = chunkOffset + sum of preceding sample sizes in the chunk.
 *
 * @param sttsEntries  Raw stts RLE entries.
 * @param sampleSizes  Flat per-sample size array (from parseStsz).
 * @param stscEntries  Raw stsc RLE entries.
 * @param chunkOffsets Chunk offsets (from parseStcoOrCo64.offsets).
 */
export function buildSampleTable(
  sttsEntries: SttsEntry[],
  sampleSizes: Uint32Array,
  stscEntries: StscEntry[],
  chunkOffsets: readonly number[],
): Mp4SampleTable {
  const sampleCount = sampleSizes.length;

  // 1. Expand stts RLE into flat sampleDeltas.
  const sampleDeltas = new Uint32Array(sampleCount);
  let sampleIdx = 0;
  for (const entry of sttsEntries) {
    for (let i = 0; i < entry.sampleCount && sampleIdx < sampleCount; i++) {
      sampleDeltas[sampleIdx++] = entry.sampleDelta;
    }
  }

  // 2. Build sampleOffsets by iterating over chunks using stsc RLE (Trap §3).
  // Float64Array to hold file offsets safely (files < 2^53 bytes).
  const sampleOffsets = new Float64Array(sampleCount);

  const chunkCount = chunkOffsets.length;
  let globalSampleIdx = 0;
  let stscIdx = 0; // pointer into stscEntries

  for (let chunkIdx = 1; chunkIdx <= chunkCount; chunkIdx++) {
    // Advance stscIdx: the current stsc entry is the last one whose firstChunk <= chunkIdx.
    while (
      stscIdx + 1 < stscEntries.length &&
      (stscEntries[stscIdx + 1]?.firstChunk ?? Number.POSITIVE_INFINITY) <= chunkIdx
    ) {
      stscIdx++;
    }

    const currentEntry = stscEntries[stscIdx];
    const samplesInChunk = currentEntry?.samplesPerChunk ?? 0;
    const chunkFileOffset = chunkOffsets[chunkIdx - 1] ?? 0;

    // Assign sample offsets for samples in this chunk.
    let byteOffset = chunkFileOffset;
    for (let s = 0; s < samplesInChunk; s++) {
      if (globalSampleIdx >= sampleCount) break;
      sampleOffsets[globalSampleIdx] = byteOffset;
      byteOffset += sampleSizes[globalSampleIdx] ?? 0;
      globalSampleIdx++;
    }
  }

  return {
    sampleSizes,
    sampleOffsets,
    sampleDeltas,
    sampleCount,
  };
}
