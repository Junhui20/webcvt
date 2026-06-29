/**
 * sidx (Segment Index Box) parser — ISO/IEC 14496-12 §8.16.3.
 *
 * Used by DASH / CMAF to index sub-segments, each referencing one or more
 * movie fragments (or, recursively, another sidx). webcvt parses sidx as a
 * read-only index: it exposes the parsed `references` array but does NOT
 * recursively resolve nested (reference_type=1) sidx chains — callers walk
 * the references themselves. A fragmented file may contain zero or more sidx
 * boxes; each is parsed independently.
 *
 * Layout (FullBox 'sidx'):
 *   reference_ID(u32) timescale(u32)
 *   earliest_presentation_time + first_offset  (u32 each for v0, u64 each for v1)
 *   reserved(u16) reference_count(u16)
 *   reference_count × {
 *     reference_type(1) | referenced_size(31)
 *     subsegment_duration(u32)
 *     starts_with_SAP(1) | SAP_type(3) | SAP_delta_time(28)
 *   }
 *
 * Clean-room: ISO/IEC 14496-12:2022 §8.16.3 only. No porting from gpac/Bento4/mp4box.
 */

import { MAX_SIDX_REFERENCES } from '../constants.ts';
import {
  Mp4InvalidBoxError,
  Mp4SidxBadVersionError,
  Mp4SidxReferenceCountTooLargeError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single entry in a Segment Index Box's reference list. */
export interface Mp4SegmentReference {
  /**
   * false → the reference points to media (movie fragments).
   * true  → the reference points to another sidx (a nested index).
   */
  readonly referenceType: boolean;
  /** Byte size of the referenced material (31-bit unsigned). */
  readonly referencedSize: number;
  /** Duration of the sub-segment in `timescale` units (u32). */
  readonly subsegmentDuration: number;
  /** Whether the sub-segment begins with a Stream Access Point. */
  readonly startsWithSap: boolean;
  /** SAP type 0–7 (3-bit). */
  readonly sapType: number;
  /** SAP delta time (28-bit unsigned). */
  readonly sapDeltaTime: number;
}

/** A parsed Segment Index Box. */
export interface Mp4SegmentIndex {
  readonly version: 0 | 1;
  /** Stream (track) ID this index references. */
  readonly referenceId: number;
  /** Timescale (ticks per second) for the time fields. */
  readonly timescale: number;
  /** Earliest presentation time of the first sub-segment, in `timescale` units. */
  readonly earliestPresentationTime: number;
  /** Byte offset from the first byte after this sidx box to the first referenced box. */
  readonly firstOffset: number;
  readonly references: readonly Mp4SegmentReference[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a sidx box payload (the bytes following the 8-byte box header, i.e.
 * starting at the FullBox version byte).
 *
 * @throws Mp4SidxBadVersionError when version is not 0 or 1.
 * @throws Mp4SidxReferenceCountTooLargeError when reference_count exceeds the cap.
 * @throws Mp4InvalidBoxError when the payload is truncated or a u64 field overflows
 *   the JS safe-integer range.
 */
export function parseSidx(payload: Uint8Array): Mp4SegmentIndex {
  // Minimum (before EPT/first_offset): version+flags(4) + reference_ID(4) + timescale(4) = 12.
  if (payload.length < 12) {
    throw new Mp4InvalidBoxError(
      `sidx payload too short (${payload.length} bytes); need at least 12.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = payload[0] ?? 0;
  if (version !== 0 && version !== 1) {
    throw new Mp4SidxBadVersionError(version);
  }

  const referenceId = view.getUint32(4, false);
  const timescale = view.getUint32(8, false);

  let cursor = 12;
  let earliestPresentationTime: number;
  let firstOffset: number;

  if (version === 0) {
    if (payload.length < cursor + 8) {
      throw new Mp4InvalidBoxError('sidx v0 payload too short for EPT/first_offset.');
    }
    earliestPresentationTime = view.getUint32(cursor, false);
    firstOffset = view.getUint32(cursor + 4, false);
    cursor += 8;
  } else {
    if (payload.length < cursor + 16) {
      throw new Mp4InvalidBoxError('sidx v1 payload too short for EPT/first_offset.');
    }
    earliestPresentationTime = readU64(view, cursor, 'earliest_presentation_time');
    firstOffset = readU64(view, cursor + 8, 'first_offset');
    cursor += 16;
  }

  // reserved(2) + reference_count(2).
  if (payload.length < cursor + 4) {
    throw new Mp4InvalidBoxError('sidx payload too short for reference_count.');
  }
  const referenceCount = view.getUint16(cursor + 2, false);
  cursor += 4;

  // reference_count is a u16 field (max 65535) < MAX_SIDX_REFERENCES, so this cap
  // can never fire on conforming input — it is a defensive guard kept in case the
  // field width is ever widened. The 12-byte/entry length check below is the real
  // allocation bound.
  /* v8 ignore next 3 -- defensive: u16 reference_count cannot exceed the cap */
  if (referenceCount > MAX_SIDX_REFERENCES) {
    throw new Mp4SidxReferenceCountTooLargeError(referenceCount, MAX_SIDX_REFERENCES);
  }

  // Each reference entry is exactly 12 bytes.
  if (payload.length < cursor + referenceCount * 12) {
    throw new Mp4InvalidBoxError(
      `sidx payload too short for ${referenceCount} references (need ${referenceCount * 12} more bytes).`,
    );
  }

  const references: Mp4SegmentReference[] = [];
  for (let i = 0; i < referenceCount; i++) {
    const word0 = view.getUint32(cursor, false);
    const subsegmentDuration = view.getUint32(cursor + 4, false);
    const word2 = view.getUint32(cursor + 8, false);
    references.push({
      referenceType: (word0 & 0x80000000) !== 0,
      referencedSize: word0 & 0x7fffffff,
      subsegmentDuration,
      startsWithSap: (word2 & 0x80000000) !== 0,
      sapType: (word2 >>> 28) & 0x7,
      sapDeltaTime: word2 & 0x0fffffff,
    });
    cursor += 12;
  }

  return {
    version,
    referenceId,
    timescale,
    earliestPresentationTime,
    firstOffset,
    references,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readU64(view: DataView, offset: number, field: string): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  const value = hi * 0x100000000 + lo;
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Mp4InvalidBoxError(`sidx ${field} (${hi}:${lo}) exceeds the safe integer range.`);
  }
  return value;
}
