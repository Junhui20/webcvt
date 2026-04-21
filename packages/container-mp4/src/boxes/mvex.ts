/**
 * mvex / mehd / trex box parsers — ISO/IEC 14496-12 §8.8.1–§8.8.3.
 *
 * mvex (Movie Extends Box) is a plain container box (NOT FullBox) that holds
 * zero or one mehd (Movie Extends Header) and one or more trex (Track Extends)
 * boxes. Its presence in moov is the canonical signal that the file is
 * fragmented (fMP4).
 *
 * Wire formats:
 *
 *   mvex: [size:u32][type:'mvex']  (container — children walked by box-tree)
 *
 *   mehd: [size:u32][type:'mehd'][version:u8][flags:u24]
 *           if v0: [fragment_duration:u32]
 *           if v1: [fragment_duration:u64]
 *
 *   trex: [size:u32][type:'trex'][version:u8=0][flags:u24]
 *         [track_ID:u32]
 *         [default_sample_description_index:u32]
 *         [default_sample_duration:u32]
 *         [default_sample_size:u32]
 *         [default_sample_flags:u32]
 *         Total payload: 24 bytes (4 + 5×4 = after version+flags prefix of 4)
 *         Actually: fullbox header 4 bytes + 5×u32 = 24 bytes payload.
 *
 * Clean-room: ISO/IEC 14496-12:2022 §8.8 only.
 */

import type { Mp4Box } from '../box-tree.ts';
import { findChild, findChildren } from '../box-tree.ts';
import { MAX_TREX_PER_MVEX } from '../constants.ts';
import { Mp4InvalidBoxError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum trex payload: version(1)+flags(3) + track_ID(4) + 4×u32(16) = 24 bytes. */
const TREX_PAYLOAD_SIZE = 24;

/** Fullbox header inside payload: version(1)+flags(3) = 4 bytes. */
const FULLBOX_PREFIX = 4;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Parsed trex (Track Extends Defaults) — one per track in a fragmented file.
 * All defaults are present (the spec requires all five fields unconditionally).
 */
export interface Mp4TrackExtends {
  readonly trackId: number;
  readonly defaultSampleDescriptionIndex: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
}

/**
 * Parsed mehd (Movie Extends Header). Optional; present only when the total
 * fragment duration is known at mux time.
 */
export interface Mp4Mehd {
  readonly version: 0 | 1;
  readonly fragmentDuration: number;
}

/**
 * Result of parsing an mvex container.
 */
export interface Mp4MvexResult {
  readonly mehd: Mp4Mehd | null;
  readonly trackExtends: readonly Mp4TrackExtends[];
  /** Indexed by trackId for O(1) lookup during traf/tfhd parse. */
  readonly trackExtendsById: ReadonlyMap<number, Mp4TrackExtends>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the mvex container box (its children must already have been walked
 * by the box-tree walker).
 *
 * @param mvexBox  The mvex Mp4Box (children populated by walkBoxes).
 * @returns Parsed result with mehd, trackExtends array, and lookup map.
 * @throws Mp4InvalidBoxError on malformed trex payload.
 */
export function parseMvex(mvexBox: Mp4Box): Mp4MvexResult {
  // mehd is optional — parse if present.
  const mehdBox = findChild(mvexBox, 'mehd');
  const mehd = mehdBox ? parseMehd(mehdBox.payload) : null;

  // trex — one per track; empty list is valid (degenerate fragmented file).
  const trexBoxes = findChildren(mvexBox, 'trex');

  // F4: cap trex count to prevent excessive memory use from crafted files.
  if (trexBoxes.length > MAX_TREX_PER_MVEX) {
    throw new Mp4InvalidBoxError(
      `mvex contains ${trexBoxes.length} trex boxes; maximum is ${MAX_TREX_PER_MVEX}.`,
    );
  }

  const trackExtends: Mp4TrackExtends[] = [];
  const trackExtendsById = new Map<number, Mp4TrackExtends>();

  for (const trexBox of trexBoxes) {
    const trex = parseTrex(trexBox.payload);
    trackExtends.push(trex);
    trackExtendsById.set(trex.trackId, trex);
  }

  return { mehd, trackExtends, trackExtendsById };
}

// ---------------------------------------------------------------------------
// Private parsers
// ---------------------------------------------------------------------------

function parseMehd(payload: Uint8Array): Mp4Mehd {
  // Minimum: version(1)+flags(3) + duration_u32(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError(
      `mehd payload too short (${payload.length} bytes); need at least 8.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const versionByte = payload[0] ?? 0;

  if (versionByte !== 0 && versionByte !== 1) {
    throw new Mp4InvalidBoxError(
      `mehd unsupported version ${versionByte}; only 0 and 1 are valid.`,
    );
  }
  const version = versionByte as 0 | 1;

  let fragmentDuration: number;
  if (version === 1) {
    // u64 — check payload accommodates 4 (prefix) + 8 = 12 bytes minimum.
    if (payload.length < 12) {
      throw new Mp4InvalidBoxError(
        `mehd v1 payload too short (${payload.length} bytes); need at least 12.`,
      );
    }
    const hi = view.getUint32(FULLBOX_PREFIX, false);
    const lo = view.getUint32(FULLBOX_PREFIX + 4, false);
    // Guard: reject values that exceed Number.MAX_SAFE_INTEGER (boundary precision loss).
    const fragmentDurationValue = hi * 0x100000000 + lo;
    if (fragmentDurationValue > Number.MAX_SAFE_INTEGER) {
      throw new Mp4InvalidBoxError(
        `mehd v1 fragment_duration hi-word 0x${hi.toString(16).toUpperCase()} exceeds Number.MAX_SAFE_INTEGER.`,
      );
    }
    fragmentDuration = fragmentDurationValue;
  } else {
    fragmentDuration = view.getUint32(FULLBOX_PREFIX, false);
  }

  return { version, fragmentDuration };
}

function parseTrex(payload: Uint8Array): Mp4TrackExtends {
  if (payload.length < TREX_PAYLOAD_SIZE) {
    throw new Mp4InvalidBoxError(
      `trex payload too short (${payload.length} bytes); expected ${TREX_PAYLOAD_SIZE}.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // version byte should be 0; we tolerate others without throwing (lenient).
  // Offset layout inside payload (after 8-byte box header, payload starts at offset 0):
  //   0: version(u8)
  //   1-3: flags(u24)
  //   4: track_ID(u32)
  //   8: default_sample_description_index(u32)
  //  12: default_sample_duration(u32)
  //  16: default_sample_size(u32)
  //  20: default_sample_flags(u32)

  const trackId = view.getUint32(FULLBOX_PREFIX, false);
  const defaultSampleDescriptionIndex = view.getUint32(FULLBOX_PREFIX + 4, false);
  const defaultSampleDuration = view.getUint32(FULLBOX_PREFIX + 8, false);
  const defaultSampleSize = view.getUint32(FULLBOX_PREFIX + 12, false);
  const defaultSampleFlags = view.getUint32(FULLBOX_PREFIX + 16, false);

  return {
    trackId,
    defaultSampleDescriptionIndex,
    defaultSampleDuration,
    defaultSampleSize,
    defaultSampleFlags,
  };
}
