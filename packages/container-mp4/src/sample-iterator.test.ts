/**
 * Tests for sample-iterator.ts — audio sample iteration.
 *
 * Covers:
 * - Timestamp computation from stts deltas and mdhd.timescale
 * - Duration computation
 * - Zero-copy data subarray correctness
 * - deriveCodecString for OTI 0x40 (MPEG-4) and 0x67 (MPEG-2)
 */

import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import {
  buildAvcCPayload,
  buildAvcSampleEntry,
  extractFirstSampleEntryPayload,
  wrapStsd,
} from './_test-helpers/build-video-stsd.ts';
import { parseVisualSampleEntry } from './boxes/visual-sample-entry.ts';
import { Mp4IterateWrongKindError } from './errors.ts';
import { parseMp4 } from './parser.ts';
import {
  deriveCodecString,
  iterateAudioSamples,
  iterateAudioSamplesAuto,
  iterateFragmentedAudioSamples,
  iterateFragmentedVideoSamples,
  iterateSamples,
  iterateVideoSamples,
} from './sample-iterator.ts';

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
    sampleEntry: {
      kind: 'audio' as const,
      entry: {
        channelCount: 1,
        sampleSize: 16,
        sampleRate: 44100,
        decoderSpecificInfo: new Uint8Array([0x12, 0x10]),
        objectTypeIndication: 0x40,
      },
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
    editList: [] as const,
    syncSamples: null,
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

// ---------------------------------------------------------------------------
// iterateSamples — unified dispatch (covers iterateSamples function branches)
// ---------------------------------------------------------------------------

describe('iterateSamples — video dispatch coverage', () => {
  function buildVideoTrack() {
    const avcCPayload = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
      [new Uint8Array([0x68])],
    );
    const avc1Box = buildAvcSampleEntry('avc1', 640, 480, avcCPayload);
    const stsdBox = wrapStsd(avc1Box);
    const entry = parseVisualSampleEntry('avc1', extractFirstSampleEntryPayload(stsdBox), {
      value: 0,
    });

    const fileBytes = new Uint8Array(32); // 4 samples * 8 bytes each
    return {
      track: {
        trackId: 1,
        handlerType: 'vide' as const,
        mediaHeader: { version: 0 as const, timescale: 90000, duration: 12000, language: 'und' },
        trackHeader: { version: 0 as const, flags: 3, trackId: 1, duration: 12000, volume: 0 },
        sampleEntry: { kind: 'video' as const, entry },
        sampleTable: {
          sampleCount: 4,
          sampleSizes: new Uint32Array([8, 8, 8, 8]),
          sampleOffsets: new Float64Array([0, 8, 16, 24]),
          sampleDeltas: new Uint32Array([3000, 3000, 3000, 3000]),
        },
        sttsEntries: [{ sampleCount: 4, sampleDelta: 3000 }],
        stscEntries: [{ firstChunk: 1, samplesPerChunk: 4, sampleDescriptionIndex: 1 }],
        chunkOffsets: [0] as readonly number[],
        chunkOffsetVariant: 'stco' as const,
        editList: [] as const,
        syncSamples: null,
      },
      fileBytes,
    };
  }

  it('iterateSamples dispatches to iterateVideoSamples for non-fragmented video', () => {
    const { track, fileBytes } = buildVideoTrack();
    const mockFile = {
      ftyp: { majorBrand: 'isom', minorVersion: 0, compatibleBrands: ['isom'] },
      movieHeader: { version: 0 as const, timescale: 90000, duration: 12000, nextTrackId: 2 },
      tracks: [track],
      mdatRanges: [],
      fileBytes,
      metadata: [] as const,
      udtaOpaque: null,
      isFragmented: false,
      moofBoxes: [],
    };

    const samples = Array.from(iterateSamples(mockFile));
    expect(samples).toHaveLength(4);
    expect(samples[0]?.kind).toBe('video');
    expect(samples[0]?.isKeyframe).toBe(true); // syncSamples=null → all keyframes
    expect(samples[0]?.presentationTimeUs).toBe(0);
  });

  it('iterateSamples dispatches to iterateAudioSamples for audio track', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const file = parseMp4(bytes);
    const samples = Array.from(iterateSamples(file));
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]?.kind).toBe('audio');
  });

  it('iterateVideoSamples yields correct sample count and keyframe flags', () => {
    const { track, fileBytes } = buildVideoTrack();
    const syncSamples = new Set([1, 3]); // 1-based
    const trackWithStss = { ...track, syncSamples };
    const samples = Array.from(iterateVideoSamples(trackWithStss, fileBytes));
    expect(samples).toHaveLength(4);
    expect(samples[0]?.isKeyframe).toBe(true); // sample 1 in syncSet
    expect(samples[1]?.isKeyframe).toBe(false); // sample 2 not in syncSet
    expect(samples[2]?.isKeyframe).toBe(true); // sample 3 in syncSet
    expect(samples[3]?.isKeyframe).toBe(false); // sample 4 not in syncSet
  });
});

// ---------------------------------------------------------------------------
// Helpers for fragmented video tests (F2, F3, F4, F7)
// ---------------------------------------------------------------------------

/** Low-level helpers building a fragmented MP4 with video (avc1) track from scratch. */
function buildVideoFmp4Raw(opts: {
  sampleFlagsPerSample?: (number | null)[];
  trafDefaultSampleFlags?: number;
  firstSampleFlags?: number;
  sampleCount?: number;
  sampleSize?: number;
  trexDefaultSampleFlags?: number;
}): Uint8Array {
  const sampleCount = opts.sampleCount ?? 3;
  const sampleSize = opts.sampleSize ?? 4;
  const trexDefaultSampleFlags = opts.trexDefaultSampleFlags ?? 0;

  function u32be(v: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    return b;
  }
  function i32be(v: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, false);
    return b;
  }
  function fourCC(s: string): Uint8Array {
    const b = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      b[i] = (s.charCodeAt(i) ?? 0x20) & 0xff;
    }
    return b;
  }
  function wrap(type: string, ...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(8 + total);
    new DataView(out.buffer).setUint32(0, 8 + total, false);
    out.set(fourCC(type), 4);
    let off = 8;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  function cat(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  // ftyp
  const ftyp = (() => {
    const brand = new Uint8Array([0x69, 0x73, 0x6f, 0x35]); // 'iso5'
    const minor = new Uint8Array(4);
    const compat = cat(
      new Uint8Array([0x69, 0x73, 0x6f, 0x35]), // 'iso5'
      new Uint8Array([0x69, 0x73, 0x6f, 0x6d]), // 'isom'
    );
    return wrap('ftyp', brand, minor, compat);
  })();

  // Build avc1 stsd
  const avcCPayload = buildAvcCPayload(
    0x42,
    0xe0,
    0x1e,
    3,
    [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
    [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
  );
  const avc1Box = buildAvcSampleEntry('avc1', 1280, 720, avcCPayload);
  const stsdBox = wrapStsd(avc1Box);

  // empty stts/stsc/stsz/stco
  const emptyStts = wrap('stts', new Uint8Array(8));
  const emptyStsc = wrap('stsc', new Uint8Array(8));
  const emptyStsz = wrap('stsz', new Uint8Array(12));
  const emptyStco = wrap('stco', new Uint8Array(8));

  const stbl = wrap('stbl', stsdBox, emptyStts, emptyStsc, emptyStsz, emptyStco);

  // vmhd (video media header)
  const vmhd = wrap('vmhd', new Uint8Array(8));

  // dref (self-contained url)
  const urlEntry = new Uint8Array(12);
  new DataView(urlEntry.buffer).setUint32(0, 12, false);
  urlEntry.set(fourCC('url '), 4);
  urlEntry[11] = 0x01; // self-contained
  const drefPayload = new Uint8Array(8);
  new DataView(drefPayload.buffer).setUint32(4, 1, false); // entry_count=1
  const dref = wrap('dref', drefPayload, urlEntry);

  const dinf = wrap('dinf', dref);
  const minf = wrap('minf', vmhd, dinf, stbl);

  // mdhd: version=0
  const mdhdPayload = new Uint8Array(24);
  new DataView(mdhdPayload.buffer).setUint32(12, 90000, false); // timescale
  mdhdPayload[20] = 0x55;
  mdhdPayload[21] = 0xc4; // language 'und'
  const mdhd = wrap('mdhd', mdhdPayload);

  // hdlr: vide handler
  const hdlrName = new TextEncoder().encode('VideoHandler\0');
  const hdlrPayload = new Uint8Array(4 + 4 + 4 + 12 + hdlrName.length);
  hdlrPayload.set(fourCC('vide'), 8); // handler_type
  hdlrPayload.set(hdlrName, 24);
  const hdlr = wrap('hdlr', hdlrPayload);

  const mdia = wrap('mdia', mdhd, hdlr, minf);

  // tkhd
  const tkhdPayload = new Uint8Array(92);
  tkhdPayload[3] = 0x03; // flags: track_enabled | track_in_movie
  new DataView(tkhdPayload.buffer).setUint32(12, 1, false); // track_ID
  new DataView(tkhdPayload.buffer).setUint32(36, 0x00010000, false);
  new DataView(tkhdPayload.buffer).setUint32(52, 0x00010000, false);
  new DataView(tkhdPayload.buffer).setUint32(68, 0x40000000, false);
  const tkhd = wrap('tkhd', tkhdPayload);

  const trak = wrap('trak', tkhd, mdia);

  // mvhd
  const mvhdPayload = new Uint8Array(100);
  new DataView(mvhdPayload.buffer).setUint32(12, 90000, false); // timescale
  new DataView(mvhdPayload.buffer).setUint32(20, 0x00010000, false); // rate
  mvhdPayload[24] = 0x01; // volume
  new DataView(mvhdPayload.buffer).setUint32(36, 0x00010000, false);
  new DataView(mvhdPayload.buffer).setUint32(52, 0x00010000, false);
  new DataView(mvhdPayload.buffer).setUint32(68, 0x40000000, false);
  new DataView(mvhdPayload.buffer).setUint32(96, 2, false); // next_track_ID
  const mvhd = wrap('mvhd', mvhdPayload);

  // trex
  const trexPayload = new Uint8Array(24);
  new DataView(trexPayload.buffer).setUint32(4, 1, false); // track_ID=1
  new DataView(trexPayload.buffer).setUint32(8, 1, false); // desc_index
  new DataView(trexPayload.buffer).setUint32(12, 3000, false); // default_duration
  new DataView(trexPayload.buffer).setUint32(16, sampleSize, false); // default_size
  new DataView(trexPayload.buffer).setUint32(20, trexDefaultSampleFlags, false);
  const trex = wrap('trex', trexPayload);

  const mvex = wrap('mvex', trex);
  const moov = wrap('moov', mvhd, trak, mvex);

  // Build tfhd
  let tfhdFlags = 0x020000; // default-base-is-moof
  if (opts.trafDefaultSampleFlags !== undefined) tfhdFlags |= 0x000020;
  const tfhdParts: Uint8Array[] = [];
  const tfhdPrefix = new Uint8Array(4);
  tfhdPrefix[1] = (tfhdFlags >> 16) & 0xff;
  tfhdPrefix[2] = (tfhdFlags >> 8) & 0xff;
  tfhdPrefix[3] = tfhdFlags & 0xff;
  tfhdParts.push(tfhdPrefix, u32be(1)); // track_ID=1
  if (opts.trafDefaultSampleFlags !== undefined) {
    tfhdParts.push(u32be(opts.trafDefaultSampleFlags));
  }
  const tfhd = wrap('tfhd', cat(...tfhdParts));

  // tfdt
  const tfdtPayload = new Uint8Array(8);
  const tfdt = wrap('tfdt', tfdtPayload);

  // Build trun
  const hasSampleFlagsField = opts.sampleFlagsPerSample?.some((f) => f !== null);
  const hasFirstSampleFlags = opts.firstSampleFlags !== undefined;

  let trunFlags = 0x000001 | 0x000100 | 0x000200; // data_offset + duration + size
  if (hasSampleFlagsField) trunFlags |= 0x000400;
  if (hasFirstSampleFlags) trunFlags |= 0x000004;

  const trunPrefix = new Uint8Array(4);
  trunPrefix[1] = (trunFlags >> 16) & 0xff;
  trunPrefix[2] = (trunFlags >> 8) & 0xff;
  trunPrefix[3] = trunFlags & 0xff;

  const trap16 = hasSampleFlagsField && hasFirstSampleFlags && sampleCount > 0;

  function buildTrunPayload(dataOff: number): Uint8Array {
    const parts: Uint8Array[] = [trunPrefix, u32be(sampleCount), i32be(dataOff)];
    if (hasFirstSampleFlags && opts.firstSampleFlags !== undefined) {
      parts.push(u32be(opts.firstSampleFlags));
    }
    for (let i = 0; i < sampleCount; i++) {
      parts.push(u32be(3000)); // duration
      parts.push(u32be(sampleSize)); // size
      if (hasSampleFlagsField) {
        if (i === 0 && trap16) {
          // trap 16: omit per-sample flags for sample 0 when first_sample_flags present
        } else {
          const f = opts.sampleFlagsPerSample?.[i];
          parts.push(u32be(f ?? 0));
        }
      }
    }
    return cat(...parts);
  }

  // Build trial moof to compute data_offset
  const trunBoxTrial = wrap('trun', buildTrunPayload(0));
  const trafBoxTrial = wrap('traf', tfhd, tfdt, trunBoxTrial);
  const mfhdPayload = new Uint8Array(8);
  new DataView(mfhdPayload.buffer).setUint32(4, 1, false); // sequence_number=1
  const mfhd = wrap('mfhd', mfhdPayload);
  const moofTrial = wrap('moof', mfhd, trafBoxTrial);
  const dataOffset = moofTrial.length + 8; // +8 for mdat header

  // Final moof with correct data_offset
  const trunBoxFinal = wrap('trun', buildTrunPayload(dataOffset));
  const trafFinal = wrap('traf', tfhd, tfdt, trunBoxFinal);
  const moofFinalBox = wrap('moof', mfhd, trafFinal);

  // mdat
  const mdatPayload = new Uint8Array(sampleCount * sampleSize);
  const mdatBox = wrap('mdat', mdatPayload);

  return cat(ftyp, moov, moofFinalBox, mdatBox);
}

// ---------------------------------------------------------------------------
// F3 — iterateFragmentedAudioSamples on video track throws Mp4IterateWrongKindError
// ---------------------------------------------------------------------------

describe('F3 — iterateFragmentedAudioSamples rejects video track', () => {
  it('throws Mp4IterateWrongKindError when called on a fragmented video file', () => {
    const bytes = buildVideoFmp4Raw({});
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);
    expect(file.tracks[0]?.sampleEntry.kind).toBe('video');

    expect(() => {
      const gen = iterateFragmentedAudioSamples(file);
      gen.next();
    }).toThrow(Mp4IterateWrongKindError);
  });
});

// ---------------------------------------------------------------------------
// F4 — iterateAudioSamplesAuto on video track throws Mp4IterateWrongKindError
// ---------------------------------------------------------------------------

describe('F4 — iterateAudioSamplesAuto rejects video track (top-level guard)', () => {
  it('throws Mp4IterateWrongKindError for fragmented video file via iterateAudioSamplesAuto', () => {
    const bytes = buildVideoFmp4Raw({});
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);

    expect(() => {
      const gen = iterateAudioSamplesAuto(file);
      gen.next();
    }).toThrow(Mp4IterateWrongKindError);
  });
});

// ---------------------------------------------------------------------------
// F2 + F7 — iterateFragmentedVideoSamples: isKeyframe from trun flags + coverage
// ---------------------------------------------------------------------------

describe('F2 + F7 — iterateFragmentedVideoSamples: isKeyframe from trun sample flags', () => {
  it('F7: iterates fragmented video samples and returns correct count and timestamps', () => {
    // All samples use traf defaultSampleFlags=0 (sync = keyframe)
    const bytes = buildVideoFmp4Raw({ sampleCount: 3, sampleSize: 4 });
    const file = parseMp4(bytes);
    expect(file.isFragmented).toBe(true);
    expect(file.tracks[0]?.sampleEntry.kind).toBe('video');

    const samples = Array.from(iterateFragmentedVideoSamples(file));
    expect(samples).toHaveLength(3);
    expect(samples[0]?.kind).toBe('video');
    expect(samples[0]?.index).toBe(0);
    expect(samples[1]?.index).toBe(1);
    expect(samples[2]?.index).toBe(2);
    // timestamps: 0, 3000/90000*1e6 = 33333.3µs, 66666.7µs
    expect(samples[0]?.presentationTimeUs).toBeCloseTo(0, 0);
    expect(samples[1]?.presentationTimeUs).toBeCloseTo((3000 / 90000) * 1_000_000, 0);
    expect(samples[2]?.presentationTimeUs).toBeCloseTo((6000 / 90000) * 1_000_000, 0);
    // sizes
    expect(samples[0]?.data.length).toBe(4);
  });

  it('F2: defaultSampleFlags with 0x010000 → isKeyframe=false for all samples', () => {
    // traf defaultSampleFlags = 0x010000 → sample_is_non_sync_sample set → isKeyframe=false
    const bytes = buildVideoFmp4Raw({
      sampleCount: 3,
      sampleSize: 4,
      trafDefaultSampleFlags: 0x010000,
    });
    const file = parseMp4(bytes);
    const samples = Array.from(iterateFragmentedVideoSamples(file));
    expect(samples).toHaveLength(3);
    expect(samples[0]?.isKeyframe).toBe(false);
    expect(samples[1]?.isKeyframe).toBe(false);
    expect(samples[2]?.isKeyframe).toBe(false);
  });

  it('F2: per-sample flags with 0x010000 cleared → isKeyframe=true for that sample', () => {
    // All samples: non-sync (0x010000), but sample 0 has per-sample flags=0 (sync)
    const bytes = buildVideoFmp4Raw({
      sampleCount: 3,
      sampleSize: 4,
      trafDefaultSampleFlags: 0x010000,
      sampleFlagsPerSample: [0x000000, 0x010000, 0x010000],
    });
    const file = parseMp4(bytes);
    const samples = Array.from(iterateFragmentedVideoSamples(file));
    expect(samples).toHaveLength(3);
    expect(samples[0]?.isKeyframe).toBe(true); // per-sample flags=0 → sync
    expect(samples[1]?.isKeyframe).toBe(false); // per-sample flags=0x010000 → non-sync
    expect(samples[2]?.isKeyframe).toBe(false);
  });

  it('F2: firstSampleFlags=0 (sync) overrides traf defaultSampleFlags=0x010000 for sample 0 only', () => {
    // traf defaultSampleFlags=0x010000 (non-sync), but firstSampleFlags=0 (sync for sample 0)
    const bytes = buildVideoFmp4Raw({
      sampleCount: 3,
      sampleSize: 4,
      trafDefaultSampleFlags: 0x010000,
      firstSampleFlags: 0x000000,
    });
    const file = parseMp4(bytes);
    const samples = Array.from(iterateFragmentedVideoSamples(file));
    expect(samples).toHaveLength(3);
    expect(samples[0]?.isKeyframe).toBe(true); // firstSampleFlags=0 → sync
    expect(samples[1]?.isKeyframe).toBe(false); // defaultSampleFlags=0x010000 → non-sync
    expect(samples[2]?.isKeyframe).toBe(false);
  });

  it('F7: iterateSamples dispatches to iterateFragmentedVideoSamples for fragmented video', () => {
    const bytes = buildVideoFmp4Raw({ sampleCount: 2, sampleSize: 4 });
    const file = parseMp4(bytes);
    const samples = Array.from(iterateSamples(file));
    expect(samples).toHaveLength(2);
    expect(samples[0]?.kind).toBe('video');
  });
});
