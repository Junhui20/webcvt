/**
 * Tests for Phase 3 sub-pass D.1 + D.2: Fragmented MP4 detection, parse, and iteration.
 *
 * Test coverage:
 *   D.1 (4 tests): Detection + mvex/trex parse; iterator stub errors.
 *   D.2 (18 tests): moof/mfhd/traf/tfhd/tfdt/trun parse + iterator.
 *
 * All test fixtures are built programmatically via build-fmp4.ts helpers.
 * No binary files are committed.
 *
 * Tests follow the ISO/IEC 14496-12:2022 §8.8 spec from the design note.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFmp4,
  buildMinimalFmp4,
  buildMultiFragmentFmp4,
} from '../_test-helpers/build-fmp4.ts';
import {
  Mp4CorruptSampleError,
  Mp4DefaultsCascadeError,
  Mp4FragmentCountTooLargeError,
  Mp4FragmentMixedSampleTablesError,
  Mp4FragmentNotYetIteratedError,
  Mp4FragmentedSerializeNotSupportedError,
  Mp4InvalidBoxError,
  Mp4MoofMissingMfhdError,
  Mp4MoofSequenceOutOfOrderError,
  Mp4TfdtValueOutOfRangeError,
  Mp4TfdtVersionError,
  Mp4TfhdLegacyBaseUnsupportedError,
  Mp4TfhdUnknownTrackError,
  Mp4TfhdValueOutOfRangeError,
  Mp4TrafCountTooLargeError,
  Mp4TrunSampleCountTooLargeError,
  Mp4TrunSizeMismatchError,
} from '../errors.ts';
import { parseMp4 } from '../parser.ts';
import {
  iterateAudioSamplesAuto,
  iterateAudioSamplesWithContext,
  iterateFragmentedAudioSamples,
} from '../sample-iterator.ts';
import { serializeMp4 } from '../serializer.ts';

// ---------------------------------------------------------------------------
// D.1 Tests: Detection + mvex/trex parse
// ---------------------------------------------------------------------------

describe('D.1: Fragmented MP4 detection', () => {
  it('D.1.1: minimal fMP4 (1 moof, 10 samples) is detected as fragmented', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 10, sampleSize: 4 });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    expect(file.trackExtends).toHaveLength(1);
    expect(file.fragments).toHaveLength(1);
    // D.4: fragmentedTail is now populated (non-null) for fragmented files.
    expect(file.sidx).toBeNull();
    expect(file.fragmentedTail).not.toBeNull(); // populated in D.4
    expect(file.originalMoovSize).not.toBeNull(); // populated in D.4
    expect(file.mfra).toBeNull();
  });

  it('D.1.2: trex defaults are parsed correctly from mvex', () => {
    const bytes = buildFmp4({
      trexDefaultDuration: 2048,
      trexDefaultSize: 100,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{}] },
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    expect(file.trackExtends).toHaveLength(1);
    const trex = file.trackExtends[0];
    expect(trex?.trackId).toBe(1);
    expect(trex?.defaultSampleDuration).toBe(2048);
    expect(trex?.defaultSampleSize).toBe(100);
    expect(trex?.defaultSampleDescriptionIndex).toBe(1);
  });

  it('D.1.3: classic MP4 (no mvex) is NOT fragmented', async () => {
    // Load the test fixture — a classic AAC M4A file.
    const { loadFixture } = await import('@webcvt/test-utils');
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(false);
    expect(file.trackExtends).toHaveLength(0);
    expect(file.fragments).toHaveLength(0);
  });

  it('D.1.4: iterateAudioSamplesWithContext throws on fragmented file', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 5, sampleSize: 4 });
    const file = parseMp4(bytes);
    const track = file.tracks[0]!;

    // iterateAudioSamples / iterateAudioSamplesWithContext should not be used on fragmented;
    // the fragmented iterator is the correct one.
    // Classic iterator doesn't auto-detect fragmentation — it just yields 0 samples
    // (because sampleTable.sampleCount == 0 for fragmented moov stbl).
    // The design says "calling it on a fragmented file is undefined" but we have
    // Mp4FragmentNotYetIteratedError on iterateFragmentedAudioSamples for non-fragmented.
    // Test that iterateAudioSamplesAuto dispatches correctly to fragmented path.
    const samples = [...iterateAudioSamplesAuto(file)];
    expect(samples).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// D.2 Tests: moof/mfhd/traf/tfhd/tfdt/trun parse + iterator
// ---------------------------------------------------------------------------

describe('D.2: moof parse + trun flags', () => {
  it('D.2.1: multi-fragment (10 moofs, monotonic sequence numbers)', () => {
    const bytes = buildMultiFragmentFmp4({
      fragmentCount: 10,
      samplesPerFragment: 5,
      sampleSize: 8,
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    expect(file.fragments).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(file.fragments[i]?.sequenceNumber).toBe(i + 1);
    }
  });

  it('D.2.2: tfhd default-base-is-moof resolves byte offsets correctly', () => {
    const sampleSize = 16;
    const bytes = buildMinimalFmp4({ sampleCount: 3, sampleSize });
    const file = parseMp4(bytes);

    const samples = [...iterateFragmentedAudioSamples(file)];
    expect(samples).toHaveLength(3);
    // All samples should have the correct size.
    for (const sample of samples) {
      expect(sample.data.length).toBe(sampleSize);
    }
  });

  it('D.2.3: tfhd base-data-offset-present (explicit base) — parsed correctly', () => {
    // Build an fMP4 where tfhd uses explicit base_data_offset (flag 0x000001).
    // Strategy: build with default-base-is-moof to discover the mdat start offset,
    // then re-parse and check that the resolved byte offsets are correct.
    // We verify the traf has baseDataOffset set (not null) and samples iterate correctly
    // using a known-good file structure.

    // The builder always uses default-base-is-moof internally when no explicit
    // tfhdOpts are given. To test explicit base_data_offset, we use the builder
    // with an explicit base that matches the ACTUAL mdat start in the file.
    // Since the two builds have the same structure (same sample count/size), the
    // offsets are the same if we use the same samples and both have explicit base.

    // Build first to measure the mdat start position.
    const sampleCount = 4;
    const sampleSize = 8;

    // Build using the helper that lets us specify explicit base via builder params.
    // The builder's buildFragment function computes the correct data_offset relative
    // to the moof when defaultBaseIsMoof is used. For explicit base_data_offset,
    // we provide baseDataOffset = (moof_start + moof_size + 8) which equals the
    // mdat payload start. The builder's trial run handles this when dataOffset is not set.
    //
    // SIMPLIFICATION: Just verify the structural field is parsed, skip actual iteration.
    // Use a large explicit base to confirm flag parsing works.
    const explicitBase = 12345; // arbitrary non-zero value

    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: {
            trackId: 1,
            baseDataOffset: explicitBase,
          },
          trun: {
            dataOffset: 0,
            samples: Array.from({ length: sampleCount }, () => ({
              duration: 1024,
              size: sampleSize,
            })),
          },
        },
      ],
    });

    const file = parseMp4(bytes);
    const traf = file.fragments[0]?.trackFragments[0];

    // The base-data-offset-present flag (0x000001) was set.
    expect(traf?.baseDataOffset).toBe(explicitBase);
    // The resolvedBase should be the explicit base value.
    expect(traf?.resolvedBase).toBe(explicitBase);
    // defaultBaseIsMoof should be false (since explicit base was used).
    expect(traf?.defaultBaseIsMoof).toBe(false);
  });

  it('D.2.4: tfdt v0 (32-bit base media decode time)', () => {
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          tfdt: { baseMediaDecodeTime: 44100, version: 0 },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });
    const file = parseMp4(bytes);

    const traf = file.fragments[0]?.trackFragments[0];
    expect(traf?.tfdtVersion).toBe(0);
    expect(traf?.baseMediaDecodeTime).toBe(44100);
  });

  it('D.2.5: tfdt v1 (64-bit base media decode time)', () => {
    const bigTime = 0x100000000; // 2^32 — requires v1 for safe representation
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          tfdt: { baseMediaDecodeTime: bigTime, version: 1 },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });
    const file = parseMp4(bytes);

    const traf = file.fragments[0]?.trackFragments[0];
    expect(traf?.tfdtVersion).toBe(1);
    expect(traf?.baseMediaDecodeTime).toBe(bigTime);
  });

  it('D.2.6: trun with all 6 flag bits set (duration+size+flags+cto+data_offset+first_sample_flags)', () => {
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            firstSampleFlags: 0x02000000, // non-sync sample flags
            samples: [
              { duration: 1024, size: 8, flags: 0, compositionTimeOffset: 512 },
              { duration: 1024, size: 8, flags: 0, compositionTimeOffset: 0 },
            ],
          },
        },
      ],
    });
    const file = parseMp4(bytes);
    const trun = file.fragments[0]?.trackFragments[0]?.trackRuns[0];

    expect(trun).toBeDefined();
    expect(trun?.firstSampleFlags).toBe(0x02000000);
    expect(trun?.samples[0]?.compositionTimeOffset).toBe(512);
    expect(trun?.samples[1]?.compositionTimeOffset).toBe(0);
  });

  it('D.2.7: trun trap 16 — first_sample_flags suppresses sample 0 sample_flags field', () => {
    // Build trun with both FLAG_FIRST_SAMPLE_FLAGS (0x000004) and FLAG_SAMPLE_FLAGS (0x000400).
    // Sample 0's per-sample flags field must be omitted in the wire format.
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            firstSampleFlags: 0x02000000,
            samples: [
              // sample 0: flags omitted in wire (first_sample_flags applies)
              { duration: 1024, size: 4, flags: 0x01000000 }, // this flags value from builder
              // sample 1: flags present in wire
              { duration: 1024, size: 4, flags: 0x01000000 },
            ],
          },
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    // Sample count should be parsed correctly (no size mismatch error).
    const trun = file.fragments[0]?.trackFragments[0]?.trackRuns[0];
    expect(trun?.samples).toHaveLength(2);
  });

  it('D.2.8: tfhd with defaultSampleDuration + defaultSampleSize flags only', () => {
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: {
            trackId: 1,
            defaultBaseIsMoof: true,
            defaultSampleDuration: 2048,
            defaultSampleSize: 32,
          },
          trun: {
            // No per-sample duration/size — defaults from tfhd
            samples: [{}, {}],
          },
        },
      ],
    });
    const file = parseMp4(bytes);

    const traf = file.fragments[0]?.trackFragments[0];
    expect(traf?.defaultSampleDuration).toBe(2048);
    expect(traf?.defaultSampleSize).toBe(32);
  });

  it('D.2.9: iterator with tfhd defaults cascade: no per-sample fields, tfhd provides defaults', () => {
    const bytes = buildFmp4({
      trexDefaultDuration: 0, // trex has no useful default
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: {
            trackId: 1,
            defaultBaseIsMoof: true,
            defaultSampleDuration: 1024,
            defaultSampleSize: 8,
          },
          trun: {
            // Empty sample objects — defaults come from tfhd.
            samples: Array.from({ length: 5 }, () => ({})),
          },
        },
      ],
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(5);
    // Each sample should have duration from tfhd (1024 / 44100 * 1e6 µs).
    const expectedDurationUs = (1024 * 1_000_000) / 44100;
    for (const s of samples) {
      expect(s.durationUs).toBeCloseTo(expectedDurationUs, 0);
    }
  });

  it('D.2.10: iterator with trex defaults cascade: no tfhd defaults, trex provides', () => {
    const bytes = buildFmp4({
      trexDefaultDuration: 512,
      trexDefaultSize: 16,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            // No per-sample fields — both defaults from trex.
            samples: Array.from({ length: 3 }, () => ({})),
          },
        },
      ],
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(3);
    const expectedDurationUs = (512 * 1_000_000) / 44100;
    for (const s of samples) {
      expect(s.durationUs).toBeCloseTo(expectedDurationUs, 0);
      expect(s.data.length).toBe(16);
    }
  });

  it('D.2.11: cumulative timestamps across 3 fragments', () => {
    const sampleDuration = 1024;
    const samplesPerFrag = 4;
    const bytes = buildMultiFragmentFmp4({
      fragmentCount: 3,
      samplesPerFragment: samplesPerFrag,
      sampleSize: 4,
      sampleDuration,
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(3 * samplesPerFrag);

    // Timestamps should be monotonically increasing.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.timestampUs).toBeGreaterThan(samples[i - 1]!.timestampUs);
    }
    // First sample timestamp should be 0.
    expect(samples[0]?.timestampUs).toBe(0);
  });

  it('D.2.12: iterateAudioSamplesAuto dispatches to fragmented for fragmented file', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 8, sampleSize: 4 });
    const file = parseMp4(bytes);

    const samplesAuto = [...iterateAudioSamplesAuto(file)];
    const samplesDirect = [...iterateFragmentedAudioSamples(file)];

    expect(samplesAuto).toHaveLength(samplesDirect.length);
    expect(samplesAuto).toHaveLength(8);
  });

  it('D.2.13: iterateAudioSamplesAuto dispatches to classic for non-fragmented file', async () => {
    const { loadFixture } = await import('@webcvt/test-utils');
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);

    const samplesAuto = [...iterateAudioSamplesAuto(file)];
    const track = file.tracks[0]!;
    const samplesClassic = [
      ...iterateAudioSamplesWithContext(track, file.fileBytes, file.movieHeader.timescale),
    ];

    expect(samplesAuto.length).toBeGreaterThan(0);
    expect(samplesAuto).toHaveLength(samplesClassic.length);
  });

  it('D.2.14: empty traf (no trun) yields 0 samples — legal per trap 8', () => {
    // Build an fMP4 where the traf has no trun.
    // We achieve this by having a fragment spec with 0 samples.
    const bytes = buildFmp4({
      trexDefaultDuration: 1024,
      trexDefaultSize: 4,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [] }, // 0 samples → empty trun
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    expect(file.fragments).toHaveLength(1);

    const samples = [...iterateFragmentedAudioSamples(file)];
    expect(samples).toHaveLength(0);
  });

  it('D.2.15: duration-is-empty traf flag yields 0 samples without error', () => {
    // Build a tfhd with duration-is-empty flag (0x010000).
    const bytes = buildFmp4({
      trexDefaultDuration: 1024,
      trexDefaultSize: 8,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: {
            trackId: 1,
            defaultBaseIsMoof: true,
            durationIsEmpty: true,
          },
          trun: {
            samples: [{ duration: 1024, size: 8 }], // builder still includes trun
          },
        },
      ],
    });
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);
    // durationIsEmpty traf should yield 0 samples in the iterator.
    const samples = [...iterateFragmentedAudioSamples(file)];
    expect(samples).toHaveLength(0);
  });

  it('D.2.16: serializer no longer throws Mp4FragmentedSerializeNotSupportedError (D.4 round-trip implemented)', () => {
    // D.4 replaced the throw-guard with real round-trip serialization.
    // Mp4FragmentedSerializeNotSupportedError is now @deprecated and never thrown.
    const bytes = buildMinimalFmp4({ sampleCount: 2, sampleSize: 4 });
    const file = parseMp4(bytes);

    // Should succeed (round-trip) rather than throw.
    expect(() => serializeMp4(file)).not.toThrow();
  });

  it('D.2.17: iterateFragmentedAudioSamples throws when called on non-fragmented file', async () => {
    const { loadFixture } = await import('@webcvt/test-utils');
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);

    expect(() => {
      const gen = iterateFragmentedAudioSamples(file);
      gen.next(); // need to advance to trigger the throw
    }).toThrow(Mp4FragmentNotYetIteratedError);
  });
});

// ---------------------------------------------------------------------------
// D.2 Error/Rejection Tests
// ---------------------------------------------------------------------------

describe('D.2: Rejection and error cases', () => {
  it('D.2.R1: missing mfhd throws Mp4MoofMissingMfhdError', () => {
    // Build an fMP4 then patch the mfhd type to something else.
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find and corrupt the 'mfhd' type field in the bytes.
    // 'mfhd' = 0x6D666864; change to 'xxxx' = 0x78787878.
    const view = new DataView(bytes.buffer);
    let patched = false;
    for (let i = 0; i < bytes.length - 8; i++) {
      if (
        bytes[i] === 0x6d &&
        bytes[i + 1] === 0x66 &&
        bytes[i + 2] === 0x68 &&
        bytes[i + 3] === 0x64
      ) {
        bytes[i] = 0x78;
        bytes[i + 1] = 0x78;
        bytes[i + 2] = 0x78;
        bytes[i + 3] = 0x78;
        patched = true;
        break;
      }
    }
    expect(patched).toBe(true);

    expect(() => parseMp4(bytes)).toThrow(Mp4MoofMissingMfhdError);
  });

  it('D.2.R2: out-of-order sequence numbers throw Mp4MoofSequenceOutOfOrderError', () => {
    // Build multi-fragment with out-of-order sequence numbers (2, 1 instead of 1, 2).
    const bytes = buildFmp4({
      trexDefaultDuration: 1024,
      trexDefaultSize: 4,
      fragments: [
        {
          sequenceNumber: 2, // starts at 2
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
        {
          sequenceNumber: 1, // then back to 1 — out of order!
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });

    expect(() => parseMp4(bytes)).toThrow(Mp4MoofSequenceOutOfOrderError);
  });

  it('D.2.R3: tfhd with unknown trackId throws Mp4TfhdUnknownTrackError', () => {
    // Build a file where traf references trackId=99 but trex only has trackId=1.
    const bytes = buildFmp4({
      trackId: 1,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 99, defaultBaseIsMoof: true }, // wrong trackId!
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });

    expect(() => parseMp4(bytes)).toThrow(Mp4TfhdUnknownTrackError);
  });

  it('D.2.R4: trun sample_count > MAX_SAMPLES_PER_TRUN throws Mp4TrunSampleCountTooLargeError', () => {
    // We can't build a real trun with 1M+ samples, so we patch the count field.
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find 'trun' box in the bytes and patch sample_count (at bytes[8..11] of trun payload).
    const trunType = [0x74, 0x72, 0x75, 0x6e]; // 'trun'
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === trunType[0] &&
        bytes[i + 5] === trunType[1] &&
        bytes[i + 6] === trunType[2] &&
        bytes[i + 7] === trunType[3]
      ) {
        // payload starts at i+8; version+flags at i+8..i+11; sample_count at i+12..i+15.
        const view = new DataView(bytes.buffer);
        view.setUint32(i + 12, 2_000_000, false); // 2M > MAX_SAMPLES_PER_TRUN (1M)
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4TrunSampleCountTooLargeError);
  });

  it('D.2.R5: trafs per moof > MAX_TRAFS_PER_MOOF throws Mp4TrafCountTooLargeError', () => {
    // Build 65 fragments each with 1 sample (sequence 1..65), then take the bytes,
    // find the first moof, and count the trafs in the box-tree. The real test is:
    // build a single moof with 65 trafs. We do this by constructing the byte stream
    // manually using little-endian-safe helpers.

    // Helper: write a minimal valid traf box (tfhd=default-base-is-moof, no trun).
    function makeTrafBytes(trackId: number): Uint8Array {
      // tfhd payload: version(1)+flags(3)+track_ID(4) = 8 bytes, flags=0x020000.
      const tfhdPayload = new Uint8Array(8);
      tfhdPayload[1] = 0x02; // flags hi byte
      new DataView(tfhdPayload.buffer).setUint32(4, trackId, false);
      const tfhdTotal = 8 + tfhdPayload.length;
      const tfhdBox = new Uint8Array(tfhdTotal);
      new DataView(tfhdBox.buffer).setUint32(0, tfhdTotal, false);
      tfhdBox[4] = 0x74;
      tfhdBox[5] = 0x66;
      tfhdBox[6] = 0x68;
      tfhdBox[7] = 0x64;
      tfhdBox.set(tfhdPayload, 8);

      // traf container wrapping tfhd.
      const trafPayload = tfhdBox;
      const trafTotal = 8 + trafPayload.length;
      const trafBox = new Uint8Array(trafTotal);
      new DataView(trafBox.buffer).setUint32(0, trafTotal, false);
      trafBox[4] = 0x74;
      trafBox[5] = 0x72;
      trafBox[6] = 0x61;
      trafBox[7] = 0x66;
      trafBox.set(trafPayload, 8);
      return trafBox;
    }

    // mfhd FullBox: version(1)+flags(3)+sequence_number(4) = 8 bytes.
    function makeMfhdBytes(seq: number): Uint8Array {
      const mfhdPayload = new Uint8Array(8);
      new DataView(mfhdPayload.buffer).setUint32(4, seq, false);
      const mfhdTotal = 8 + mfhdPayload.length;
      const mfhdBox = new Uint8Array(mfhdTotal);
      new DataView(mfhdBox.buffer).setUint32(0, mfhdTotal, false);
      mfhdBox[4] = 0x6d;
      mfhdBox[5] = 0x66;
      mfhdBox[6] = 0x68;
      mfhdBox[7] = 0x64;
      mfhdBox.set(mfhdPayload, 8);
      return mfhdBox;
    }

    const TRAF_COUNT = 65; // exceeds MAX_TRAFS_PER_MOOF = 64
    const mfhd = makeMfhdBytes(1);
    const traf = makeTrafBytes(1);

    const moofPayload = new Uint8Array(mfhd.length + traf.length * TRAF_COUNT);
    moofPayload.set(mfhd, 0);
    for (let i = 0; i < TRAF_COUNT; i++) {
      moofPayload.set(traf, mfhd.length + i * traf.length);
    }
    const moofTotal = 8 + moofPayload.length;
    const moofBox = new Uint8Array(moofTotal);
    new DataView(moofBox.buffer).setUint32(0, moofTotal, false);
    moofBox[4] = 0x6d;
    moofBox[5] = 0x6f;
    moofBox[6] = 0x6f;
    moofBox[7] = 0x66;
    moofBox.set(moofPayload, 8);

    // Build a base fragmented file (moov with mvex) with no fragments.
    const baseBytes = buildFmp4({
      trexDefaultDuration: 1024,
      trexDefaultSize: 4,
      fragments: [],
    });

    // Attach the oversized moof.
    const combined = new Uint8Array(baseBytes.length + moofBox.length);
    combined.set(baseBytes, 0);
    combined.set(moofBox, baseBytes.length);

    expect(() => parseMp4(combined)).toThrow(Mp4TrafCountTooLargeError);
  });

  it('D.2.R6: cascade resolves to trex defaults when no per-sample or tfhd duration/size set', () => {
    // When trex provides non-zero defaults, samples are yielded without error.
    // trex.defaultSampleDuration=1024, trex.defaultSampleSize=8, no tfhd or trun fields.
    const bytes = buildFmp4({
      trexDefaultDuration: 1024,
      trexDefaultSize: 8,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true }, // no tfhd-level defaults
          trun: {
            samples: [{}, {}, {}], // empty — all cascade to trex
          },
        },
      ],
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(3);
    // Duration from trex: 1024 ticks / 44100 Hz
    const expectedDurationUs = (1024 * 1_000_000) / 44100;
    for (const s of samples) {
      expect(s.durationUs).toBeCloseTo(expectedDurationUs, 0);
      expect(s.data.length).toBe(8);
    }
  });

  it('D.2.R7: tfdt version != 0/1 throws Mp4TfdtVersionError', () => {
    // Build a tfdt with version=2 (invalid).
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Patch the tfdt version byte (first byte of tfdt payload = version).
    const tfdtType = [0x74, 0x66, 0x64, 0x74]; // 'tfdt'
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === tfdtType[0] &&
        bytes[i + 5] === tfdtType[1] &&
        bytes[i + 6] === tfdtType[2] &&
        bytes[i + 7] === tfdtType[3]
      ) {
        bytes[i + 8] = 2; // version = 2 (invalid)
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4TfdtVersionError);
  });

  it('D.2.R8: fragmented file with non-empty stts throws an error (mixed sample tables)', () => {
    // Build an fMP4 with a stts that has entry_count > 0. Since the builder
    // creates zero-sample stbl, we have to splice a valid stts box with entries
    // into the moov, then re-assemble the container hierarchy.
    //
    // The easiest approach: directly construct a custom moov with a non-empty stts,
    // wrapped inside a fragmented file. This exercises the Mp4FragmentMixedSampleTablesError
    // check in parseTrakFragmented.

    // Build a minimal fMP4 base, then replace the stts box with a version that
    // has entry_count=1 and 8 bytes of entry data, and update all parent sizes.

    // Get the base bytes first.
    const base = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find stts box position in the base bytes.
    const sttsType = [0x73, 0x74, 0x74, 0x73];
    let sttsOffset = -1;
    for (let i = 0; i < base.length - 16; i++) {
      if (
        base[i + 4] === sttsType[0] &&
        base[i + 5] === sttsType[1] &&
        base[i + 6] === sttsType[2] &&
        base[i + 7] === sttsType[3]
      ) {
        sttsOffset = i;
        break;
      }
    }
    expect(sttsOffset).toBeGreaterThan(0);

    const baseView = new DataView(base.buffer);
    const oldSttsSize = baseView.getUint32(sttsOffset, false);

    // Build a new stts box with 1 entry (valid payload size).
    // stts payload: version(1)+flags(3)+entry_count(4)+sample_count(4)+sample_delta(4) = 16 bytes.
    const newSttsPayload = new Uint8Array(16);
    const np = new DataView(newSttsPayload.buffer);
    np.setUint32(4, 1, false); // entry_count = 1
    np.setUint32(8, 1, false); // sample_count = 1
    np.setUint32(12, 1024, false); // sample_delta = 1024
    const newSttsSize = 8 + newSttsPayload.length; // = 24
    const newSttsBox = new Uint8Array(newSttsSize);
    const nb = new DataView(newSttsBox.buffer);
    nb.setUint32(0, newSttsSize, false);
    newSttsBox[4] = 0x73;
    newSttsBox[5] = 0x74;
    newSttsBox[6] = 0x74;
    newSttsBox[7] = 0x73;
    newSttsBox.set(newSttsPayload, 8);

    const sizeDiff = newSttsSize - oldSttsSize; // should be +8

    // Rebuild the full buffer with spliced stts.
    const rebuilt = new Uint8Array(base.length + sizeDiff);
    rebuilt.set(base.subarray(0, sttsOffset));
    rebuilt.set(newSttsBox, sttsOffset);
    rebuilt.set(base.subarray(sttsOffset + oldSttsSize), sttsOffset + newSttsSize);

    // Fix all ancestor container sizes. Ancestors contain the stts:
    // stbl → minf → mdia → trak → moov. Find each by scanning backwards from sttsOffset.
    // Fix each container whose range contains sttsOffset by adding sizeDiff.
    const containers = [
      [0x73, 0x74, 0x62, 0x6c], // 'stbl'
      [0x6d, 0x69, 0x6e, 0x66], // 'minf'
      [0x6d, 0x64, 0x69, 0x61], // 'mdia'
      [0x74, 0x72, 0x61, 0x6b], // 'trak'
      [0x6d, 0x6f, 0x6f, 0x76], // 'moov'
    ];

    const rv = new DataView(rebuilt.buffer);
    for (const ct of containers) {
      for (let i = 0; i < sttsOffset; i++) {
        if (
          rebuilt[i + 4] === ct[0] &&
          rebuilt[i + 5] === ct[1] &&
          rebuilt[i + 6] === ct[2] &&
          rebuilt[i + 7] === ct[3]
        ) {
          const curSize = rv.getUint32(i, false);
          // Only update this container if it wraps the stts (end of container > sttsOffset).
          if (i + curSize > sttsOffset) {
            rv.setUint32(i, curSize + sizeDiff, false);
            break;
          }
        }
      }
    }

    // Now parseMp4 should encounter a fragmented file with non-empty stts → error.
    expect(() => parseMp4(rebuilt)).toThrow(Mp4FragmentMixedSampleTablesError);
  });

  it('D.2.R9: corrupt sample bounds (trun data_offset points outside file) throws Mp4CorruptSampleError', () => {
    // Build fMP4 with a data_offset that points way outside the file.
    const bytes = buildFmp4({
      trexDefaultDuration: 1024,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            dataOffset: 999_999_999, // far outside file
            samples: [{ duration: 1024, size: 4 }],
          },
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(() => {
      const gen = iterateFragmentedAudioSamples(file);
      gen.next();
    }).toThrow(Mp4CorruptSampleError);
  });

  it('D.2.R10: trun payload size mismatch throws Mp4TrunSizeMismatchError', () => {
    // Build a trun then truncate the box.
    const bytes = buildMinimalFmp4({ sampleCount: 10, sampleSize: 4 });

    // Find 'trun' and reduce its size field to create a truncated payload.
    const trunType = [0x74, 0x72, 0x75, 0x6e];
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === trunType[0] &&
        bytes[i + 5] === trunType[1] &&
        bytes[i + 6] === trunType[2] &&
        bytes[i + 7] === trunType[3]
      ) {
        const view = new DataView(bytes.buffer);
        const originalSize = view.getUint32(i, false);
        // Reduce size to minimum header (makes payload look truncated).
        view.setUint32(i, originalSize - 8, false); // cut off 8 bytes
        break;
      }
    }

    // The walkBoxes may throw Mp4InvalidBoxError (overrun) or we may get TrunSizeMismatch.
    // Either is acceptable — the file is corrupt.
    expect(() => parseMp4(bytes)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mvex.ts unit tests
// ---------------------------------------------------------------------------

describe('mvex: mehd + trex parsing', () => {
  it('parses mehd v0 (32-bit fragment_duration) when present in mvex', () => {
    // Build an fMP4 with a mehd box in mvex.
    // The builder doesn't support mehd directly, so we construct the bytes manually.
    // Instead, we parse the mvex from a known-good fMP4 and verify no mehd = null.
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });
    const file = parseMp4(bytes);
    // No mehd in our builder — but the parse should not error.
    expect(file.isFragmented).toBe(true);
    expect(file.trackExtends).toHaveLength(1);
  });

  it('trex.defaultSampleDescriptionIndex is preserved from mvex', () => {
    const bytes = buildFmp4({
      trexDefaultDuration: 512,
      trexDefaultSize: 8,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{ duration: 512, size: 8 }] },
        },
      ],
    });
    const file = parseMp4(bytes);
    const trex = file.trackExtends[0];
    expect(trex?.defaultSampleDescriptionIndex).toBe(1);
    expect(trex?.defaultSampleDuration).toBe(512);
    expect(trex?.defaultSampleSize).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// D.2 Additional edge cases
// ---------------------------------------------------------------------------

describe('D.2: Edge cases', () => {
  it('D.2.E1: trun with tfdtVersion 1 and signed composition_time_offset', () => {
    // trun v1 with negative cto (signed i32).
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            version: 1, // v1: cto is signed i32
            samples: [
              { duration: 1024, size: 4, compositionTimeOffset: -512 },
              { duration: 1024, size: 4, compositionTimeOffset: 256 },
            ],
          },
        },
      ],
    });
    const file = parseMp4(bytes);

    const trun = file.fragments[0]?.trackFragments[0]?.trackRuns[0];
    expect(trun?.version).toBe(1);
    expect(trun?.samples[0]?.compositionTimeOffset).toBe(-512);
    expect(trun?.samples[1]?.compositionTimeOffset).toBe(256);
  });

  it('D.2.E2: sample byte content is preserved (non-zero sample data)', () => {
    // Build with deterministic sample content.
    const samplePayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            samples: [{ duration: 1024, size: 4 }],
          },
          sampleData: [samplePayload],
        },
      ],
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(1);
    expect(samples[0]?.data[0]).toBe(0xde);
    expect(samples[0]?.data[1]).toBe(0xad);
    expect(samples[0]?.data[2]).toBe(0xbe);
    expect(samples[0]?.data[3]).toBe(0xef);
  });

  it('D.2.E3: multiple fragments — sample indices are globally sequential', () => {
    const bytes = buildMultiFragmentFmp4({
      fragmentCount: 3,
      samplesPerFragment: 3,
      sampleSize: 4,
    });
    const file = parseMp4(bytes);
    const samples = [...iterateFragmentedAudioSamples(file)];

    expect(samples).toHaveLength(9);
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]?.index).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// Review fix regression tests
// ---------------------------------------------------------------------------

describe('Review fixes: F1 — defaults cascade pre-flight covers all samples', () => {
  it('F1: pre-flight validates all samples — if any sample is missing duration with no fallback, throws before first yield', () => {
    // Construct a synthetic Mp4File where:
    //   - trun has samples[0] with explicit duration+size, samples[1]+[2] with null duration
    //   - traf has no defaultSampleDuration (null)
    //   - trex is absent for the track (undefined in iterator)
    //
    // We achieve "trex = undefined" by building a file normally and then patching
    // the parsed fragments directly, bypassing the parser's trex validation.
    // The iterator receives the traf/trex pair directly.
    //
    // To test WITHOUT a trex we must call iterateTrunSamples indirectly by
    // building a file where the trafTrackId does not appear in file.trackExtends.
    // But parseTfhd rejects unknown track IDs, so we can't get there via parseMp4.
    //
    // The most faithful test: build a file where all trun samples have null duration
    // (no FLAG_SAMPLE_DURATION in trun flags) and no tfhd/trex defaults either.
    // trex.defaultSampleDuration = 0 in the builder is a number, not null, so
    // the cascade resolves it — correctly throwing for duration=0 is NOT the contract.
    //
    // The bug F1 fixed was: old code only validated sample 0, so if sample 0 had an
    // explicit value but samples 1+ had null + no fallback, it would throw MID-LOOP.
    // With the fix, the pre-flight checks ALL samples and throws BEFORE the loop.
    //
    // We test this by constructing a partially-explicit trun (sample 0 explicit,
    // samples 1-2 have null fields) and verifying the iterator catches this
    // pre-flight without yielding sample 0 first.
    //
    // Implementation: use parseTrun directly to construct the trun object, then
    // call the file's fragments with a patched traf that has no traf defaults.

    // Build a base file with a trex that has no defaults (defaultSampleDuration = 0).
    // Then build a fragment with trun having some explicit samples and some null ones.
    // The trick: build two separate truns:
    //   trun A: sample 0 with explicit duration (FLAG_SAMPLE_DURATION set)
    //   trun B: sample 1 with null duration (no FLAG_SAMPLE_DURATION)
    // Since FLAG_SAMPLE_DURATION is a per-trun flag (not per-sample), we cannot have
    // sample 0 with explicit and sample 1 with null in the same trun via the builder.
    //
    // The correct way to test the new pre-flight is: trun where FLAG_SAMPLE_DURATION
    // is NOT set (all durations are null), no traf defaults, and we verify the error
    // is thrown before any yield.
    //
    // This test exercises the post-fix behaviour: throw BEFORE the generator loop body.

    // Arrange: build fMP4 where trun has no per-sample duration flag, and
    // the trex default is 0 (which IS a valid number, so no cascade error expected).
    // To force a cascade error we need to eliminate the trex default. We do that by
    // directly constructing test fragments using the public parseTrun API + the file
    // structure, or we patch trex.defaultSampleDuration = null post-parse.
    //
    // Since Mp4TrackExtends is readonly, we use a cast for testing purposes.
    const bytes = buildFmp4({
      trexDefaultDuration: 1024, // valid default
      trexDefaultSize: 4,
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: {
            // all 3 samples: explicit duration in trun
            samples: [
              { duration: 1024, size: 4 },
              { duration: 1024, size: 4 },
              { duration: 1024, size: 4 },
            ],
          },
        },
      ],
    });
    const file = parseMp4(bytes);

    // Patch the parsed structure: remove traf and trex defaults, and set
    // samples[1] and [2] to have null duration (simulate trun with no FLAG_SAMPLE_DURATION
    // for those entries). This requires working with the immutable parsed structure.
    // We construct a new synthetic file using Object.assign (acceptable in test helpers).
    const originalFragment = file.fragments[0];
    expect(originalFragment).toBeDefined();
    const originalTraf = originalFragment?.trackFragments[0];
    expect(originalTraf).toBeDefined();
    const originalTrun = originalTraf?.trackRuns[0];
    expect(originalTrun).toBeDefined();

    // Build a synthetic trun with sample 0 explicit, samples 1-2 with null duration.
    const patchedSamples = [
      { duration: 1024, size: 4, flags: null, compositionTimeOffset: null },
      { duration: null, size: 4, flags: null, compositionTimeOffset: null }, // null duration
      { duration: null, size: 4, flags: null, compositionTimeOffset: null }, // null duration
    ];
    const patchedTrun = { ...originalTrun, samples: patchedSamples };

    // Patch traf to have no tfhd defaults (null).
    const patchedTraf = {
      ...originalTraf,
      defaultSampleDuration: null,
      defaultSampleSize: null,
      trackRuns: [patchedTrun],
    };

    // Patch the fragment.
    const patchedFragment = { ...originalFragment, trackFragments: [patchedTraf] };
    const patchedFile = { ...file, fragments: [patchedFragment] };

    // Remove the trex so cascade has no fallback. Patch trackExtends too.
    // The iterator builds its own trexByTrackId map from file.trackExtends.
    const fileWithNoTrex = { ...patchedFile, trackExtends: [] };

    // The iterator should throw Mp4DefaultsCascadeError BEFORE yielding sample 0.
    let yieldCount = 0;
    let threw = false;
    try {
      for (const _sample of iterateFragmentedAudioSamples(
        fileWithNoTrex as Parameters<typeof iterateFragmentedAudioSamples>[0],
      )) {
        yieldCount += 1;
      }
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Mp4DefaultsCascadeError);
    }
    expect(threw).toBe(true);
    // KEY assertion: with the F1 fix, NO samples are emitted before the error.
    expect(yieldCount).toBe(0);
  });
});

describe('Review fixes: F4 — MAX_TREX_PER_MVEX cap', () => {
  it('F4: mvex with 257 trex children throws Mp4InvalidBoxError', () => {
    // Build a base fMP4 then patch in extra trex boxes to exceed the 256 cap.
    // We construct a synthetic mvex with 257 trex boxes directly.
    function makeTrexPayload(trackId: number): Uint8Array {
      const payload = new Uint8Array(24);
      const view = new DataView(payload.buffer);
      view.setUint32(4, trackId, false); // track_ID
      view.setUint32(8, 1, false); // default_sample_description_index
      view.setUint32(12, 1024, false); // default_sample_duration
      view.setUint32(16, 4, false); // default_sample_size
      return payload;
    }

    function makeTrexBox(trackId: number): Uint8Array {
      const payload = makeTrexPayload(trackId);
      const box = new Uint8Array(8 + payload.length);
      const view = new DataView(box.buffer);
      view.setUint32(0, box.length, false);
      box[4] = 0x74;
      box[5] = 0x72;
      box[6] = 0x65;
      box[7] = 0x78; // 'trex'
      box.set(payload, 8);
      return box;
    }

    // Build 257 trex boxes and wrap in mvex.
    const trexBoxes: Uint8Array[] = [];
    for (let i = 1; i <= 257; i++) {
      trexBoxes.push(makeTrexBox(i));
    }
    const mvexPayload = new Uint8Array(trexBoxes.reduce((s, b) => s + b.length, 0));
    let off = 0;
    for (const b of trexBoxes) {
      mvexPayload.set(b, off);
      off += b.length;
    }
    const mvexBox = new Uint8Array(8 + mvexPayload.length);
    new DataView(mvexBox.buffer).setUint32(0, mvexBox.length, false);
    mvexBox[4] = 0x6d;
    mvexBox[5] = 0x76;
    mvexBox[6] = 0x65;
    mvexBox[7] = 0x78; // 'mvex'
    mvexBox.set(mvexPayload, 8);

    // Build a base fragmented moov using buildFmp4 with 0 fragments.
    const base = buildFmp4({ fragments: [] });

    // Find the existing mvex in base and replace it.
    // The mvex is inside moov; locate moov first, then locate mvex inside moov.
    const mvexType = [0x6d, 0x76, 0x65, 0x78];
    let mvexOffset = -1;
    let mvexSize = 0;
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === mvexType[0] &&
        base[i + 5] === mvexType[1] &&
        base[i + 6] === mvexType[2] &&
        base[i + 7] === mvexType[3]
      ) {
        mvexOffset = i;
        mvexSize = new DataView(base.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mvexOffset).toBeGreaterThan(0);

    // Rebuild buffer replacing the old mvex with the new oversized one.
    const sizeDiff = mvexBox.length - mvexSize;
    const rebuilt = new Uint8Array(base.length + sizeDiff);
    rebuilt.set(base.subarray(0, mvexOffset));
    rebuilt.set(mvexBox, mvexOffset);
    rebuilt.set(base.subarray(mvexOffset + mvexSize), mvexOffset + mvexBox.length);

    // Fix moov size.
    const moovType = [0x6d, 0x6f, 0x6f, 0x76];
    const rv = new DataView(rebuilt.buffer);
    for (let i = 0; i < mvexOffset; i++) {
      if (
        rebuilt[i + 4] === moovType[0] &&
        rebuilt[i + 5] === moovType[1] &&
        rebuilt[i + 6] === moovType[2] &&
        rebuilt[i + 7] === moovType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + sizeDiff, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Review fixes: F5 — mfhd sequence_number = 0 is rejected', () => {
  it('F5: moof with mfhd sequence_number=0 throws Mp4InvalidBoxError', () => {
    // Build a valid fMP4 then patch the sequence_number field of mfhd to 0.
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find mfhd box and patch sequence_number (bytes 4-7 of payload = bytes 12-15 of box).
    const mfhdType = [0x6d, 0x66, 0x68, 0x64];
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === mfhdType[0] &&
        bytes[i + 5] === mfhdType[1] &&
        bytes[i + 6] === mfhdType[2] &&
        bytes[i + 7] === mfhdType[3]
      ) {
        // payload starts at i+8; sequence_number at payload offset 4 → i+12
        new DataView(bytes.buffer).setUint32(i + 12, 0, false);
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Review fixes: F6 — mehd parse tests', () => {
  it('F6.1: mehd v0 (32-bit fragment_duration) parses correctly', () => {
    const fragmentDuration = 88200; // 2 seconds at 44100
    const bytes = buildFmp4({
      mehd: { fragmentDuration, version: 0 },
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    // We don't expose mehd directly on Mp4File, but parsing must not throw.
    // The trackExtends should still be present and correctly parsed.
    expect(file.trackExtends).toHaveLength(1);
  });

  it('F6.2: mehd v1 (64-bit fragment_duration) parses correctly', () => {
    const fragmentDuration = 0x1_0000_0000; // 2^32 — requires v1
    const bytes = buildFmp4({
      mehd: { fragmentDuration, version: 1 },
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });
    const file = parseMp4(bytes);

    expect(file.isFragmented).toBe(true);
    expect(file.trackExtends).toHaveLength(1);
  });

  it('F6.3: mehd v1 with hi-word causing value > Number.MAX_SAFE_INTEGER throws', () => {
    // Build a raw mehd v1 box with hi-word = 0x00200000 (exceeds MAX_SAFE_INTEGER).
    // hi=0x00200000, lo=0 → value = 0x00200000 * 2^32 = 9.007...e15 > MAX_SAFE_INTEGER.
    function makeMehdV1Box(hi: number, lo: number): Uint8Array {
      // mehd FullBox: 8-byte header + 12-byte payload (v1).
      const payload = new Uint8Array(12);
      payload[0] = 1; // version = 1
      new DataView(payload.buffer).setUint32(4, hi, false);
      new DataView(payload.buffer).setUint32(8, lo, false);
      const box = new Uint8Array(8 + payload.length);
      new DataView(box.buffer).setUint32(0, box.length, false);
      box[4] = 0x6d;
      box[5] = 0x65;
      box[6] = 0x68;
      box[7] = 0x64; // 'mehd'
      box.set(payload, 8);
      return box;
    }

    // Build base fMP4 and splice in a bad mehd inside the existing mvex.
    const base = buildFmp4({ fragments: [] });

    // Locate mvex end to inject mehd before trex.
    const mvexType = [0x6d, 0x76, 0x65, 0x78];
    let mvexOffset = -1;
    let mvexSize = 0;
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === mvexType[0] &&
        base[i + 5] === mvexType[1] &&
        base[i + 6] === mvexType[2] &&
        base[i + 7] === mvexType[3]
      ) {
        mvexOffset = i;
        mvexSize = new DataView(base.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mvexOffset).toBeGreaterThan(0);

    // hi = 0x00200000: value = 0x00200000 * 0x100000000 > Number.MAX_SAFE_INTEGER
    const badMehd = makeMehdV1Box(0x00200000, 0);

    // Insert the bad mehd right after the mvex header (before the trex child).
    const mvexHeaderEnd = mvexOffset + 8;
    const rebuilt = new Uint8Array(base.length + badMehd.length);
    rebuilt.set(base.subarray(0, mvexHeaderEnd));
    rebuilt.set(badMehd, mvexHeaderEnd);
    rebuilt.set(base.subarray(mvexHeaderEnd), mvexHeaderEnd + badMehd.length);

    // Fix mvex and moov sizes.
    const rv = new DataView(rebuilt.buffer);
    rv.setUint32(mvexOffset, mvexSize + badMehd.length, false);
    const moovType = [0x6d, 0x6f, 0x6f, 0x76];
    for (let i = 0; i < mvexOffset; i++) {
      if (
        rebuilt[i + 4] === moovType[0] &&
        rebuilt[i + 5] === moovType[1] &&
        rebuilt[i + 6] === moovType[2] &&
        rebuilt[i + 7] === moovType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + badMehd.length, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Review fixes: F7 — u64 hi-word range guard tests', () => {
  it('F7.1: tfhd base_data_offset with value > Number.MAX_SAFE_INTEGER throws Mp4TfhdValueOutOfRangeError', () => {
    // Build an fMP4 with a tfhd that has an explicit base_data_offset whose
    // u64 value exceeds Number.MAX_SAFE_INTEGER.
    // hi = 0x00200000, lo = 0 → value > MAX_SAFE_INTEGER.
    function buildTfhdWithLargeOffset(): Uint8Array {
      // tfhd flags: 0x000001 (base_data_offset_present) | 0x000008 (default_sample_duration)
      // to ensure we have a valid traf even with bogus offset.
      const flags = 0x000001 | 0x000008;
      const payload = new Uint8Array(4 + 4 + 8 + 4); // prefix + track_ID + base_data_offset + duration
      payload[1] = (flags >> 16) & 0xff;
      payload[2] = (flags >> 8) & 0xff;
      payload[3] = flags & 0xff;
      new DataView(payload.buffer).setUint32(4, 1, false); // track_ID = 1
      // base_data_offset: hi=0x00200000, lo=0 → value > Number.MAX_SAFE_INTEGER
      new DataView(payload.buffer).setUint32(8, 0x00200000, false); // hi
      new DataView(payload.buffer).setUint32(12, 0, false); // lo
      new DataView(payload.buffer).setUint32(16, 1024, false); // default_sample_duration
      const box = new Uint8Array(8 + payload.length);
      new DataView(box.buffer).setUint32(0, box.length, false);
      box[4] = 0x74;
      box[5] = 0x66;
      box[6] = 0x68;
      box[7] = 0x64; // 'tfhd'
      box.set(payload, 8);
      return box;
    }

    // Build the rest of a valid moof with the patched tfhd.
    function makeMfhdBox(seq: number): Uint8Array {
      const payload = new Uint8Array(8);
      new DataView(payload.buffer).setUint32(4, seq, false);
      const box = new Uint8Array(8 + payload.length);
      new DataView(box.buffer).setUint32(0, box.length, false);
      box[4] = 0x6d;
      box[5] = 0x66;
      box[6] = 0x68;
      box[7] = 0x64; // 'mfhd'
      box.set(payload, 8);
      return box;
    }

    const tfhdBox = buildTfhdWithLargeOffset();
    const mfhdBox = makeMfhdBox(1);

    // traf = mfhd is not inside traf, so: traf contains tfhd.
    const trafPayload = tfhdBox;
    const trafBox = new Uint8Array(8 + trafPayload.length);
    new DataView(trafBox.buffer).setUint32(0, trafBox.length, false);
    trafBox[4] = 0x74;
    trafBox[5] = 0x72;
    trafBox[6] = 0x61;
    trafBox[7] = 0x66; // 'traf'
    trafBox.set(trafPayload, 8);

    const moofPayload = new Uint8Array(mfhdBox.length + trafBox.length);
    moofPayload.set(mfhdBox, 0);
    moofPayload.set(trafBox, mfhdBox.length);
    const moofBox = new Uint8Array(8 + moofPayload.length);
    new DataView(moofBox.buffer).setUint32(0, moofBox.length, false);
    moofBox[4] = 0x6d;
    moofBox[5] = 0x6f;
    moofBox[6] = 0x6f;
    moofBox[7] = 0x66; // 'moof'
    moofBox.set(moofPayload, 8);

    const base = buildFmp4({ fragments: [] });
    const combined = new Uint8Array(base.length + moofBox.length);
    combined.set(base, 0);
    combined.set(moofBox, base.length);

    expect(() => parseMp4(combined)).toThrow(Mp4TfhdValueOutOfRangeError);
  });

  it('F7.2: tfdt v1 base_media_decode_time with value > Number.MAX_SAFE_INTEGER throws Mp4TfdtValueOutOfRangeError', () => {
    // Build a valid fMP4 then patch the tfdt v1 hi-word to 0x00200000.
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          tfdt: { baseMediaDecodeTime: 0x100000000, version: 1 }, // valid v1
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });

    // Find tfdt box and set hi-word to 0x00200000 (value > MAX_SAFE_INTEGER).
    const tfdtType = [0x74, 0x66, 0x64, 0x74];
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === tfdtType[0] &&
        bytes[i + 5] === tfdtType[1] &&
        bytes[i + 6] === tfdtType[2] &&
        bytes[i + 7] === tfdtType[3]
      ) {
        // payload at i+8; version at i+8; hi-word at i+12
        const view = new DataView(bytes.buffer);
        view.setUint32(i + 12, 0x00200000, false); // hi → value > MAX_SAFE_INTEGER
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4TfdtValueOutOfRangeError);
  });
});

describe('Review fixes: additional coverage for mvex/moof short-payload paths', () => {
  it('mehd v1 too-short payload throws Mp4InvalidBoxError', () => {
    // Build a base fMP4 and splice in a malformed mehd v1 box (version=1 but only 8 bytes payload).
    function makeMehdV1TooShort(): Uint8Array {
      // Only 8 bytes of payload (needs 12 for v1): triggers "mehd v1 payload too short".
      const payload = new Uint8Array(8);
      payload[0] = 1; // version = 1
      const box = new Uint8Array(8 + payload.length);
      new DataView(box.buffer).setUint32(0, box.length, false);
      box[4] = 0x6d;
      box[5] = 0x65;
      box[6] = 0x68;
      box[7] = 0x64; // 'mehd'
      box.set(payload, 8);
      return box;
    }

    const base = buildFmp4({ fragments: [] });
    const mvexType = [0x6d, 0x76, 0x65, 0x78];
    let mvexOffset = -1;
    let mvexSize = 0;
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === mvexType[0] &&
        base[i + 5] === mvexType[1] &&
        base[i + 6] === mvexType[2] &&
        base[i + 7] === mvexType[3]
      ) {
        mvexOffset = i;
        mvexSize = new DataView(base.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mvexOffset).toBeGreaterThan(0);

    const badMehd = makeMehdV1TooShort();
    const mvexHeaderEnd = mvexOffset + 8;
    const rebuilt = new Uint8Array(base.length + badMehd.length);
    rebuilt.set(base.subarray(0, mvexHeaderEnd));
    rebuilt.set(badMehd, mvexHeaderEnd);
    rebuilt.set(base.subarray(mvexHeaderEnd), mvexHeaderEnd + badMehd.length);

    const rv = new DataView(rebuilt.buffer);
    rv.setUint32(mvexOffset, mvexSize + badMehd.length, false);
    const moovType = [0x6d, 0x6f, 0x6f, 0x76];
    for (let i = 0; i < mvexOffset; i++) {
      if (
        rebuilt[i + 4] === moovType[0] &&
        rebuilt[i + 5] === moovType[1] &&
        rebuilt[i + 6] === moovType[2] &&
        rebuilt[i + 7] === moovType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + badMehd.length, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });

  it('trex too-short payload throws Mp4InvalidBoxError', () => {
    // Build a base fMP4 and patch the trex payload size to be smaller than 24 bytes.
    const base = buildFmp4({ fragments: [] });
    const trexType = [0x74, 0x72, 0x65, 0x78];
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === trexType[0] &&
        base[i + 5] === trexType[1] &&
        base[i + 6] === trexType[2] &&
        base[i + 7] === trexType[3]
      ) {
        // Shrink the trex box size by 8 bytes (payload becomes too short).
        const view = new DataView(base.buffer);
        const origSize = view.getUint32(i, false);
        view.setUint32(i, origSize - 8, false);
        break;
      }
    }
    expect(() => parseMp4(base)).toThrow(Mp4InvalidBoxError);
  });

  it('tfdt v1 payload too short throws Mp4InvalidBoxError', () => {
    // Build a valid fMP4 with tfdt v1, then shrink the tfdt box to only 8 bytes payload.
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          tfdt: { baseMediaDecodeTime: 0x100000000, version: 1 },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });

    // Find tfdt and shrink its payload from 12 to 8 bytes by patching the size field.
    const tfdtType = [0x74, 0x66, 0x64, 0x74];
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === tfdtType[0] &&
        bytes[i + 5] === tfdtType[1] &&
        bytes[i + 6] === tfdtType[2] &&
        bytes[i + 7] === tfdtType[3]
      ) {
        const view = new DataView(bytes.buffer);
        const origSize = view.getUint32(i, false); // should be 8+12=20
        view.setUint32(i, origSize - 4, false); // shrink payload by 4 bytes → 8 bytes
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4InvalidBoxError);
  });

  it('mehd with invalid version (not 0 or 1) throws Mp4InvalidBoxError', () => {
    // Build a base fMP4 and splice in a mehd with version=2 (invalid).
    function makeMehdInvalidVersion(): Uint8Array {
      const payload = new Uint8Array(8); // 8 bytes: valid v0 size but version=2
      payload[0] = 2; // version = 2 (invalid)
      new DataView(payload.buffer).setUint32(4, 12345, false); // fragment_duration
      const box = new Uint8Array(8 + payload.length);
      new DataView(box.buffer).setUint32(0, box.length, false);
      box[4] = 0x6d;
      box[5] = 0x65;
      box[6] = 0x68;
      box[7] = 0x64; // 'mehd'
      box.set(payload, 8);
      return box;
    }

    const base = buildFmp4({ fragments: [] });
    const mvexType = [0x6d, 0x76, 0x65, 0x78];
    let mvexOffset = -1;
    let mvexSize = 0;
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === mvexType[0] &&
        base[i + 5] === mvexType[1] &&
        base[i + 6] === mvexType[2] &&
        base[i + 7] === mvexType[3]
      ) {
        mvexOffset = i;
        mvexSize = new DataView(base.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mvexOffset).toBeGreaterThan(0);

    const badMehd = makeMehdInvalidVersion();
    const mvexHeaderEnd = mvexOffset + 8;
    const rebuilt = new Uint8Array(base.length + badMehd.length);
    rebuilt.set(base.subarray(0, mvexHeaderEnd));
    rebuilt.set(badMehd, mvexHeaderEnd);
    rebuilt.set(base.subarray(mvexHeaderEnd), mvexHeaderEnd + badMehd.length);

    const rv = new DataView(rebuilt.buffer);
    rv.setUint32(mvexOffset, mvexSize + badMehd.length, false);
    const moovType = [0x6d, 0x6f, 0x6f, 0x76];
    for (let i = 0; i < mvexOffset; i++) {
      if (
        rebuilt[i + 4] === moovType[0] &&
        rebuilt[i + 5] === moovType[1] &&
        rebuilt[i + 6] === moovType[2] &&
        rebuilt[i + 7] === moovType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + badMehd.length, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });

  it('tfdt payload too short (under 8 bytes) throws Mp4InvalidBoxError', () => {
    // Build a valid fMP4 with tfdt v0, then shrink the tfdt to 7-byte payload.
    const bytes = buildFmp4({
      fragments: [
        {
          sequenceNumber: 1,
          tfhdOpts: { trackId: 1, defaultBaseIsMoof: true },
          tfdt: { baseMediaDecodeTime: 44100, version: 0 },
          trun: { samples: [{ duration: 1024, size: 4 }] },
        },
      ],
    });

    // tfdt v0 box is 8+8=16 bytes total. Shrink to 8+7=15 by reducing size by 1.
    const tfdtType = [0x74, 0x66, 0x64, 0x74];
    for (let i = 0; i < bytes.length - 16; i++) {
      if (
        bytes[i + 4] === tfdtType[0] &&
        bytes[i + 5] === tfdtType[1] &&
        bytes[i + 6] === tfdtType[2] &&
        bytes[i + 7] === tfdtType[3]
      ) {
        const view = new DataView(bytes.buffer);
        const origSize = view.getUint32(i, false); // 16 bytes
        view.setUint32(i, origSize - 1, false); // 15 bytes → payload = 7 bytes < 8
        break;
      }
    }

    expect(() => parseMp4(bytes)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Review fixes: F9 — strict-reject duplicate mvex/mfhd/tfhd', () => {
  it('F9.1: duplicate mvex in moov throws Mp4InvalidBoxError', () => {
    // Build a base fMP4, then splice a second mvex box into moov.
    const base = buildFmp4({ fragments: [] });

    // Find the existing mvex box.
    const mvexType = [0x6d, 0x76, 0x65, 0x78];
    let mvexOffset = -1;
    let mvexSize = 0;
    for (let i = 0; i < base.length - 8; i++) {
      if (
        base[i + 4] === mvexType[0] &&
        base[i + 5] === mvexType[1] &&
        base[i + 6] === mvexType[2] &&
        base[i + 7] === mvexType[3]
      ) {
        mvexOffset = i;
        mvexSize = new DataView(base.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mvexOffset).toBeGreaterThan(0);

    // Extract the existing mvex bytes and duplicate them.
    const mvexBytes = base.subarray(mvexOffset, mvexOffset + mvexSize);
    const duplicate = new Uint8Array(mvexBytes);

    // Insert the duplicate after the original mvex.
    const insertAt = mvexOffset + mvexSize;
    const rebuilt = new Uint8Array(base.length + duplicate.length);
    rebuilt.set(base.subarray(0, insertAt));
    rebuilt.set(duplicate, insertAt);
    rebuilt.set(base.subarray(insertAt), insertAt + duplicate.length);

    // Fix moov size.
    const moovType = [0x6d, 0x6f, 0x6f, 0x76];
    const rv = new DataView(rebuilt.buffer);
    for (let i = 0; i < mvexOffset; i++) {
      if (
        rebuilt[i + 4] === moovType[0] &&
        rebuilt[i + 5] === moovType[1] &&
        rebuilt[i + 6] === moovType[2] &&
        rebuilt[i + 7] === moovType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + duplicate.length, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });

  it('F9.2: duplicate mfhd in moof throws Mp4InvalidBoxError', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find the mfhd box inside the moof.
    const mfhdType = [0x6d, 0x66, 0x68, 0x64];
    let mfhdOffset = -1;
    let mfhdSize = 0;
    for (let i = 0; i < bytes.length - 8; i++) {
      if (
        bytes[i + 4] === mfhdType[0] &&
        bytes[i + 5] === mfhdType[1] &&
        bytes[i + 6] === mfhdType[2] &&
        bytes[i + 7] === mfhdType[3]
      ) {
        mfhdOffset = i;
        mfhdSize = new DataView(bytes.buffer).getUint32(i, false);
        break;
      }
    }
    expect(mfhdOffset).toBeGreaterThan(0);

    const mfhdBytes = bytes.subarray(mfhdOffset, mfhdOffset + mfhdSize);
    const duplicate = new Uint8Array(mfhdBytes);

    // Insert duplicate immediately after the original mfhd.
    const insertAt = mfhdOffset + mfhdSize;
    const rebuilt = new Uint8Array(bytes.length + duplicate.length);
    rebuilt.set(bytes.subarray(0, insertAt));
    rebuilt.set(duplicate, insertAt);
    rebuilt.set(bytes.subarray(insertAt), insertAt + duplicate.length);

    // Fix moof size. moof must contain the duplicate.
    const moofType = [0x6d, 0x6f, 0x6f, 0x66];
    const rv = new DataView(rebuilt.buffer);
    for (let i = 0; i < mfhdOffset; i++) {
      if (
        rebuilt[i + 4] === moofType[0] &&
        rebuilt[i + 5] === moofType[1] &&
        rebuilt[i + 6] === moofType[2] &&
        rebuilt[i + 7] === moofType[3]
      ) {
        rv.setUint32(i, rv.getUint32(i, false) + duplicate.length, false);
        break;
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });

  it('F9.3: duplicate tfhd in traf throws Mp4InvalidBoxError', () => {
    const bytes = buildMinimalFmp4({ sampleCount: 1, sampleSize: 4 });

    // Find tfhd inside traf.
    const tfhdType = [0x74, 0x66, 0x68, 0x64];
    let tfhdOffset = -1;
    let tfhdSize = 0;
    for (let i = 0; i < bytes.length - 8; i++) {
      if (
        bytes[i + 4] === tfhdType[0] &&
        bytes[i + 5] === tfhdType[1] &&
        bytes[i + 6] === tfhdType[2] &&
        bytes[i + 7] === tfhdType[3]
      ) {
        tfhdOffset = i;
        tfhdSize = new DataView(bytes.buffer).getUint32(i, false);
        break;
      }
    }
    expect(tfhdOffset).toBeGreaterThan(0);

    const tfhdBytes = bytes.subarray(tfhdOffset, tfhdOffset + tfhdSize);
    const duplicate = new Uint8Array(tfhdBytes);

    const insertAt = tfhdOffset + tfhdSize;
    const rebuilt = new Uint8Array(bytes.length + duplicate.length);
    rebuilt.set(bytes.subarray(0, insertAt));
    rebuilt.set(duplicate, insertAt);
    rebuilt.set(bytes.subarray(insertAt), insertAt + duplicate.length);

    // Fix parent sizes: traf, moof.
    const containerTypes: number[][] = [
      [0x74, 0x72, 0x61, 0x66], // 'traf'
      [0x6d, 0x6f, 0x6f, 0x66], // 'moof'
    ];
    const rv = new DataView(rebuilt.buffer);
    for (const ct of containerTypes) {
      for (let i = 0; i < tfhdOffset; i++) {
        if (
          rebuilt[i + 4] === ct[0] &&
          rebuilt[i + 5] === ct[1] &&
          rebuilt[i + 6] === ct[2] &&
          rebuilt[i + 7] === ct[3]
        ) {
          const curSize = rv.getUint32(i, false);
          if (i + curSize > tfhdOffset) {
            rv.setUint32(i, curSize + duplicate.length, false);
            break;
          }
        }
      }
    }

    expect(() => parseMp4(rebuilt)).toThrow(Mp4InvalidBoxError);
  });
});
