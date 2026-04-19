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
 */

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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Iterate over all audio samples in a parsed track.
 *
 * Yields one AudioSample per sample in order.
 * Timestamps are computed from cumulative stts deltas using mdhd.timescale.
 *
 * @param track     Parsed Mp4Track (soun handler).
 * @param fileBytes Original input buffer (samples are sliced from this).
 */
export function* iterateAudioSamples(
  track: Mp4Track,
  fileBytes: Uint8Array,
): Generator<AudioSample> {
  const { sampleTable, mediaHeader } = track;
  const { sampleCount, sampleOffsets, sampleSizes, sampleDeltas } = sampleTable;
  const timescale = mediaHeader.timescale;

  // Accumulate timestamp in timescale units (integer arithmetic to avoid float drift).
  let cumulativeTicks = 0;

  for (let i = 0; i < sampleCount; i++) {
    const offset = sampleOffsets[i] ?? 0;
    const size = sampleSizes[i] ?? 0;
    const delta = sampleDeltas[i] ?? 0;

    // Timestamp and duration in microseconds.
    // Use integer ticks for accumulation, convert to µs at yield time.
    const timestampUs = timescale > 0 ? (cumulativeTicks * 1_000_000) / timescale : 0;
    const durationUs = timescale > 0 ? (delta * 1_000_000) / timescale : 0;

    // Zero-copy subarray (Lesson #3). Caller slices if they need a copy.
    const data = fileBytes.subarray(offset, offset + size);

    yield {
      data,
      timestampUs,
      durationUs,
      index: i,
    };

    cumulativeTicks += delta;
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
