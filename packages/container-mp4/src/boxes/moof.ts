/**
 * moof / mfhd / traf / tfhd / tfdt parsers — ISO/IEC 14496-12 §8.8.4–§8.8.12.
 *
 * moof (Movie Fragment Box): container holding mfhd + one or more traf.
 * mfhd (Movie Fragment Header): FullBox with sequence_number.
 * traf (Track Fragment Box): container holding tfhd + optional tfdt + zero or more trun.
 * tfhd (Track Fragment Header): FullBox; flag-driven optional fields.
 * tfdt (Track Fragment Base Media Decode Time): FullBox; v0=u32, v1=u64.
 *
 * Traps honoured:
 *   1  — tfhd 0x000001 OVERRIDES 0x020000 when both set.
 *   6  — mfhd.sequence_number monotonicity validated post-parse.
 *   7  — trex defaults indexed by trackId; missing trex → Mp4TfhdUnknownTrackError.
 *   8  — empty traf (no trun) is legal.
 *   10 — MAX_FRAGMENTS and MAX_TRAFS_PER_MOOF caps.
 *   12 — default_base_is_moof uses current moof.fileOffset, not first moof.
 *   15 — tfhd.base_data_offset u64 hi-word guard.
 *
 * Clean-room: ISO/IEC 14496-12:2022 §8.8 only.
 */

import { type Mp4Box, findChild, findChildren } from '../box-tree.ts';
import { MAX_TRAFS_PER_MOOF } from '../constants.ts';
import {
  Mp4InvalidBoxError,
  Mp4MissingBoxError,
  Mp4MoofMissingMfhdError,
  Mp4TfdtValueOutOfRangeError,
  Mp4TfdtVersionError,
  Mp4TfhdLegacyBaseUnsupportedError,
  Mp4TfhdUnknownTrackError,
  Mp4TfhdValueOutOfRangeError,
  Mp4TrafCountTooLargeError,
} from '../errors.ts';
import type { Mp4TrackExtends } from './mvex.ts';
import { parseTrun } from './trun.ts';
import type { Mp4TrackRun } from './trun.ts';

// ---------------------------------------------------------------------------
// tfhd flag bit constants
// ---------------------------------------------------------------------------

const TFHD_FLAG_BASE_DATA_OFFSET_PRESENT = 0x000001;
const TFHD_FLAG_SAMPLE_DESCRIPTION_INDEX_PRESENT = 0x000002;
const TFHD_FLAG_DEFAULT_SAMPLE_DURATION_PRESENT = 0x000008;
const TFHD_FLAG_DEFAULT_SAMPLE_SIZE_PRESENT = 0x000010;
const TFHD_FLAG_DEFAULT_SAMPLE_FLAGS_PRESENT = 0x000020;
const TFHD_FLAG_DURATION_IS_EMPTY = 0x010000;
const TFHD_FLAG_DEFAULT_BASE_IS_MOOF = 0x020000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Parsed traf (Track Fragment) box.
 */
export interface Mp4TrackFragment {
  readonly trackId: number;
  /**
   * Resolved absolute file offset base for all trun data offsets in this traf.
   * This is already resolved — tfhd flag logic + moof.fileOffset applied.
   */
  readonly resolvedBase: number;
  /** Raw tfhd fields (null when not present in the flags). */
  readonly baseDataOffset: number | null;
  readonly sampleDescriptionIndex: number | null;
  readonly defaultSampleDuration: number | null;
  readonly defaultSampleSize: number | null;
  readonly defaultSampleFlags: number | null;
  readonly defaultBaseIsMoof: boolean;
  readonly durationIsEmpty: boolean;
  /** Base media decode time from tfdt. null when tfdt is absent. */
  readonly baseMediaDecodeTime: number | null;
  readonly tfdtVersion: 0 | 1 | null;
  /** Track run boxes (empty when no trun present — legal per trap 8). */
  readonly trackRuns: readonly Mp4TrackRun[];
}

/**
 * Parsed moof (Movie Fragment) box.
 */
export interface Mp4MovieFragment {
  readonly sequenceNumber: number;
  readonly trackFragments: readonly Mp4TrackFragment[];
  /** Absolute file offset of the start of this moof box (including its header). */
  readonly moofOffset: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a moof box (its children must already have been walked by the box-tree walker).
 *
 * @param moofBox            The moof Mp4Box (children populated by walkBoxes).
 * @param moofOffset         Absolute file offset of the moof box start.
 * @param trackExtendsById   Map from trackId → trex defaults (from mvex).
 * @returns Parsed Mp4MovieFragment.
 * @throws Mp4MoofMissingMfhdError when mfhd is absent.
 * @throws Mp4TrafCountTooLargeError when traf count exceeds cap.
 * @throws Mp4TfhdUnknownTrackError when a tfhd references a trackId with no trex.
 * @throws Mp4TfhdLegacyBaseUnsupportedError when base offset resolution is ambiguous.
 * @throws Mp4TfhdValueOutOfRangeError on u64 overflow in tfhd.
 * @throws Mp4TfdtVersionError on unsupported tfdt version.
 * @throws Mp4TfdtValueOutOfRangeError on u64 overflow in tfdt.
 */
export function parseMoof(
  moofBox: Mp4Box,
  moofOffset: number,
  trackExtendsById: ReadonlyMap<number, Mp4TrackExtends>,
): Mp4MovieFragment {
  // mfhd is required — and must appear exactly once.
  const mfhdBoxes = findChildren(moofBox, 'mfhd');
  if (mfhdBoxes.length === 0) {
    throw new Mp4MoofMissingMfhdError(moofOffset);
  }
  if (mfhdBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `moof at offset ${moofOffset} contains ${mfhdBoxes.length} mfhd boxes; the spec allows exactly one.`,
    );
  }
  const mfhdBox = mfhdBoxes[0];
  if (!mfhdBox) throw new Mp4MoofMissingMfhdError(moofOffset);
  const sequenceNumber = parseMfhd(mfhdBox.payload, moofOffset);

  // traf boxes.
  const trafBoxes = findChildren(moofBox, 'traf');

  // Cap check.
  if (trafBoxes.length > MAX_TRAFS_PER_MOOF) {
    throw new Mp4TrafCountTooLargeError(trafBoxes.length, MAX_TRAFS_PER_MOOF, moofOffset);
  }

  const trackFragments: Mp4TrackFragment[] = [];

  for (const trafBox of trafBoxes) {
    const traf = parseTraf(trafBox, moofOffset, trackExtendsById);
    trackFragments.push(traf);
  }

  return { sequenceNumber, trackFragments, moofOffset };
}

// ---------------------------------------------------------------------------
// Private parsers
// ---------------------------------------------------------------------------

function parseMfhd(payload: Uint8Array, moofOffset: number): number {
  // mfhd FullBox: version(1)+flags(3)+sequence_number(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError(
      `mfhd in moof at offset ${moofOffset} too short (${payload.length} bytes); need 8.`,
    );
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const seqNum = view.getUint32(4, false);
  // F5: spec §8.8.5 requires sequence_number to start at 1; 0 is spec-illegal.
  if (seqNum === 0) {
    throw new Mp4InvalidBoxError(
      `mfhd in moof at offset ${moofOffset} has sequence_number=0; the spec requires values starting at 1.`,
    );
  }
  return seqNum;
}

function parseTraf(
  trafBox: Mp4Box,
  moofOffset: number,
  trackExtendsById: ReadonlyMap<number, Mp4TrackExtends>,
): Mp4TrackFragment {
  // tfhd is required — and must appear exactly once.
  const tfhdBoxes = findChildren(trafBox, 'tfhd');
  if (tfhdBoxes.length === 0) {
    throw new Mp4MissingBoxError('tfhd', 'traf');
  }
  if (tfhdBoxes.length > 1) {
    throw new Mp4InvalidBoxError(
      `traf in moof at offset ${moofOffset} contains ${tfhdBoxes.length} tfhd boxes; the spec allows exactly one.`,
    );
  }
  const tfhdBox = tfhdBoxes[0];
  if (!tfhdBox) throw new Mp4MissingBoxError('tfhd', 'traf');
  const tfhd = parseTfhd(tfhdBox.payload, moofOffset, trackExtendsById);

  // tfdt is optional.
  const tfdtBox = findChild(trafBox, 'tfdt');
  let baseMediaDecodeTime: number | null = null;
  let tfdtVersion: 0 | 1 | null = null;
  if (tfdtBox) {
    const tfdtResult = parseTfdt(tfdtBox.payload, moofOffset);
    baseMediaDecodeTime = tfdtResult.baseMediaDecodeTime;
    tfdtVersion = tfdtResult.version;
  }

  // trun boxes (empty traf is legal — trap 8).
  const trunBoxes = findChildren(trafBox, 'trun');
  const trackRuns: Mp4TrackRun[] = [];
  for (const trunBox of trunBoxes) {
    trackRuns.push(parseTrun(trunBox.payload, moofOffset));
  }

  return {
    trackId: tfhd.trackId,
    resolvedBase: tfhd.resolvedBase,
    baseDataOffset: tfhd.baseDataOffset,
    sampleDescriptionIndex: tfhd.sampleDescriptionIndex,
    defaultSampleDuration: tfhd.defaultSampleDuration,
    defaultSampleSize: tfhd.defaultSampleSize,
    defaultSampleFlags: tfhd.defaultSampleFlags,
    defaultBaseIsMoof: tfhd.defaultBaseIsMoof,
    durationIsEmpty: tfhd.durationIsEmpty,
    baseMediaDecodeTime,
    tfdtVersion,
    trackRuns,
  };
}

interface TfhdResult {
  trackId: number;
  resolvedBase: number;
  baseDataOffset: number | null;
  sampleDescriptionIndex: number | null;
  defaultSampleDuration: number | null;
  defaultSampleSize: number | null;
  defaultSampleFlags: number | null;
  defaultBaseIsMoof: boolean;
  durationIsEmpty: boolean;
}

function parseTfhd(
  payload: Uint8Array,
  moofOffset: number,
  trackExtendsById: ReadonlyMap<number, Mp4TrackExtends>,
): TfhdResult {
  // Minimum: version(1)+flags(3)+track_ID(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError(
      `tfhd payload too short (${payload.length} bytes); need at least 8.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // flags: 24-bit big-endian at bytes 1-3.
  const flags = ((payload[1] ?? 0) << 16) | ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);

  const trackId = view.getUint32(4, false);

  // Validate trackId has a corresponding trex (trap 7).
  if (!trackExtendsById.has(trackId)) {
    throw new Mp4TfhdUnknownTrackError(trackId, moofOffset);
  }

  let cursor = 8; // after version+flags+track_ID

  // Optional fields in spec-defined order.
  let baseDataOffset: number | null = null;
  if (flags & TFHD_FLAG_BASE_DATA_OFFSET_PRESENT) {
    // u64 — guard hi-word (trap 15).
    if (payload.length < cursor + 8) {
      throw new Mp4InvalidBoxError(
        `tfhd payload too short for base_data_offset at moof offset ${moofOffset}.`,
      );
    }
    const hi = view.getUint32(cursor, false);
    const lo = view.getUint32(cursor + 4, false);
    const baseDataOffsetValue = hi * 0x100000000 + lo;
    if (baseDataOffsetValue > Number.MAX_SAFE_INTEGER) {
      throw new Mp4TfhdValueOutOfRangeError('base_data_offset', hi, moofOffset);
    }
    baseDataOffset = baseDataOffsetValue;
    cursor += 8;
  }

  let sampleDescriptionIndex: number | null = null;
  if (flags & TFHD_FLAG_SAMPLE_DESCRIPTION_INDEX_PRESENT) {
    if (payload.length < cursor + 4) {
      throw new Mp4InvalidBoxError(
        `tfhd payload too short for sample_description_index at moof offset ${moofOffset}.`,
      );
    }
    sampleDescriptionIndex = view.getUint32(cursor, false);
    cursor += 4;
  }

  let defaultSampleDuration: number | null = null;
  if (flags & TFHD_FLAG_DEFAULT_SAMPLE_DURATION_PRESENT) {
    if (payload.length < cursor + 4) {
      throw new Mp4InvalidBoxError(
        `tfhd payload too short for default_sample_duration at moof offset ${moofOffset}.`,
      );
    }
    defaultSampleDuration = view.getUint32(cursor, false);
    cursor += 4;
  }

  let defaultSampleSize: number | null = null;
  if (flags & TFHD_FLAG_DEFAULT_SAMPLE_SIZE_PRESENT) {
    if (payload.length < cursor + 4) {
      throw new Mp4InvalidBoxError(
        `tfhd payload too short for default_sample_size at moof offset ${moofOffset}.`,
      );
    }
    defaultSampleSize = view.getUint32(cursor, false);
    cursor += 4;
  }

  let defaultSampleFlags: number | null = null;
  if (flags & TFHD_FLAG_DEFAULT_SAMPLE_FLAGS_PRESENT) {
    if (payload.length < cursor + 4) {
      throw new Mp4InvalidBoxError(
        `tfhd payload too short for default_sample_flags at moof offset ${moofOffset}.`,
      );
    }
    defaultSampleFlags = view.getUint32(cursor, false);
    cursor += 4;
  }

  const defaultBaseIsMoof = (flags & TFHD_FLAG_DEFAULT_BASE_IS_MOOF) !== 0;
  const durationIsEmpty = (flags & TFHD_FLAG_DURATION_IS_EMPTY) !== 0;

  // Resolve the base offset (trap 1 + trap 12).
  // Rule: if 0x000001 set → use base_data_offset (absolute).
  //       elif 0x020000 set → use moof.fileOffset.
  //       else → legacy moov-relative: not supported.
  let resolvedBase: number;
  if (flags & TFHD_FLAG_BASE_DATA_OFFSET_PRESENT) {
    // Trap 1: explicit base overrides default-base-is-moof.
    resolvedBase = baseDataOffset ?? 0;
  } else if (flags & TFHD_FLAG_DEFAULT_BASE_IS_MOOF) {
    // Trap 12: use current moof's offset, not first moof.
    resolvedBase = moofOffset;
  } else {
    throw new Mp4TfhdLegacyBaseUnsupportedError(moofOffset);
  }

  return {
    trackId,
    resolvedBase,
    baseDataOffset,
    sampleDescriptionIndex,
    defaultSampleDuration,
    defaultSampleSize,
    defaultSampleFlags,
    defaultBaseIsMoof,
    durationIsEmpty,
  };
}

interface TfdtResult {
  baseMediaDecodeTime: number;
  version: 0 | 1;
}

function parseTfdt(payload: Uint8Array, moofOffset: number): TfdtResult {
  // Minimum: version(1)+flags(3)+time_u32(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4InvalidBoxError(
      `tfdt payload too short (${payload.length} bytes) at moof offset ${moofOffset}.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const versionByte = payload[0] ?? 0;

  if (versionByte !== 0 && versionByte !== 1) {
    throw new Mp4TfdtVersionError(versionByte, moofOffset);
  }
  const version = versionByte as 0 | 1;

  let baseMediaDecodeTime: number;

  if (version === 1) {
    if (payload.length < 12) {
      throw new Mp4InvalidBoxError(
        `tfdt v1 payload too short (${payload.length} bytes) at moof offset ${moofOffset}.`,
      );
    }
    const hi = view.getUint32(4, false);
    const lo = view.getUint32(8, false);
    // Guard: reject values that exceed Number.MAX_SAFE_INTEGER (trap 15 extended to tfdt).
    const baseMediaDecodeTimeValue = hi * 0x100000000 + lo;
    if (baseMediaDecodeTimeValue > Number.MAX_SAFE_INTEGER) {
      throw new Mp4TfdtValueOutOfRangeError(hi, moofOffset);
    }
    baseMediaDecodeTime = baseMediaDecodeTimeValue;
  } else {
    baseMediaDecodeTime = view.getUint32(4, false);
  }

  return { baseMediaDecodeTime, version };
}
