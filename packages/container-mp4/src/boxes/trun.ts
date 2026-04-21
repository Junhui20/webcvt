/**
 * trun (Track Run Box) parser — ISO/IEC 14496-12 §8.8.8.
 *
 * Wire format:
 *   [size:u32][type:'trun'][version:u8][flags:u24]
 *   [sample_count:u32]
 *   if (flags & 0x000001): [data_offset:i32]          ← SIGNED (trap 2)
 *   if (flags & 0x000004): [first_sample_flags:u32]
 *   for i in 0..sample_count:
 *     if (flags & 0x000100): [sample_duration:u32]
 *     if (flags & 0x000200): [sample_size:u32]
 *     if (flags & 0x000400): [sample_flags:u32]       ← OMITTED for i=0 when 0x000004 also set (trap 16)
 *     if (flags & 0x000800): [composition_time_offset] u32 if v0, i32 if v1 (trap 5)
 *
 * Traps honoured:
 *   2  — data_offset is SIGNED int32; use getInt32.
 *   5  — composition_time_offset signedness: v0=unsigned, v1=signed.
 *   9  — sample_count cap: MAX_SAMPLES_PER_TRUN.
 *   16 — When 0x000004 AND 0x000400 both set, sample 0 uses first_sample_flags
 *         and the per-sample sample_flags field is OMITTED for i=0 only.
 *
 * Clean-room: ISO/IEC 14496-12:2022 §8.8 only.
 */

import { MAX_SAMPLES_PER_TRUN } from '../constants.ts';
import { Mp4TrunSampleCountTooLargeError, Mp4TrunSizeMismatchError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Flag bit constants
// ---------------------------------------------------------------------------

const FLAG_DATA_OFFSET = 0x000001;
const FLAG_FIRST_SAMPLE_FLAGS = 0x000004;
const FLAG_SAMPLE_DURATION = 0x000100;
const FLAG_SAMPLE_SIZE = 0x000200;
const FLAG_SAMPLE_FLAGS = 0x000400;
const FLAG_SAMPLE_CTO = 0x000800;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-sample optional fields from a trun entry.
 * null means the field is absent (not present in the run flags).
 */
export interface Mp4FragmentSample {
  readonly duration: number | null;
  readonly size: number | null;
  readonly flags: number | null;
  readonly compositionTimeOffset: number | null;
}

/**
 * Parsed trun (Track Run) box.
 */
export interface Mp4TrackRun {
  /** trun version (0 or 1); affects composition_time_offset signedness. */
  readonly version: 0 | 1;
  /** Raw flags field from the FullBox header. */
  readonly flags: number;
  /**
   * data_offset relative to base_data_offset (signed int32).
   * null when FLAG_DATA_OFFSET (0x000001) is not set.
   */
  readonly dataOffset: number | null;
  /**
   * Overrides per-sample flags for sample 0 only.
   * null when FLAG_FIRST_SAMPLE_FLAGS (0x000004) is not set.
   */
  readonly firstSampleFlags: number | null;
  /** Per-sample optional fields array (length == sample_count). */
  readonly samples: readonly Mp4FragmentSample[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a trun FullBox payload.
 *
 * @param payload    The trun payload bytes (including version+flags prefix).
 * @param moofOffset Absolute file offset of the enclosing moof (for error messages).
 * @returns Parsed Mp4TrackRun.
 * @throws Mp4TrunSampleCountTooLargeError when sample_count exceeds cap.
 * @throws Mp4TrunSizeMismatchError when payload size does not match declared fields.
 */
export function parseTrun(payload: Uint8Array, moofOffset: number): Mp4TrackRun {
  // Minimum: version(1)+flags(3)+sample_count(4) = 8 bytes.
  if (payload.length < 8) {
    throw new Mp4TrunSizeMismatchError(8, payload.length, moofOffset);
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  const versionByte = payload[0] ?? 0;
  const version = (versionByte === 1 ? 1 : 0) as 0 | 1;

  // flags: 24-bit big-endian at bytes 1-3.
  const flags = ((payload[1] ?? 0) << 16) | ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);

  const sampleCount = view.getUint32(4, false);

  // Security cap.
  if (sampleCount > MAX_SAMPLES_PER_TRUN) {
    throw new Mp4TrunSampleCountTooLargeError(sampleCount, MAX_SAMPLES_PER_TRUN, moofOffset);
  }

  // Compute expected payload size to validate before reading.
  const expectedSize = computeTrunPayloadSize(flags, sampleCount);
  if (payload.length < expectedSize) {
    throw new Mp4TrunSizeMismatchError(expectedSize, payload.length, moofOffset);
  }

  // Read optional header fields.
  let cursor = 8; // after version+flags+sample_count

  let dataOffset: number | null = null;
  if (flags & FLAG_DATA_OFFSET) {
    dataOffset = view.getInt32(cursor, false); // SIGNED (trap 2)
    cursor += 4;
  }

  let firstSampleFlags: number | null = null;
  if (flags & FLAG_FIRST_SAMPLE_FLAGS) {
    firstSampleFlags = view.getUint32(cursor, false);
    cursor += 4;
  }

  // Read per-sample fields.
  const hasDuration = (flags & FLAG_SAMPLE_DURATION) !== 0;
  const hasSize = (flags & FLAG_SAMPLE_SIZE) !== 0;
  const hasSampleFlags = (flags & FLAG_SAMPLE_FLAGS) !== 0;
  const hasCto = (flags & FLAG_SAMPLE_CTO) !== 0;
  // Trap 16: when both 0x000004 and 0x000400 are set, sample 0 sample_flags is omitted.
  const firstSampleFlagsSuppressed = hasSampleFlags && firstSampleFlags !== null;

  const samples: Mp4FragmentSample[] = [];

  for (let i = 0; i < sampleCount; i++) {
    let duration: number | null = null;
    let size: number | null = null;
    let sampleFlagsValue: number | null = null;
    let cto: number | null = null;

    if (hasDuration) {
      duration = view.getUint32(cursor, false);
      cursor += 4;
    }

    if (hasSize) {
      size = view.getUint32(cursor, false);
      cursor += 4;
    }

    // Trap 16: per-sample sample_flags field is OMITTED for i=0 when first_sample_flags is set.
    if (hasSampleFlags) {
      if (i === 0 && firstSampleFlagsSuppressed) {
        // sample 0 uses firstSampleFlags; per-sample field omitted in wire format.
        sampleFlagsValue = null; // stored null — caller applies firstSampleFlags at sample 0
      } else {
        sampleFlagsValue = view.getUint32(cursor, false);
        cursor += 4;
      }
    }

    if (hasCto) {
      // Trap 5: v0 = unsigned u32; v1 = signed i32.
      if (version === 1) {
        cto = view.getInt32(cursor, false);
      } else {
        cto = view.getUint32(cursor, false);
      }
      cursor += 4;
    }

    samples.push({ duration, size, flags: sampleFlagsValue, compositionTimeOffset: cto });
  }

  return { version, flags, dataOffset, firstSampleFlags, samples };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the expected trun payload size given flags and sample_count.
 *
 * Accounts for trap 16: when FLAG_FIRST_SAMPLE_FLAGS and FLAG_SAMPLE_FLAGS are
 * both set, the per-sample sample_flags field is absent for sample 0 only.
 */
function computeTrunPayloadSize(flags: number, sampleCount: number): number {
  // Fixed header: version(1)+flags(3)+sample_count(4) = 8.
  let size = 8;

  // Optional header fields.
  if (flags & FLAG_DATA_OFFSET) size += 4;
  if (flags & FLAG_FIRST_SAMPLE_FLAGS) size += 4;

  // Per-sample field sizes.
  let perSampleSize = 0;
  if (flags & FLAG_SAMPLE_DURATION) perSampleSize += 4;
  if (flags & FLAG_SAMPLE_SIZE) perSampleSize += 4;
  if (flags & FLAG_SAMPLE_FLAGS) perSampleSize += 4;
  if (flags & FLAG_SAMPLE_CTO) perSampleSize += 4;

  // F3: guard against pre-multiplication integer overflow before the sum.
  if (
    perSampleSize > 0 &&
    sampleCount > Math.floor((Number.MAX_SAFE_INTEGER - size) / perSampleSize)
  ) {
    throw new Mp4TrunSizeMismatchError(Number.MAX_SAFE_INTEGER, sampleCount, 0);
  }
  size += perSampleSize * sampleCount;

  // Trap 16: when BOTH first-sample-flags and sample-flags are set,
  // sample 0's per-sample sample_flags field is omitted.
  if (flags & FLAG_FIRST_SAMPLE_FLAGS && flags & FLAG_SAMPLE_FLAGS && sampleCount > 0) {
    size -= 4; // one fewer sample_flags field
  }

  return size;
}
