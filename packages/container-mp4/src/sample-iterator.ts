/**
 * Audio sample iterator — converts a parsed Mp4Track into a sequence of
 * EncodedAudioChunk-compatible descriptors.
 *
 * Per the design note §WebCodecs integration:
 *   - Each AAC frame is a key frame (type: 'key') — AAC frames are independent.
 *   - timestamp in microseconds, derived from cumulative stts deltas / mdhd.timescale.
 *   - duration in microseconds, from the stts delta for that sample.
 *   - data is a zero-copy subarray into the fileBytes buffer.
 *   - No ADTS header is added — mdat bytes are raw access units.
 *
 * The iterator uses subarray (not slice) for zero-copy access (Lesson #3).
 * The caller is responsible for slicing if they need an immutable copy.
 *
 * Phase 3 sub-pass A: edit list (elst) integration.
 *   - Empty edits (mediaTime=-1) shift the presentation timeline baseline.
 *   - Normal edits with mediaTime>0 skip leading samples.
 *   - segmentDuration shorter than media truncates trailing samples.
 *   - Multiple non-empty edit segments throw Mp4ElstMultiSegmentNotSupportedError.
 */

import type { EditListEntry } from './boxes/elst.ts';
import { Mp4ElstMultiSegmentNotSupportedError, Mp4ElstValueOutOfRangeError } from './errors.ts';
import type { Mp4Track } from './parser.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioSample {
  /** Raw AAC access unit bytes (zero-copy subarray into fileBytes). */
  data: Uint8Array;
  /** Presentation timestamp in microseconds. */
  timestampUs: number;
  /** Duration in microseconds. */
  durationUs: number;
  /** Sample index (0-based). */
  index: number;
  /**
   * When the first sample of an edit does not align exactly to a sample
   * boundary, this holds the number of media-timescale ticks from the
   * start of that sample to the edit's mediaTime.
   *
   * Useful for decoders that honour sub-frame priming offsets.
   * 0 when the edit aligns exactly to a sample boundary.
   */
  editStartSkipTicks?: number;
}

// ---------------------------------------------------------------------------
// Edit list analysis
// ---------------------------------------------------------------------------

interface EditContext {
  /** Accumulated empty-edit duration in microseconds (presentation baseline shift). */
  presentationOffsetUs: number;
  /**
   * The first non-empty edit's mediaTime in media-timescale ticks.
   * Samples before this tick are skipped.
   * -1 when no non-empty edit was found (yield all samples from tick 0).
   */
  mediaStartTicks: number;
  /**
   * Maximum media-timescale ticks to yield from the edit's start.
   * Number.POSITIVE_INFINITY when no duration limit applies.
   */
  mediaDurationTicks: number;
  /** True when more than one non-empty edit exists (iterator will throw). */
  hasMultipleSegments: boolean;
}

/**
 * Derive the active edit parameters from the track's edit list.
 *
 * @param editList     The track's edit list entries.
 * @param mvTimescale  Movie timescale (mvhd.timescale).
 * @param mdTimescale  Media timescale (mdhd.timescale).
 */
function analyseEditList(
  editList: readonly EditListEntry[],
  mvTimescale: number,
  mdTimescale: number,
): EditContext {
  let presentationOffsetUs = 0;
  let mediaStartTicks = -1;
  let mediaDurationTicks = Number.POSITIVE_INFINITY;
  let nonEmptyCount = 0;

  for (const entry of editList) {
    if (entry.mediaTime === -1) {
      // Empty edit: contributes to the presentation timeline offset.
      // segment_duration is in movie-timescale; convert to microseconds.
      // When mvTimescale is 0 (unknown), skip the offset calculation to avoid
      // incorrect values when called without the movie timescale context.
      if (mvTimescale > 0) {
        presentationOffsetUs += (entry.segmentDuration * 1_000_000) / mvTimescale;
        // F9: guard against adversarial overflow of presentationOffsetUs accumulation.
        if (presentationOffsetUs > Number.MAX_SAFE_INTEGER) {
          throw new Mp4ElstValueOutOfRangeError(
            'segment_duration*1e6/mvTimescale overflows MAX_SAFE_INTEGER',
            entry.segmentDuration,
          );
        }
      }
    } else {
      nonEmptyCount += 1;
      if (nonEmptyCount === 1) {
        // First non-empty edit is the active one.
        mediaStartTicks = entry.mediaTime;
        // Convert segment_duration from movie-timescale ticks to media-timescale ticks.
        // When mvTimescale is 0 (unknown), skip duration truncation to avoid
        // incorrect truncation when called without full movie context.
        if (mvTimescale > 0 && mdTimescale > 0 && entry.segmentDuration > 0) {
          // F6: guard against adversarial overflow before the multiplication.
          if (entry.segmentDuration > Math.floor(Number.MAX_SAFE_INTEGER / mdTimescale)) {
            throw new Mp4ElstValueOutOfRangeError(
              'segment_duration*timescale would overflow MAX_SAFE_INTEGER',
              entry.segmentDuration,
            );
          }
          mediaDurationTicks = (entry.segmentDuration * mdTimescale) / mvTimescale;
        } else {
          mediaDurationTicks = Number.POSITIVE_INFINITY;
        }
      }
    }
  }

  return {
    presentationOffsetUs,
    mediaStartTicks,
    mediaDurationTicks,
    hasMultipleSegments: nonEmptyCount > 1,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Iterate over all audio samples in a parsed track, honouring the edit list.
 *
 * When the track has no edit list (editList is empty), behaviour is identical
 * to the pre-elst baseline: yields all samples with timestamps from tick 0.
 *
 * When an edit list is present:
 *   - Leading empty edits shift all timestamps by their total duration.
 *   - A normal edit with mediaTime > 0 skips leading samples and resets
 *     the presentation timestamp to presentationOffsetUs.
 *   - A shorter segmentDuration truncates trailing samples.
 *   - More than one non-empty edit throws Mp4ElstMultiSegmentNotSupportedError.
 *
 * Yields one AudioSample per emitted sample in order.
 * Timestamps are computed from cumulative stts deltas using mdhd.timescale.
 *
 * @param track     Parsed Mp4Track (soun handler).
 * @param fileBytes Original input buffer (samples are sliced from this).
 * @throws Mp4ElstMultiSegmentNotSupportedError — more than one non-empty edit.
 */
/**
 * @deprecated Use {@link iterateAudioSamplesWithContext} to honour edit lists.
 * Calling this on a track with a non-empty editList silently bypasses
 * priming silence trim and segment_duration truncation.
 */
export function* iterateAudioSamples(
  track: Mp4Track,
  fileBytes: Uint8Array,
): Generator<AudioSample> {
  const { sampleTable, mediaHeader } = track;
  const { sampleCount, sampleOffsets, sampleSizes, sampleDeltas } = sampleTable;
  const timescale = mediaHeader.timescale;

  // The two-argument form is the backward-compatible API that predates elst
  // support. It always uses baseline iteration (no edit list effects) to
  // preserve the contract: "yields all sampleCount samples in order with
  // timestamps from tick 0." Callers with access to Mp4File should use
  // iterateAudioSamplesWithContext to honour the edit list correctly.
  yield* iterateBaseline(
    sampleCount,
    sampleOffsets,
    sampleSizes,
    sampleDeltas,
    timescale,
    fileBytes,
  );
}

/**
 * Extended iterator that accepts the movie timescale for correct
 * segment_duration conversion.
 *
 * Callers that have access to Mp4File should use this overload so that
 * segmentDuration-based truncation works correctly when mvhd.timescale
 * differs from mdhd.timescale (e.g. mvhd=1000, mdhd=44100).
 *
 * @param track          Parsed Mp4Track.
 * @param fileBytes      Original input buffer.
 * @param movieTimescale mvhd.timescale (pass 0 to skip duration truncation).
 */
export function* iterateAudioSamplesWithContext(
  track: Mp4Track,
  fileBytes: Uint8Array,
  movieTimescale: number,
): Generator<AudioSample> {
  const { editList } = track;

  if (!editList || editList.length === 0) {
    const { sampleTable, mediaHeader } = track;
    const { sampleCount, sampleOffsets, sampleSizes, sampleDeltas } = sampleTable;
    yield* iterateBaseline(
      sampleCount,
      sampleOffsets,
      sampleSizes,
      sampleDeltas,
      mediaHeader.timescale,
      fileBytes,
    );
    return;
  }

  yield* iterateWithEditList(track, fileBytes, editList, movieTimescale);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function* iterateBaseline(
  sampleCount: number,
  sampleOffsets: Float64Array,
  sampleSizes: Uint32Array,
  sampleDeltas: Uint32Array,
  timescale: number,
  fileBytes: Uint8Array,
): Generator<AudioSample> {
  let cumulativeTicks = 0;

  for (let i = 0; i < sampleCount; i++) {
    const offset = sampleOffsets[i] ?? 0;
    const size = sampleSizes[i] ?? 0;
    const delta = sampleDeltas[i] ?? 0;

    const timestampUs = timescale > 0 ? (cumulativeTicks * 1_000_000) / timescale : 0;
    const durationUs = timescale > 0 ? (delta * 1_000_000) / timescale : 0;

    const data = fileBytes.subarray(offset, offset + size);

    yield { data, timestampUs, durationUs, index: i };

    cumulativeTicks += delta;
  }
}

function* iterateWithEditList(
  track: Mp4Track,
  fileBytes: Uint8Array,
  editList: readonly EditListEntry[],
  movieTimescale: number,
): Generator<AudioSample> {
  const { sampleTable, mediaHeader } = track;
  const { sampleCount, sampleOffsets, sampleSizes, sampleDeltas } = sampleTable;
  const timescale = mediaHeader.timescale;

  // Use movieTimescale when provided; fall back to mdhd.timescale for
  // segment_duration conversion when no explicit value was given.
  // When no explicit movie timescale is given (0), fall back to mdhd timescale.
  // However, segmentDuration-based truncation requires knowing the correct mvhd
  // timescale. Use POSITIVE_INFINITY for mediaDurationTicks when the caller
  // did not provide the movie timescale, preventing incorrect truncation.
  const mvTimescale = movieTimescale > 0 ? movieTimescale : 0;

  const ctx = analyseEditList(editList, mvTimescale, timescale);

  if (ctx.hasMultipleSegments) {
    throw new Mp4ElstMultiSegmentNotSupportedError();
  }

  const { presentationOffsetUs, mediaStartTicks, mediaDurationTicks } = ctx;

  // When no non-empty edit was found (only empty edits), we still yield all
  // samples shifted by presentationOffsetUs.
  const skipToTick = mediaStartTicks >= 0 ? mediaStartTicks : 0;
  const hasSkip = mediaStartTicks > 0;

  let cumulativeTicks = 0;
  let emitIndex = 0;

  for (let i = 0; i < sampleCount; i++) {
    const offset = sampleOffsets[i] ?? 0;
    const size = sampleSizes[i] ?? 0;
    const delta = sampleDeltas[i] ?? 0;

    const sampleEndTick = cumulativeTicks + delta;

    if (hasSkip && sampleEndTick <= skipToTick) {
      // This sample ends before the edit start — skip entirely.
      cumulativeTicks = sampleEndTick;
      continue;
    }

    // Compute position relative to the edit's media start.
    const relTicks = cumulativeTicks - skipToTick;

    // Truncation: once we have consumed mediaDurationTicks, stop.
    if (relTicks >= mediaDurationTicks) {
      break;
    }

    // Compute presentation timestamp and duration.
    const timestampUs =
      timescale > 0
        ? presentationOffsetUs + (relTicks * 1_000_000) / timescale
        : presentationOffsetUs;
    const durationUs = timescale > 0 ? (delta * 1_000_000) / timescale : 0;

    const data = fileBytes.subarray(offset, offset + size);

    const sample: AudioSample = { data, timestampUs, durationUs, index: emitIndex };

    // editStartSkipTicks: only for the first emitted sample when it straddles
    // the edit boundary (cumulativeTicks < skipToTick < sampleEndTick).
    if (emitIndex === 0 && hasSkip && cumulativeTicks < skipToTick) {
      const skip = skipToTick - cumulativeTicks;
      if (skip > 0) sample.editStartSkipTicks = skip;
    }

    yield sample;

    emitIndex += 1;
    cumulativeTicks = sampleEndTick;
  }
}

/**
 * Derive the WebCodecs codec string from objectTypeIndication and
 * the first 5 bits of the AudioSpecificConfig (audio_object_type).
 *
 * OTI 0x40 = MPEG-4 Audio → codec string "mp4a.40.<aot>"
 * OTI 0x67 = MPEG-2 LC AAC → codec string "mp4a.67" (no profile suffix)
 *
 * AudioSpecificConfig bit layout (ISO 14496-3 §1.6.2.1):
 *   bits 0–4 (top 5 bits of byte 0): audio_object_type
 */
export function deriveCodecString(
  objectTypeIndication: number,
  decoderSpecificInfo: Uint8Array,
): string {
  if (objectTypeIndication === 0x67) {
    return 'mp4a.67';
  }
  // OTI 0x40 and others: extract audio_object_type from first 5 bits.
  const firstByte = decoderSpecificInfo[0] ?? 0;
  const aot = (firstByte >> 3) & 0x1f;
  return `mp4a.40.${aot}`;
}
