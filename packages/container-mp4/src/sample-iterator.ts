/**
 * Audio sample iterator — converts a parsed Mp4Track or Mp4File into a sequence
 * of EncodedAudioChunk-compatible descriptors.
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
 *
 * Phase 3 sub-pass D: fragmented MP4 iteration.
 *   - iterateFragmentedAudioSamples walks all moof/traf/trun boxes.
 *   - iterateAudioSamplesAuto dispatches by file.isFragmented.
 *   - Defaulting cascade: per-sample > tfhd > trex; unresolvable → Mp4DefaultsCascadeError.
 *   - Bounds check: byteOffset out of range → Mp4CorruptSampleError.
 */

import type { EditListEntry } from './boxes/elst.ts';
import type { Mp4MovieFragment, Mp4TrackFragment } from './boxes/moof.ts';
import type { Mp4FragmentSample, Mp4TrackRun } from './boxes/trun.ts';
import {
  Mp4AmbiguousTrackError,
  Mp4CorruptSampleError,
  Mp4DefaultsCascadeError,
  Mp4ElstMultiSegmentNotSupportedError,
  Mp4ElstValueOutOfRangeError,
  Mp4FragmentNotYetIteratedError,
  Mp4IterateWrongKindError,
  Mp4TrackNotFoundError,
} from './errors.ts';
import type { Mp4File, Mp4Track, Mp4TrackExtends } from './parser.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4Sample {
  /** 'audio' or 'video'. */
  readonly kind: 'audio' | 'video';
  /** Sample index (0-based). */
  readonly index: number;
  /** Presentation timestamp in microseconds. */
  readonly presentationTimeUs: number;
  /** Duration in microseconds. */
  readonly durationUs: number;
  /**
   * True when this sample is a sync sample (keyframe).
   * Always true for audio samples. For video, derived from stss (absent stss → all keyframes).
   */
  readonly isKeyframe: boolean;
  /** Raw sample bytes (zero-copy subarray into fileBytes). */
  readonly data: Uint8Array;
}

/**
 * Back-compat alias. AudioSample exposes the same fields as Mp4Sample plus
 * the legacy `timestampUs` and optional `editStartSkipTicks` fields.
 */
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
 *
 * @throws Mp4IterateWrongKindError when called on a video track.
 */
export function* iterateAudioSamples(
  track: Mp4Track,
  fileBytes: Uint8Array,
): Generator<AudioSample> {
  if (track.sampleEntry.kind === 'video') {
    throw new Mp4IterateWrongKindError('audio', 'video');
  }

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
 * @throws Mp4IterateWrongKindError when called on a video track.
 */
export function* iterateAudioSamplesWithContext(
  track: Mp4Track,
  fileBytes: Uint8Array,
  movieTimescale: number,
): Generator<AudioSample> {
  if (track.sampleEntry.kind === 'video') {
    throw new Mp4IterateWrongKindError('audio', 'video');
  }
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

// ---------------------------------------------------------------------------
// Multi-track resolution helper (sub-pass C)
// ---------------------------------------------------------------------------

/**
 * Resolve the active track from an optional `track` argument.
 *
 * Behaviour:
 * - Omitted + single-track file → returns the one track (back-compat).
 * - Omitted + multi-track file → throws Mp4AmbiguousTrackError.
 * - Provided → validates via reference equality; throws Mp4TrackNotFoundError
 *   if the track does not belong to this file.
 */
function resolveTrack(file: Mp4File, track: Mp4Track | undefined): Mp4Track {
  if (track !== undefined) {
    if (!file.tracks.includes(track)) {
      throw new Mp4TrackNotFoundError();
    }
    return track;
  }
  if (file.tracks.length === 1) {
    const only = file.tracks[0];
    if (!only) throw new Mp4TrackNotFoundError();
    return only;
  }
  throw new Mp4AmbiguousTrackError();
}

// ---------------------------------------------------------------------------
// Fragmented MP4 iteration (sub-pass D)
// ---------------------------------------------------------------------------

/**
 * Iterate over audio samples in a fragmented MP4 file.
 *
 * Walks all moof → traf → trun chains, filtered to the given track.
 *
 * @param file   Parsed fragmented Mp4File (isFragmented must be true).
 * @param track  Optional explicit track to iterate. When omitted:
 *               - single-track file → back-compat (picks the one track).
 *               - multi-track file → throws Mp4AmbiguousTrackError.
 *
 * @throws Mp4AmbiguousTrackError        — multi-track file, no track argument.
 * @throws Mp4TrackNotFoundError         — track not from this file.
 * @throws Mp4DefaultsCascadeError       — duration or size unresolvable.
 * @throws Mp4CorruptSampleError         — byte range out of bounds.
 * @throws Mp4FragmentNotYetIteratedError — called on a non-fragmented file.
 */
export function* iterateFragmentedAudioSamples(
  file: Mp4File,
  track?: Mp4Track,
): Generator<AudioSample> {
  if (!file.isFragmented) {
    throw new Mp4FragmentNotYetIteratedError();
  }

  const resolvedTrack = resolveTrack(file, track);

  if (resolvedTrack.sampleEntry.kind === 'video') {
    throw new Mp4IterateWrongKindError('audio', 'video');
  }

  const { fileBytes, trackExtends, fragments } = file;
  // Per-track timescale (C.3: use mdhd.timescale for each track).
  const timescale = resolvedTrack.mediaHeader.timescale;

  // Build trex lookup by trackId.
  const trexByTrackId = new Map<number, Mp4TrackExtends>();
  for (const trex of trackExtends) {
    trexByTrackId.set(trex.trackId, trex);
  }

  let globalSampleIndex = 0;

  for (const fragment of fragments) {
    // C.3: filter traf entries to this track's trackId.
    for (const traf of fragment.trackFragments) {
      if (traf.trackId !== resolvedTrack.trackId) {
        continue;
      }
      if (traf.durationIsEmpty) {
        continue;
      }

      const trex = trexByTrackId.get(traf.trackId);
      const trafBaseTick = traf.baseMediaDecodeTime ?? 0;

      for (const trun of traf.trackRuns) {
        yield* iterateTrunSamples(
          trun,
          traf,
          trex,
          traf.resolvedBase,
          timescale,
          fileBytes,
          globalSampleIndex,
          trafBaseTick,
        );

        globalSampleIndex += trun.samples.length;
      }
    }
  }
}

function* iterateTrunSamples(
  trun: Mp4TrackRun,
  traf: Mp4TrackFragment,
  trex: Mp4TrackExtends | undefined,
  resolvedBase: number,
  timescale: number,
  fileBytes: Uint8Array,
  globalSampleIndexStart: number,
  trafBaseTick: number,
): Generator<AudioSample> {
  // Resolve base byte cursor.
  // data_offset (SIGNED i32) is relative to resolvedBase.
  const dataOffset = trun.dataOffset ?? 0;
  let runByteCursor = resolvedBase + dataOffset;

  // Validate defaults BEFORE emitting any sample (design §7: validate before first emit).
  // F1: pre-flight checks ALL samples, not just sample 0. If any sample has a null
  // duration/size AND no fallback exists, we throw before the yield loop starts.
  if (trun.samples.length > 0) {
    const durFallback = traf.defaultSampleDuration ?? trex?.defaultSampleDuration ?? null;
    const szFallback = traf.defaultSampleSize ?? trex?.defaultSampleSize ?? null;
    if (durFallback === null && trun.samples.some((s) => s.duration === null)) {
      throw new Mp4DefaultsCascadeError('duration', 0, resolvedBase);
    }
    if (szFallback === null && trun.samples.some((s) => s.size === null)) {
      throw new Mp4DefaultsCascadeError('size', 0, resolvedBase);
    }
  }

  // Start tick from tfdt.baseMediaDecodeTime.
  let localTick = trafBaseTick;

  for (let i = 0; i < trun.samples.length; i++) {
    const rawSample = trun.samples[i];
    if (!rawSample) continue;

    // Duration cascade.
    const duration =
      rawSample.duration ?? traf.defaultSampleDuration ?? trex?.defaultSampleDuration;

    if (duration === undefined || duration === null) {
      throw new Mp4DefaultsCascadeError('duration', globalSampleIndexStart + i, resolvedBase);
    }

    // Size cascade.
    const size = rawSample.size ?? traf.defaultSampleSize ?? trex?.defaultSampleSize;

    if (size === undefined || size === null) {
      throw new Mp4DefaultsCascadeError('size', globalSampleIndexStart + i, resolvedBase);
    }

    // Bounds check (trap from design §9 / iterator).
    if (runByteCursor < 0 || runByteCursor + size > fileBytes.length) {
      throw new Mp4CorruptSampleError(
        globalSampleIndexStart + i,
        runByteCursor,
        size,
        fileBytes.length,
      );
    }

    const data = fileBytes.subarray(runByteCursor, runByteCursor + size);

    const timestampUs = timescale > 0 ? (localTick * 1_000_000) / timescale : 0;
    const durationUs = timescale > 0 ? (duration * 1_000_000) / timescale : 0;

    yield {
      data,
      timestampUs,
      durationUs,
      index: globalSampleIndexStart + i,
    };

    runByteCursor += size;
    localTick += duration;
  }
}

/**
 * Auto-dispatching audio sample iterator.
 *
 * - Fragmented files → delegates to iterateFragmentedAudioSamples.
 * - Classic files → delegates to iterateAudioSamplesWithContext.
 *
 * @param file   Parsed Mp4File.
 * @param track  Optional explicit track. When omitted:
 *               - single-track file → back-compat.
 *               - multi-track file → throws Mp4AmbiguousTrackError.
 *
 * @throws Mp4AmbiguousTrackError    — multi-track file, no track argument.
 * @throws Mp4TrackNotFoundError     — track not from this file.
 * @throws Mp4IterateWrongKindError  — track is a video track.
 */
export function* iterateAudioSamplesAuto(file: Mp4File, track?: Mp4Track): Generator<AudioSample> {
  const resolvedTrack = resolveTrack(file, track);
  if (resolvedTrack.sampleEntry.kind === 'video') {
    throw new Mp4IterateWrongKindError('audio', 'video');
  }
  if (file.isFragmented) {
    yield* iterateFragmentedAudioSamples(file, resolvedTrack);
  } else {
    yield* iterateAudioSamplesWithContext(
      resolvedTrack,
      file.fileBytes,
      file.movieHeader.timescale,
    );
  }
}

// ---------------------------------------------------------------------------
// Video sample iteration (sub-pass B)
// ---------------------------------------------------------------------------

/**
 * Iterate over all video samples in a classic (non-fragmented) MP4 track.
 *
 * Yields one Mp4Sample per sample in presentation order. The `isKeyframe` field
 * is derived from the stss box: absent stss → all samples are keyframes.
 *
 * @param track     Parsed Mp4Track with sampleEntry.kind === 'video'.
 * @param fileBytes Original input buffer.
 * @throws Mp4IterateWrongKindError when called on an audio track.
 */
export function* iterateVideoSamples(track: Mp4Track, fileBytes: Uint8Array): Generator<Mp4Sample> {
  if (track.sampleEntry.kind === 'audio') {
    throw new Mp4IterateWrongKindError('video', 'audio');
  }

  const { sampleTable, mediaHeader, syncSamples } = track;
  const { sampleCount, sampleOffsets, sampleSizes, sampleDeltas } = sampleTable;
  const timescale = mediaHeader.timescale;

  let cumulativeTicks = 0;
  for (let i = 0; i < sampleCount; i++) {
    const offset = sampleOffsets[i] ?? 0;
    const size = sampleSizes[i] ?? 0;
    const delta = sampleDeltas[i] ?? 0;

    const presentationTimeUs = timescale > 0 ? (cumulativeTicks * 1_000_000) / timescale : 0;
    const durationUs = timescale > 0 ? (delta * 1_000_000) / timescale : 0;

    // 1-based sample number for stss lookup.
    const sampleNumber = i + 1;
    // Absent stss → syncSamples is null → all samples are keyframes.
    const isKeyframe = syncSamples === null || syncSamples.has(sampleNumber);

    const data = fileBytes.subarray(offset, offset + size);

    yield { kind: 'video', index: i, presentationTimeUs, durationUs, isKeyframe, data };

    cumulativeTicks += delta;
  }
}

/**
 * Iterate over video samples in a fragmented MP4 file.
 *
 * @param file   Parsed fragmented Mp4File (isFragmented must be true).
 * @param track  Optional explicit track. When omitted:
 *               - single-track file → back-compat.
 *               - multi-track file → throws Mp4AmbiguousTrackError.
 *
 * @throws Mp4AmbiguousTrackError        — multi-track file, no track argument.
 * @throws Mp4TrackNotFoundError         — track not from this file.
 * @throws Mp4IterateWrongKindError      — track is an audio track.
 * @throws Mp4FragmentNotYetIteratedError — called on a non-fragmented file.
 * @throws Mp4DefaultsCascadeError       — duration or size cannot be resolved.
 * @throws Mp4CorruptSampleError         — byte range is out of bounds.
 */
export function* iterateFragmentedVideoSamples(
  file: Mp4File,
  track?: Mp4Track,
): Generator<Mp4Sample> {
  if (!file.isFragmented) {
    throw new Mp4FragmentNotYetIteratedError();
  }

  const resolvedTrack = resolveTrack(file, track);

  if (resolvedTrack.sampleEntry.kind === 'audio') {
    throw new Mp4IterateWrongKindError('video', 'audio');
  }

  const { fileBytes, trackExtends, fragments } = file;
  // Per-track timescale (C.3).
  const timescale = resolvedTrack.mediaHeader.timescale;

  // Build trex lookup by trackId.
  const trexByTrackId = new Map<number, Mp4TrackExtends>();
  for (const trex of trackExtends) {
    trexByTrackId.set(trex.trackId, trex);
  }

  let globalSampleIndex = 0;

  for (const fragment of fragments) {
    // C.3: filter traf entries to this track's trackId.
    for (const traf of fragment.trackFragments) {
      if (traf.trackId !== resolvedTrack.trackId) {
        continue;
      }
      if (traf.durationIsEmpty) {
        continue;
      }

      const trex = trexByTrackId.get(traf.trackId);
      const trafBaseTick = traf.baseMediaDecodeTime ?? 0;

      for (const trun of traf.trackRuns) {
        yield* iterateVideoTrunSamples(
          trun,
          traf,
          trex,
          traf.resolvedBase,
          timescale,
          fileBytes,
          globalSampleIndex,
          trafBaseTick,
        );
        globalSampleIndex += trun.samples.length;
      }
    }
  }
}

function* iterateVideoTrunSamples(
  trun: Mp4TrackRun,
  traf: Mp4TrackFragment,
  trex: Mp4TrackExtends | undefined,
  resolvedBase: number,
  timescale: number,
  fileBytes: Uint8Array,
  globalSampleIndexStart: number,
  trafBaseTick: number,
): Generator<Mp4Sample> {
  const dataOffset = trun.dataOffset ?? 0;
  let runByteCursor = resolvedBase + dataOffset;

  if (trun.samples.length > 0) {
    const durFallback = traf.defaultSampleDuration ?? trex?.defaultSampleDuration ?? null;
    const szFallback = traf.defaultSampleSize ?? trex?.defaultSampleSize ?? null;
    if (durFallback === null && trun.samples.some((s) => s.duration === null)) {
      throw new Mp4DefaultsCascadeError('duration', 0, resolvedBase);
    }
    if (szFallback === null && trun.samples.some((s) => s.size === null)) {
      throw new Mp4DefaultsCascadeError('size', 0, resolvedBase);
    }
  }

  let localTick = trafBaseTick;

  for (let i = 0; i < trun.samples.length; i++) {
    const rawSample = trun.samples[i];
    if (!rawSample) continue;

    const duration =
      rawSample.duration ?? traf.defaultSampleDuration ?? trex?.defaultSampleDuration;
    if (duration === undefined || duration === null) {
      throw new Mp4DefaultsCascadeError('duration', globalSampleIndexStart + i, resolvedBase);
    }

    const size = rawSample.size ?? traf.defaultSampleSize ?? trex?.defaultSampleSize;
    if (size === undefined || size === null) {
      throw new Mp4DefaultsCascadeError('size', globalSampleIndexStart + i, resolvedBase);
    }

    if (runByteCursor < 0 || runByteCursor + size > fileBytes.length) {
      throw new Mp4CorruptSampleError(
        globalSampleIndexStart + i,
        runByteCursor,
        size,
        fileBytes.length,
      );
    }

    const data = fileBytes.subarray(runByteCursor, runByteCursor + size);
    const presentationTimeUs = timescale > 0 ? (localTick * 1_000_000) / timescale : 0;
    const durationUs = timescale > 0 ? (duration * 1_000_000) / timescale : 0;

    // Determine isKeyframe from the sample flags cascade:
    //   1. per-sample rawSample.flags (if present)
    //   2. trun.firstSampleFlags overrides sample 0 only (when trun.firstSampleFlags != null)
    //   3. traf.defaultSampleFlags (per-traf default, if present)
    //   4. trex.defaultSampleFlags (per-track default)
    // bit 16 of flags (mask 0x010000) = sample_is_non_sync_sample.
    // isKeyframe = (sampleFlags & 0x010000) === 0
    let sampleFlags: number | null = rawSample.flags;
    if (i === 0 && trun.firstSampleFlags !== null) {
      // firstSampleFlags overrides per-sample flags for sample 0
      sampleFlags = trun.firstSampleFlags;
    }
    if (sampleFlags === null) {
      sampleFlags = traf.defaultSampleFlags ?? trex?.defaultSampleFlags ?? 0;
    }
    const isKeyframe = (sampleFlags & 0x010000) === 0;

    yield {
      kind: 'video',
      index: globalSampleIndexStart + i,
      presentationTimeUs,
      durationUs,
      isKeyframe,
      data,
    };

    runByteCursor += size;
    localTick += duration;
  }
}

/**
 * Auto-dispatching unified sample iterator. Dispatches on track sampleEntry.kind.
 *
 * - Audio tracks → delegates to iterateAudioSamplesAuto.
 * - Video tracks → delegates to iterateVideoSamples (classic) or
 *   iterateFragmentedVideoSamples.
 *
 * @param file   Parsed Mp4File.
 * @param track  Optional explicit track. When omitted:
 *               - single-track file → back-compat.
 *               - multi-track file → throws Mp4AmbiguousTrackError.
 *
 * @throws Mp4AmbiguousTrackError  — multi-track file, no track argument.
 * @throws Mp4TrackNotFoundError   — track not from this file.
 */
export function* iterateSamples(file: Mp4File, track?: Mp4Track): Generator<Mp4Sample> {
  const resolvedTrack = resolveTrack(file, track);

  if (resolvedTrack.sampleEntry.kind === 'video') {
    if (file.isFragmented) {
      yield* iterateFragmentedVideoSamples(file, resolvedTrack);
    } else {
      yield* iterateVideoSamples(resolvedTrack, file.fileBytes);
    }
  } else {
    // Audio: adapt AudioSample → Mp4Sample.
    const audioGen = file.isFragmented
      ? iterateFragmentedAudioSamples(file, resolvedTrack)
      : iterateAudioSamplesWithContext(resolvedTrack, file.fileBytes, file.movieHeader.timescale);
    for (const s of audioGen) {
      yield {
        kind: 'audio',
        index: s.index,
        presentationTimeUs: s.timestampUs,
        durationUs: s.durationUs,
        isKeyframe: true, // AAC frames are always key frames
        data: s.data,
      };
    }
  }
}
