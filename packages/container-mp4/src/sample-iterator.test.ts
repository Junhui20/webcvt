/**
 * Tests for sample-iterator.ts — audio sample iteration.
 *
 * Covers:
 * - Timestamp computation from stts deltas and mdhd.timescale
 * - Duration computation
 * - Zero-copy data subarray correctness
 * - deriveCodecString for OTI 0x40 (MPEG-4) and 0x67 (MPEG-2)
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { parseMp4 } from './parser.ts';
import { deriveCodecString, iterateAudioSamples } from './sample-iterator.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockTrack(
  sampleCount: number,
  sampleDelta: number,
  timescale: number,
  sampleSizes: number[],
  sampleOffsets: number[],
) {
  return {
    trackId: 1,
    handlerType: 'soun' as const,
    mediaHeader: {
      version: 0 as const,
      timescale,
      duration: sampleCount * sampleDelta,
      language: 'und',
    },
    trackHeader: {
      version: 0 as const,
      flags: 3,
      trackId: 1,
      duration: sampleCount * sampleDelta,
      volume: 0x0100,
    },
    audioSampleEntry: {
      channelCount: 1,
      sampleSize: 16,
      sampleRate: 44100,
      decoderSpecificInfo: new Uint8Array([0x12, 0x10]),
      objectTypeIndication: 0x40,
    },
    sampleTable: {
      sampleCount,
      sampleSizes: new Uint32Array(sampleSizes),
      sampleOffsets: new Float64Array(sampleOffsets),
      sampleDeltas: new Uint32Array(Array(sampleCount).fill(sampleDelta)),
    },
    sttsEntries: [{ sampleCount, sampleDelta }],
    stscEntries: [{ firstChunk: 1, samplesPerChunk: 1, sampleDescriptionIndex: 1 }],
    chunkOffsets: sampleOffsets,
    chunkOffsetVariant: 'stco' as const,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('iterateAudioSamples', () => {
  it('yields the correct number of samples', () => {
    const track = buildMockTrack(4, 1024, 44100, [100, 200, 150, 80], [0, 100, 300, 450]);
    const fileBytes = new Uint8Array(530);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));
    expect(samples).toHaveLength(4);
  });

  it('computes timestamps correctly from cumulative stts deltas', () => {
    // 4 samples, each 1024 ticks at 44100 Hz.
    const track = buildMockTrack(4, 1024, 44100, [100, 100, 100, 100], [0, 100, 200, 300]);
    const fileBytes = new Uint8Array(400);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));

    // Sample 0: timestamp = 0 µs.
    expect(samples[0]!.timestampUs).toBeCloseTo(0, 0);
    // Sample 1: 1024/44100 * 1e6 ≈ 23220 µs.
    expect(samples[1]!.timestampUs).toBeCloseTo((1024 / 44100) * 1_000_000, 0);
    // Sample 2: 2048/44100 * 1e6.
    expect(samples[2]!.timestampUs).toBeCloseTo((2048 / 44100) * 1_000_000, 0);
    // Sample 3: 3072/44100 * 1e6.
    expect(samples[3]!.timestampUs).toBeCloseTo((3072 / 44100) * 1_000_000, 0);
  });

  it('computes duration correctly from sampleDelta and timescale', () => {
    const track = buildMockTrack(2, 1024, 44100, [100, 100], [0, 100]);
    const fileBytes = new Uint8Array(200);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));
    const expectedDuration = (1024 / 44100) * 1_000_000;
    expect(samples[0]!.durationUs).toBeCloseTo(expectedDuration, 0);
    expect(samples[1]!.durationUs).toBeCloseTo(expectedDuration, 0);
  });

  it('yields zero-length samples for empty track', () => {
    const track = buildMockTrack(0, 1024, 44100, [], []);
    const fileBytes = new Uint8Array(0);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));
    expect(samples).toHaveLength(0);
  });

  it('data field is a subarray (zero-copy) into fileBytes', () => {
    const track = buildMockTrack(1, 1024, 44100, [4], [10]);
    const fileBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xaa, 0xbb, 0xcc, 0xdd]);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));
    // sample at offset 10, size 4: bytes [0xAA, 0xBB, 0xCC, 0xDD]
    expect(samples[0]!.data.length).toBe(4);
    expect(samples[0]!.data[0]).toBe(0xaa);
    expect(samples[0]!.data[3]).toBe(0xdd);
  });

  it('assigns correct index values', () => {
    const track = buildMockTrack(3, 512, 48000, [50, 50, 50], [0, 50, 100]);
    const fileBytes = new Uint8Array(150);
    const samples = Array.from(iterateAudioSamples(track, fileBytes));
    expect(samples[0]!.index).toBe(0);
    expect(samples[1]!.index).toBe(1);
    expect(samples[2]!.index).toBe(2);
  });
});

describe('iterateAudioSamples — fixture', () => {
  it('iterates all samples from the M4A fixture and verifies timestamps increase monotonically', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const track = file.tracks[0]!;
    const samples = Array.from(iterateAudioSamples(track, file.fileBytes));

    expect(samples.length).toBe(track.sampleTable.sampleCount);

    let prevTimestamp = -1;
    for (const sample of samples) {
      expect(sample.timestampUs).toBeGreaterThanOrEqual(prevTimestamp);
      expect(sample.data.length).toBeGreaterThan(0);
      prevTimestamp = sample.timestampUs;
    }
  });
});

describe('deriveCodecString', () => {
  it('returns mp4a.40.2 for OTI 0x40 and LC AAC ASC', () => {
    // LC AAC ASC: first 5 bits = 0b00010 = 2 (AAC-LC).
    // ASC byte 0 = 0b00010_xxx = 0x10 | sampling_freq_bits
    // For 44100 Hz: sfi = 4 → byte 0 = (2 << 3) | (4 >> 1) = 0x10 | 0x02 = 0x12
    const asc = new Uint8Array([0x12, 0x10]);
    expect(deriveCodecString(0x40, asc)).toBe('mp4a.40.2');
  });

  it('returns mp4a.40.5 for OTI 0x40 and HE-AAC v1 ASC', () => {
    // audio_object_type = 5 (SBR). First 5 bits = 0b00101 = 5.
    // byte 0 = (5 << 3) | ... = 0b00101xxx = 0x28 | something
    const asc = new Uint8Array([0x28, 0x00]);
    expect(deriveCodecString(0x40, asc)).toBe('mp4a.40.5');
  });

  it('returns mp4a.67 for OTI 0x67 (MPEG-2 AAC)', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    expect(deriveCodecString(0x67, asc)).toBe('mp4a.67');
  });

  it('handles empty decoderSpecificInfo gracefully', () => {
    // aot = (0 >> 3) & 0x1f = 0
    const result = deriveCodecString(0x40, new Uint8Array(0));
    expect(result).toBe('mp4a.40.0');
  });
});
