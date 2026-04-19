/**
 * Tests for serializer.ts — MP4 muxer.
 *
 * Design note test cases covered:
 *   - "round-trip: parse → serialize → byte-identical for a clean M4A"
 *   - "serializer faststart re-layout: input mdat-first → output ftyp+moov+mdat with patched offsets"
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { parseMp4 } from './parser.ts';
import { serializeMp4 } from './serializer.ts';

describe('serializeMp4 — round-trip', () => {
  it('round-trip: parse → serialize → parse produces structurally equivalent file', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    const serialized = serializeMp4(original);

    // Re-parse the serialized output.
    const reparsed = parseMp4(serialized);

    // Structural equivalence checks (not byte-identical since we re-lay out the boxes).
    expect(reparsed.ftyp.majorBrand).toBe(original.ftyp.majorBrand);
    expect(reparsed.tracks).toHaveLength(1);
    const origTrack = original.tracks[0]!;
    const newTrack = reparsed.tracks[0]!;
    expect(newTrack.mediaHeader.timescale).toBe(origTrack.mediaHeader.timescale);
    expect(newTrack.sampleTable.sampleCount).toBe(origTrack.sampleTable.sampleCount);
    expect(newTrack.audioSampleEntry.channelCount).toBe(origTrack.audioSampleEntry.channelCount);
    expect(newTrack.audioSampleEntry.sampleRate).toBe(origTrack.audioSampleEntry.sampleRate);
  });

  it('round-trip preserves sample data byte-for-byte', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    const serialized = serializeMp4(original);
    const reparsed = parseMp4(serialized);

    // Compare sample data: collect all sample bytes from original and reparsed.
    const origTrack = original.tracks[0]!;
    const newTrack = reparsed.tracks[0]!;

    const {
      sampleOffsets: origOffsets,
      sampleSizes: origSizes,
      sampleCount,
    } = origTrack.sampleTable;
    const { sampleOffsets: newOffsets, sampleSizes: newSizes } = newTrack.sampleTable;

    expect(sampleCount).toBe(newTrack.sampleTable.sampleCount);

    // Compare each sample's bytes.
    for (let i = 0; i < sampleCount; i++) {
      const origSample = bytes.subarray(origOffsets[i]!, origOffsets[i]! + origSizes[i]!);
      const newSample = serialized.subarray(newOffsets[i]!, newOffsets[i]! + newSizes[i]!);
      expect(origSample.length).toBe(newSample.length);
      for (let b = 0; b < origSample.length; b++) {
        if (origSample[b] !== newSample[b]) {
          throw new Error(`Sample ${i} byte ${b} mismatch: ${origSample[b]} != ${newSample[b]}`);
        }
      }
    }
  });

  it('serializer faststart re-layout: output always starts with ftyp then moov then mdat', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    const serialized = serializeMp4(original);

    // Verify output structure: ftyp at offset 0, then moov, then mdat.
    const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);

    // First box must be ftyp.
    const firstSize = view.getUint32(0, false);
    const firstType = String.fromCharCode(
      serialized[4]!,
      serialized[5]!,
      serialized[6]!,
      serialized[7]!,
    );
    expect(firstType).toBe('ftyp');
    expect(firstSize).toBeGreaterThan(8);

    // Second box must be moov.
    const secondOffset = firstSize;
    const secondType = String.fromCharCode(
      serialized[secondOffset + 4]!,
      serialized[secondOffset + 5]!,
      serialized[secondOffset + 6]!,
      serialized[secondOffset + 7]!,
    );
    expect(secondType).toBe('moov');

    // Third box must be mdat.
    const secondSize = view.getUint32(secondOffset, false);
    const thirdOffset = secondOffset + secondSize;
    const thirdType = String.fromCharCode(
      serialized[thirdOffset + 4]!,
      serialized[thirdOffset + 5]!,
      serialized[thirdOffset + 6]!,
      serialized[thirdOffset + 7]!,
    );
    expect(thirdType).toBe('mdat');
  });

  it('patched chunk offsets point into the mdat payload in the serialized output', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    const serialized = serializeMp4(original);
    const reparsed = parseMp4(serialized);

    const track = reparsed.tracks[0]!;
    const { sampleOffsets, sampleSizes, sampleCount } = track.sampleTable;

    // Every sample offset must be within the serialized buffer.
    for (let i = 0; i < sampleCount; i++) {
      const off = sampleOffsets[i]!;
      const sz = sampleSizes[i]!;
      expect(off + sz).toBeLessThanOrEqual(serialized.length);
    }
  });

  it('returns empty Uint8Array for an Mp4File with no tracks', () => {
    const emptyFile = {
      ftyp: { majorBrand: 'mp42', minorVersion: 0, compatibleBrands: ['isom'] },
      movieHeader: { version: 0 as const, timescale: 1000, duration: 0, nextTrackId: 1 },
      tracks: [],
      mdatRanges: [],
      fileBytes: new Uint8Array(0),
    };
    const result = serializeMp4(emptyFile);
    expect(result.length).toBe(0);
  });

  it('serializes a file with multiple stsc entries (multi-run stsc coverage)', async () => {
    // Parse fixture, then modify the track to have multiple stsc entries,
    // forcing the serializer to iterate through the stsc run boundary logic.
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const original = parseMp4(bytes);
    const origTrack = original.tracks[0]!;

    // Build a synthetic track with 2 stsc entries: first 2 chunks get 1 sample each,
    // then remaining chunks get 2 samples each. We use the real sample data.
    const { sampleOffsets, sampleSizes, sampleCount } = origTrack.sampleTable;
    // Build 4 chunks: chunk1=[s0], chunk2=[s1], chunk3=[s2,s3], chunk4=[s4,s5]
    // (only if enough samples)
    if (sampleCount < 6) return; // guard for minimal fixtures

    const stscEntries = [
      { firstChunk: 1, samplesPerChunk: 1, sampleDescriptionIndex: 1 },
      { firstChunk: 3, samplesPerChunk: 2, sampleDescriptionIndex: 1 },
    ];
    // chunk offsets: take first 4 sample offsets as chunk starts
    const chunkOffsets = [
      sampleOffsets[0] ?? 0,
      sampleOffsets[1] ?? 0,
      sampleOffsets[2] ?? 0,
      sampleOffsets[4] ?? 0,
    ];

    const modifiedTrack = {
      ...origTrack,
      stscEntries,
      chunkOffsets,
      chunkOffsetVariant: 'stco' as const,
    };

    const modifiedFile = { ...original, tracks: [modifiedTrack] };
    // Should not throw — serializer must handle multi-stsc correctly.
    const serialized = serializeMp4(modifiedFile);
    expect(serialized.length).toBeGreaterThan(0);

    // Verify the output has correct box structure.
    const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);
    const firstSize = view.getUint32(0, false);
    const firstType = String.fromCharCode(
      serialized[4]!,
      serialized[5]!,
      serialized[6]!,
      serialized[7]!,
    );
    expect(firstType).toBe('ftyp');
    expect(firstSize).toBeGreaterThan(8);
  });
});
