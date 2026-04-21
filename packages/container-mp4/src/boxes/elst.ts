/**
 * Edit List box parser and serializer — `elst` inside `edts`.
 *
 * Spec: ISO/IEC 14496-12 §8.6.5 (`edts`) and §8.6.6 (`elst`).
 * Clean-room implementation: spec only, no mp4box.js / ffmpeg / Bento4 consulted.
 *
 * Wire format:
 *   [size:u32][type:'elst'][version:u8][flags:u24][entry_count:u32]
 *   Per entry (v0 = 12 bytes, v1 = 20 bytes):
 *     v0: [segment_duration:u32][media_time:i32][rate_int:i16][rate_frac:i16]
 *     v1: [segment_duration:u64][media_time:i64][rate_int:i16][rate_frac:i16]
 *
 * Key traps:
 *   - media_time is SIGNED (int32 / int64). Use getInt32, not getUint32.
 *   - -1 sentinel means "empty edit" — check BEFORE any arithmetic.
 *   - v1 entry size is 20 bytes, v0 is 12 bytes — must pick the right constant.
 *   - segment_duration is in movie timescale; media_time is in media timescale.
 *   - entry_count == 0 is legal (pre-2010 iTunes). Returns [].
 */

import { MAX_ELST_ENTRIES } from '../constants.ts';
import {
  Mp4ElstBadEntryCountError,
  Mp4ElstSignBitError,
  Mp4ElstTooManyEntriesError,
  Mp4ElstUnsupportedRateError,
  Mp4ElstValueOutOfRangeError,
  Mp4InvalidBoxError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const V0_ENTRY_SIZE = 12;
const V1_ENTRY_SIZE = 20;
/** Header bytes inside the payload: version(1) + flags(3) + entry_count(4). */
const FULLBOX_HEADER_BYTES = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single entry in an `elst` box.
 *
 * - `segmentDuration`: in movie-timescale (mvhd.timescale) units.
 * - `mediaTime`: in media-timescale (mdhd.timescale) units.
 *   -1 means empty edit (silence / priming offset).
 * - `mediaRate`: narrowed literal 1 (fractional / non-1 rates are rejected).
 * - `sourceVersion`: 0 or 1, preserved for round-trip serialization.
 */
export interface EditListEntry {
  segmentDuration: number;
  mediaTime: number;
  mediaRate: 1;
  sourceVersion: 0 | 1;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the payload bytes of an `elst` FullBox (including version+flags prefix).
 *
 * @returns Array of EditListEntry. Empty array when entry_count == 0.
 * @throws Mp4InvalidBoxError — payload too short for version+flags.
 * @throws Mp4ElstBadEntryCountError — payload length does not match entry_count.
 * @throws Mp4ElstTooManyEntriesError — entry_count > MAX_ELST_ENTRIES.
 * @throws Mp4ElstUnsupportedRateError — rate_integer != 1 or rate_fraction != 0.
 * @throws Mp4ElstSignBitError — media_time < -1.
 * @throws Mp4ElstValueOutOfRangeError — v1 value exceeds Number.MAX_SAFE_INTEGER.
 */
export function parseElst(payload: Uint8Array): EditListEntry[] {
  if (payload.length < FULLBOX_HEADER_BYTES) {
    throw new Mp4InvalidBoxError(
      `elst payload too short (${payload.length} bytes); need at least ${FULLBOX_HEADER_BYTES} for version+flags+entry_count.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  const versionByte = payload[0] ?? 0;
  if (versionByte !== 0 && versionByte !== 1) {
    throw new Mp4InvalidBoxError(
      `elst unsupported version ${versionByte}; only 0 and 1 are recognised.`,
    );
  }
  const version = versionByte as 0 | 1;

  const entryCount = view.getUint32(4, false);

  // Security cap.
  if (entryCount > MAX_ELST_ENTRIES) {
    throw new Mp4ElstTooManyEntriesError(entryCount, MAX_ELST_ENTRIES);
  }

  // Empty elst is legal.
  if (entryCount === 0) {
    return [];
  }

  const entrySize = version === 1 ? V1_ENTRY_SIZE : V0_ENTRY_SIZE;
  const expectedPayloadLength = FULLBOX_HEADER_BYTES + entryCount * entrySize;
  if (payload.length !== expectedPayloadLength) {
    throw new Mp4ElstBadEntryCountError(
      entryCount,
      entrySize,
      payload.length,
      expectedPayloadLength,
    );
  }

  const entries: EditListEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    const base = FULLBOX_HEADER_BYTES + i * entrySize;

    let segmentDuration: number;
    let mediaTime: number;

    if (version === 1) {
      // segment_duration: u64
      const sdHi = view.getUint32(base, false);
      const sdLo = view.getUint32(base + 4, false);
      if (sdHi > 0x001fffff) {
        throw new Mp4ElstValueOutOfRangeError('segment_duration', sdHi);
      }
      segmentDuration = sdHi * 0x100000000 + sdLo;

      // media_time: i64 (signed)
      // Check for -1 sentinel: (hi == 0xFFFFFFFF && lo == 0xFFFFFFFF)
      const mtHi = view.getUint32(base + 8, false);
      const mtLo = view.getUint32(base + 12, false);

      if (mtHi === 0xffffffff && mtLo === 0xffffffff) {
        mediaTime = -1;
      } else {
        // Value out of range check comes first: any hi-word with the top bit set
        // (>= 0x80000000) but not the -1 sentinel represents a value that either
        // cannot be represented as a JS safe integer or is a corrupt negative.
        // Per design note §9, this is Mp4ElstValueOutOfRangeError, not sign-bit.
        if (mtHi >= 0x80000000) {
          throw new Mp4ElstValueOutOfRangeError('media_time', mtHi);
        }
        if (mtHi > 0x001fffff) {
          throw new Mp4ElstValueOutOfRangeError('media_time', mtHi);
        }
        mediaTime = mtHi * 0x100000000 + mtLo;
      }
    } else {
      // v0: u32 segment_duration, i32 media_time
      segmentDuration = view.getUint32(base, false);
      mediaTime = view.getInt32(base + 4, false);
    }

    const rateInt = view.getInt16(base + entrySize - 4, false);
    const rateFrac = view.getInt16(base + entrySize - 2, false);

    // Validate rate: must be exactly 1.0 = (1, 0).
    // Dwell edits (rate_integer == 0) and fractional rates are both rejected.
    if (rateInt !== 1 || rateFrac !== 0) {
      throw new Mp4ElstUnsupportedRateError(rateInt, rateFrac);
    }

    // Note: for v1 entries, mediaTime < -1 is caught above by the
    // hi-word >= 0x80000000 guard; this check fires only for v0 entries.
    if (mediaTime < -1) {
      throw new Mp4ElstSignBitError(mediaTime);
    }

    entries.push({
      segmentDuration,
      mediaTime,
      mediaRate: 1,
      sourceVersion: version,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize an array of EditListEntry to an `elst` FullBox payload.
 *
 * Uses v1 when any field exceeds 0x7FFFFFFF (mirrors the stco→co64 promotion
 * pattern). Otherwise uses v0 for compactness.
 *
 * Returns null when the entry list is empty (caller should omit the entire
 * `edts` box).
 */
export function serializeElst(entries: readonly EditListEntry[]): Uint8Array | null {
  if (entries.length === 0) {
    return null;
  }

  // Determine whether we need v1 encoding.
  const needsV1 = entries.some(
    (e) => e.segmentDuration > 0x7fffffff || (e.mediaTime !== -1 && e.mediaTime > 0x7fffffff),
  );

  const version = needsV1 ? 1 : 0;
  const entrySize = needsV1 ? V1_ENTRY_SIZE : V0_ENTRY_SIZE;
  const payloadSize = FULLBOX_HEADER_BYTES + entries.length * entrySize;
  const payload = new Uint8Array(payloadSize);
  const view = new DataView(payload.buffer);

  // version + flags (flags = 0x000000)
  view.setUint8(0, version);
  // flags bytes 1-3 stay 0
  // entry_count
  view.setUint32(4, entries.length, false);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const base = FULLBOX_HEADER_BYTES + i * entrySize;

    if (version === 1) {
      // segment_duration: u64
      const sdHi = Math.floor(entry.segmentDuration / 0x100000000);
      const sdLo = entry.segmentDuration >>> 0;
      view.setUint32(base, sdHi, false);
      view.setUint32(base + 4, sdLo, false);

      // media_time: i64
      if (entry.mediaTime === -1) {
        view.setUint32(base + 8, 0xffffffff, false);
        view.setUint32(base + 12, 0xffffffff, false);
      } else {
        const mtHi = Math.floor(entry.mediaTime / 0x100000000);
        const mtLo = entry.mediaTime >>> 0;
        view.setUint32(base + 8, mtHi, false);
        view.setUint32(base + 12, mtLo, false);
      }
    } else {
      // v0: u32 segment_duration, i32 media_time
      view.setUint32(base, entry.segmentDuration, false);
      view.setInt32(base + 4, entry.mediaTime, false);
    }

    // rate_integer = 1, rate_fraction = 0
    view.setInt16(base + entrySize - 4, 1, false);
    view.setInt16(base + entrySize - 2, 0, false);
  }

  return payload;
}

/**
 * Determine whether an edit list is trivial (no-op), meaning the serializer
 * should omit the `edts` box entirely.
 *
 * An edit list is trivial when:
 * - It is empty, OR
 * - It has exactly one entry AND that entry is an identity edit:
 *   mediaTime == 0, segmentDuration == movieDuration, rate == 1.
 */
export function isEditListTrivial(
  entries: readonly EditListEntry[],
  movieDuration: number,
): boolean {
  if (entries.length === 0) return true;
  if (entries.length === 1) {
    const e = entries[0];
    if (!e) return true;
    return e.mediaTime === 0 && e.segmentDuration === movieDuration && e.mediaRate === 1;
  }
  return false;
}
