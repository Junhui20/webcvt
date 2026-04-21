/**
 * Tests for sub-pass B: Video Sample Entries.
 *
 * Covers §14 test plan items 1–26 (≥26 tests):
 *   1–3:   avc1 baseline / main / high (with trailing extension)
 *   4:     avc3 — codec string prefix avc1.*, format avc3
 *   5:     hev1 with VPS+SPS+PPS arrays
 *   6:     hvc1 — codec string prefix hvc1.*
 *   7–8:   vp09 with zero and non-zero codecInitializationData
 *   9:     av01 with small configOBUs
 *   10:    extraBoxes preserved
 *   11:    Round-trip each codec (6)
 *   12–15: Codec string exact values
 *   16–24: Rejection tests
 *   25:    iterateAudioSamples on video track → Mp4IterateWrongKindError
 *   26:    iterateVideoSamples returns correct isKeyframe from stss
 */

import { describe, expect, it } from 'vitest';
import {
  buildAv01SampleEntry,
  buildAv1CPayload,
  buildAvcCHighExtension,
  buildAvcCPayload,
  buildAvcSampleEntry,
  buildHevcSampleEntry,
  buildHvcCPayload,
  buildVisualSampleEntryHeader,
  buildVp09SampleEntry,
  buildVpcCPayload,
  extractFirstSampleEntryPayload,
  wrapStsd,
} from '../_test-helpers/build-video-stsd.ts';
import {
  Mp4Av1CBadMarkerError,
  Mp4Av1CMissingError,
  Mp4AvcCBadLengthSizeError,
  Mp4AvcCBadVersionError,
  Mp4AvcCMissingError,
  Mp4AvcCNalLengthError,
  Mp4HvcCBadLengthSizeError,
  Mp4HvcCMissingError,
  Mp4InvalidBoxError,
  Mp4IterateWrongKindError,
  Mp4UnsupportedVideoCodecError,
  Mp4VisualDimensionOutOfRangeError,
  Mp4VisualSampleEntryTooSmallError,
  Mp4VpcCBadVersionError,
  Mp4VpcCMissingError,
} from '../errors.ts';
import { iterateAudioSamples, iterateVideoSamples } from '../sample-iterator.ts';
import { parseAv1C } from './av1C.ts';
import { parseAvcC } from './avcC.ts';
import { deriveVideoCodecString } from './codec-string.ts';
import { parseStsd } from './hdlr-stsd-mp4a.ts';
import { parseHvcC } from './hvcC.ts';
import { parseVisualSampleEntry, serializeVisualSampleEntry } from './visual-sample-entry.ts';
import { parseVpcC } from './vpcC.ts';

// ---------------------------------------------------------------------------
// Helper: build a full visual sample entry payload (without size+type header)
// ---------------------------------------------------------------------------

function extractVisualPayload(fourCC: string, sampleEntryBox: Uint8Array): Uint8Array {
  // sampleEntryBox = size(4) + type(4) + payload
  return sampleEntryBox.subarray(8);
}

// ---------------------------------------------------------------------------
// Test 1: avc1 baseline (profile=66=0x42)
// ---------------------------------------------------------------------------

describe('Video Sample Entries — avc1 / avc3', () => {
  it('Test 1: avc1 baseline (profile=0x42) — SPS+PPS extracted', () => {
    const spsBuf = new Uint8Array([0x67, 0x42, 0xe0, 0x1e, 0x89, 0x8b]);
    const ppsBuf = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const avcC = buildAvcCPayload(0x42, 0xe0, 0x1e, 3, [spsBuf], [ppsBuf]);
    const box = buildAvcSampleEntry('avc1', 1280, 720, avcC);
    const payload = extractVisualPayload('avc1', box);
    const entry = parseVisualSampleEntry('avc1', payload, { value: 0 });

    expect(entry.format).toBe('avc1');
    expect(entry.width).toBe(1280);
    expect(entry.height).toBe(720);
    expect(entry.codecConfig.kind).toBe('avcC');
    if (entry.codecConfig.kind !== 'avcC') throw new Error('expected avcC');
    expect(entry.codecConfig.profile).toBe(0x42);
    expect(entry.codecConfig.level).toBe(0x1e);
    expect(entry.codecConfig.nalUnitLengthSize).toBe(4);
    expect(entry.codecConfig.sps).toHaveLength(1);
    expect(entry.codecConfig.pps).toHaveLength(1);
    expect(entry.codecConfig.spsExt).toBeNull();
    expect(entry.codecString).toBe('avc1.42e01e');
  });

  // Test 2: avc1 main (profile=0x4d)
  it('Test 2: avc1 main (profile=0x4d, level=0x28)', () => {
    const spsBuf = new Uint8Array([0x67, 0x4d, 0x40, 0x28]);
    const ppsBuf = new Uint8Array([0x68, 0xde, 0x09, 0x68]);
    const avcC = buildAvcCPayload(0x4d, 0x40, 0x28, 3, [spsBuf], [ppsBuf]);
    const box = buildAvcSampleEntry('avc1', 1920, 1080, avcC);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });

    expect(entry.codecConfig.kind).toBe('avcC');
    if (entry.codecConfig.kind !== 'avcC') throw new Error('expected avcC');
    expect(entry.codecConfig.profile).toBe(0x4d);
    expect(entry.codecConfig.level).toBe(0x28);
    expect(entry.codecString).toBe('avc1.4d4028');
  });

  // Test 3: avc1 high (profile=0x64) WITH trailing High-profile extension
  it('Test 3: avc1 high (profile=0x64) WITH trailing extension', () => {
    const spsBuf = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40]);
    const ppsBuf = new Uint8Array([0x68, 0xeb, 0xec, 0xb2, 0x2c]);
    const ext = buildAvcCHighExtension(1, 0, 0, []);
    const avcC = buildAvcCPayload(0x64, 0x00, 0x28, 3, [spsBuf], [ppsBuf], ext);
    const box = buildAvcSampleEntry('avc1', 1920, 1080, avcC);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });

    expect(entry.codecConfig.kind).toBe('avcC');
    if (entry.codecConfig.kind !== 'avcC') throw new Error('expected avcC');
    expect(entry.codecConfig.profile).toBe(0x64);
    expect(entry.codecConfig.chromaFormat).toBe(1);
    expect(entry.codecConfig.bitDepthLumaMinus8).toBe(0);
    expect(entry.codecConfig.bitDepthChromaMinus8).toBe(0);
    expect(entry.codecConfig.spsExt).toHaveLength(0);
    expect(entry.codecString).toBe('avc1.640028');
  });

  // Test 4: avc3 — codec string prefix is avc1.*, format is avc3
  it('Test 4: avc3 — codec string always uses avc1.* prefix; format=avc3', () => {
    const spsBuf = new Uint8Array([0x67, 0x42, 0xc0, 0x1e]);
    const ppsBuf = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const avcC = buildAvcCPayload(0x42, 0xc0, 0x1e, 3, [spsBuf], [ppsBuf]);
    const box = buildAvcSampleEntry('avc3', 640, 480, avcC);
    const entry = parseVisualSampleEntry('avc3', extractVisualPayload('avc3', box), { value: 0 });

    expect(entry.format).toBe('avc3');
    expect(entry.codecString).toMatch(/^avc1\./); // always avc1. prefix
    expect(entry.codecString).toBe('avc1.42c01e');
  });
});

// ---------------------------------------------------------------------------
// Tests 5–6: HEVC
// ---------------------------------------------------------------------------

describe('Video Sample Entries — hev1 / hvc1', () => {
  // Test 5: hev1 with VPS+SPS+PPS arrays
  it('Test 5: hev1 with VPS(32) + SPS(33) + PPS(34) arrays', () => {
    const vps = new Uint8Array([0x40, 0x01, 0x0c, 0x01]);
    const sps = new Uint8Array([0x42, 0x01, 0x01, 0x01]);
    const pps = new Uint8Array([0x44, 0x01, 0xc1]);

    const hvcC = buildHvcCPayload(
      0,
      0,
      1,
      0x60000000,
      new Uint8Array([0xb0, 0x00, 0x00, 0x00, 0x00, 0x00]),
      93,
      [
        { type: 32, nalus: [vps] }, // VPS
        { type: 33, nalus: [sps] }, // SPS
        { type: 34, nalus: [pps] }, // PPS
      ],
    );
    const box = buildHevcSampleEntry('hev1', 1920, 1080, hvcC);
    const entry = parseVisualSampleEntry('hev1', extractVisualPayload('hev1', box), { value: 0 });

    expect(entry.format).toBe('hev1');
    expect(entry.codecConfig.kind).toBe('hvcC');
    if (entry.codecConfig.kind !== 'hvcC') throw new Error('expected hvcC');
    expect(entry.codecConfig.generalProfileIdc).toBe(1);
    expect(entry.codecConfig.generalLevelIdc).toBe(93);
    expect(entry.codecConfig.arrays).toHaveLength(3);
    expect(entry.codecString).toMatch(/^hev1\./);
  });

  // Test 6: hvc1 — codec string prefix hvc1.*
  it('Test 6: hvc1 — codec string uses hvc1.* prefix', () => {
    const sps = new Uint8Array([0x42, 0x01, 0x01]);
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, new Uint8Array(6), 93, [
      { type: 33, nalus: [sps] },
    ]);
    const box = buildHevcSampleEntry('hvc1', 1280, 720, hvcC);
    const entry = parseVisualSampleEntry('hvc1', extractVisualPayload('hvc1', box), { value: 0 });

    expect(entry.format).toBe('hvc1');
    expect(entry.codecString).toMatch(/^hvc1\./);
  });
});

// ---------------------------------------------------------------------------
// Tests 7–8: VP9
// ---------------------------------------------------------------------------

describe('Video Sample Entries — vp09', () => {
  // Test 7: vp09 with zero codecInitializationData
  it('Test 7: vp09 with zero codecInitializationData', () => {
    const vpcC = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1, new Uint8Array(0));
    const box = buildVp09SampleEntry(1280, 720, vpcC);
    const entry = parseVisualSampleEntry('vp09', extractVisualPayload('vp09', box), { value: 0 });

    expect(entry.format).toBe('vp09');
    expect(entry.codecConfig.kind).toBe('vpcC');
    if (entry.codecConfig.kind !== 'vpcC') throw new Error('expected vpcC');
    expect(entry.codecConfig.profile).toBe(0);
    expect(entry.codecConfig.level).toBe(10);
    expect(entry.codecConfig.bitDepth).toBe(8);
    expect(entry.codecConfig.codecInitializationData).toHaveLength(0);
    expect(entry.codecString).toBe('vp09.00.10.08.01.01.01.01.00');
  });

  // Test 8: vp09 with non-zero codecInitializationData
  it('Test 8: vp09 with non-zero codecInitializationData', () => {
    const initData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const vpcC = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1, initData);
    const box = buildVp09SampleEntry(1920, 1080, vpcC);
    const entry = parseVisualSampleEntry('vp09', extractVisualPayload('vp09', box), { value: 0 });

    expect(entry.codecConfig.kind).toBe('vpcC');
    if (entry.codecConfig.kind !== 'vpcC') throw new Error('expected vpcC');
    expect(entry.codecConfig.codecInitializationData).toHaveLength(4);
    expect(entry.codecConfig.codecInitializationData[0]).toBe(0xde);
  });
});

// ---------------------------------------------------------------------------
// Test 9: av01 with small configOBUs
// ---------------------------------------------------------------------------

describe('Video Sample Entries — av01', () => {
  it('Test 9: av01 with small configOBUs', () => {
    const obus = new Uint8Array([0x0a, 0x0b, 0x0c]);
    const av1C = buildAv1CPayload(0, 4, 0, 0, 0, 0, 1, 1, 0, 0, 0, obus);
    const box = buildAv01SampleEntry(1280, 720, av1C);
    const entry = parseVisualSampleEntry('av01', extractVisualPayload('av01', box), { value: 0 });

    expect(entry.format).toBe('av01');
    expect(entry.codecConfig.kind).toBe('av1C');
    if (entry.codecConfig.kind !== 'av1C') throw new Error('expected av1C');
    expect(entry.codecConfig.seqProfile).toBe(0);
    expect(entry.codecConfig.seqLevelIdx0).toBe(4);
    expect(entry.codecConfig.configObus).toHaveLength(3);
    expect(entry.codecConfig.configObus[0]).toBe(0x0a);
    expect(entry.codecString).toBe('av01.0.04M.08');
  });
});

// ---------------------------------------------------------------------------
// Test 10: extraBoxes preserved
// ---------------------------------------------------------------------------

describe('Video Sample Entries — extraBoxes', () => {
  it('Test 10: extraBoxes (btrt+pasp) are preserved verbatim', () => {
    // Build a synthetic btrt box (8+12=20 bytes)
    const btrt = new Uint8Array(20);
    const btrtView = new DataView(btrt.buffer);
    btrtView.setUint32(0, 20, false); // size
    btrt[4] = 0x62;
    btrt[5] = 0x74;
    btrt[6] = 0x72;
    btrt[7] = 0x74; // 'btrt'
    btrtView.setUint32(8, 500000, false); // bufferSizeDB
    btrtView.setUint32(12, 2000000, false); // maxBitrate
    btrtView.setUint32(16, 1500000, false); // avgBitrate

    // Build a synthetic pasp box (8+8=16 bytes)
    const pasp = new Uint8Array(16);
    const paspView = new DataView(pasp.buffer);
    paspView.setUint32(0, 16, false); // size
    pasp[4] = 0x70;
    pasp[5] = 0x61;
    pasp[6] = 0x73;
    pasp[7] = 0x70; // 'pasp'
    paspView.setUint32(8, 1, false); // hSpacing
    paspView.setUint32(12, 1, false); // vSpacing

    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
      [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
    );
    const box = buildAvcSampleEntry('avc1', 1920, 1080, avcC, [btrt, pasp]);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });

    // extraBoxes should contain btrt + pasp bytes.
    expect(entry.extraBoxes.length).toBe(btrt.length + pasp.length);
    // Verify btrt box type in extraBoxes.
    expect(entry.extraBoxes[4]).toBe(0x62); // 'b'
    expect(entry.extraBoxes[5]).toBe(0x74); // 't'
  });

  it('Test 10b: single extraBox (btrt only) takes the length===1 code path', () => {
    // This covers the extraParts.length === 1 branch in parseVisualSampleEntry.
    const btrt = new Uint8Array(20);
    const btrtView = new DataView(btrt.buffer);
    btrtView.setUint32(0, 20, false);
    btrt[4] = 0x62;
    btrt[5] = 0x74;
    btrt[6] = 0x72;
    btrt[7] = 0x74; // 'btrt'

    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
      [new Uint8Array([0x68])],
    );
    const box = buildAvcSampleEntry('avc1', 1280, 720, avcC, [btrt]);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });
    expect(entry.extraBoxes.length).toBe(btrt.length);
    expect(entry.extraBoxes[4]).toBe(0x62); // 'b' of 'btrt'
  });
});

// ---------------------------------------------------------------------------
// Test 11: Round-trip each codec (6 cases)
// ---------------------------------------------------------------------------

describe('Video Sample Entries — round-trip', () => {
  it('Test 11a: avc1 round-trip is byte-identical', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
      [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
    );
    const original = buildAvcSampleEntry('avc1', 1280, 720, avcC);
    const parsed = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });

  it('Test 11b: avc3 round-trip is byte-identical', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xc0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xc0, 0x1e])],
      [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
    );
    const original = buildAvcSampleEntry('avc3', 640, 480, avcC);
    const parsed = parseVisualSampleEntry('avc3', extractVisualPayload('avc3', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });

  it('Test 11c: hev1 round-trip is byte-identical', () => {
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, new Uint8Array(6), 93, [
      { type: 33, nalus: [new Uint8Array([0x42, 0x01])] },
    ]);
    const original = buildHevcSampleEntry('hev1', 1920, 1080, hvcC);
    const parsed = parseVisualSampleEntry('hev1', extractVisualPayload('hev1', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });

  it('Test 11d: hvc1 round-trip is byte-identical', () => {
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, new Uint8Array(6), 93, [
      { type: 33, nalus: [new Uint8Array([0x42, 0x01])] },
    ]);
    const original = buildHevcSampleEntry('hvc1', 1280, 720, hvcC);
    const parsed = parseVisualSampleEntry('hvc1', extractVisualPayload('hvc1', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });

  it('Test 11e: vp09 round-trip is byte-identical', () => {
    const vpcC = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1);
    const original = buildVp09SampleEntry(1280, 720, vpcC);
    const parsed = parseVisualSampleEntry('vp09', extractVisualPayload('vp09', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });

  it('Test 11f: av01 round-trip is byte-identical', () => {
    const av1C = buildAv1CPayload(0, 4, 0, 0, 0, 0, 1, 1, 0, 0, 0, new Uint8Array([0xaa, 0xbb]));
    const original = buildAv01SampleEntry(1280, 720, av1C);
    const parsed = parseVisualSampleEntry('av01', extractVisualPayload('av01', original), {
      value: 0,
    });
    const serialized = serializeVisualSampleEntry(parsed);
    expect(serialized).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Tests 12–15: Exact codec string values
// ---------------------------------------------------------------------------

describe('Codec string derivation', () => {
  it('Test 12: codec string avc1.42e01e (baseline level 30)', () => {
    const cfg = parseAvcC(
      buildAvcCPayload(0x42, 0xe0, 0x1e, 3, [new Uint8Array([0x67])], [new Uint8Array([0x68])]),
    );
    expect(deriveVideoCodecString('avc1', cfg)).toBe('avc1.42e01e');
  });

  it('Test 13: codec string hvc1.1.6.L93.B0', () => {
    // profile_space=0, tier=0 (L), profile_idc=1, compat_flags bit 1 set → reversed has bit 30 set → 0x40000000 reversed
    // generalProfileCompatibilityFlags = 0x40000000: reversed = 0x00000002 → hex = '2' but... let's think:
    // bit 1 of 0x40000000: bit positions are 31..0. 0x40000000 = bit 30 set.
    // reversed: bit 30 becomes bit 1 → 0x00000002 → hex '2' → stripped trailing zeros → '2'
    // Wait: the constraint byte B0 means constraint_flags[0] = 0xB0.
    const constraintFlags = new Uint8Array([0xb0, 0x00, 0x00, 0x00, 0x00, 0x00]);
    // compat_flags = 0x60000000 reversed:
    // 0x60000000 = 0110 0000 0000 0000 0000 0000 0000 0000
    // reversed  = 0000 0000 0000 0000 0000 0000 0000 0110 = 0x00000006 → hex '6'
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, constraintFlags, 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toBe('hvc1.1.6.L93.b0');
  });

  it('Test 14: codec string vp09.00.10.08.01.01.01.01.00', () => {
    const vpcC = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1);
    const cfg = parseVpcC(vpcC);
    expect(deriveVideoCodecString('vp09', cfg)).toBe('vp09.00.10.08.01.01.01.01.00');
  });

  it('Test 15: codec string av01.0.04M.08', () => {
    const av1C = buildAv1CPayload(0, 4, 0, 0, 0, 0, 1, 1, 0, 0, 0);
    const cfg = parseAv1C(av1C);
    expect(deriveVideoCodecString('av01', cfg)).toBe('av01.0.04M.08');
  });
});

// ---------------------------------------------------------------------------
// Tests 16–24: Rejection tests
// ---------------------------------------------------------------------------

describe('Video Sample Entries — rejection', () => {
  // Test 16: Reject avcC version=2
  it('Test 16: rejects avcC with configurationVersion=2', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67])],
      [new Uint8Array([0x68])],
    );
    avcC[0] = 2; // corrupt version
    expect(() => parseAvcC(avcC)).toThrow(Mp4AvcCBadVersionError);
  });

  // Test 17: Reject avcC lengthSizeMinusOne=2
  it('Test 17: rejects avcC with lengthSizeMinusOne=2', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67])],
      [new Uint8Array([0x68])],
    );
    // byte[4] = 0b111111xx — set to 0b111111_10 = 0xFE
    avcC[4] = 0xfe;
    expect(() => parseAvcC(avcC)).toThrow(Mp4AvcCBadLengthSizeError);
  });

  // Test 18: Reject avcC NAL length overrun
  it('Test 18: rejects avcC with NAL unit length that overruns payload', () => {
    // Build an avcC where the SPS length field claims 200 bytes but only 4 are present.
    const avcC = new Uint8Array(12);
    avcC[0] = 1; // version
    avcC[1] = 0x42;
    avcC[2] = 0xe0;
    avcC[3] = 0x1e;
    avcC[4] = 0xff; // lengthSizeMinusOne=3
    avcC[5] = 0xe1; // numSPS=1
    // SPS length = 200 (0x00C8) — way beyond remaining bytes
    avcC[6] = 0x00;
    avcC[7] = 0xc8;
    // Only 4 bytes remain for SPS, not 200
    expect(() => parseAvcC(avcC)).toThrow(Mp4AvcCNalLengthError);
  });

  // Test 19: Reject vpcC version=0
  it('Test 19: rejects vpcC with version=0', () => {
    const vpcC = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1);
    vpcC[0] = 0; // corrupt version to 0
    expect(() => parseVpcC(vpcC)).toThrow(Mp4VpcCBadVersionError);
  });

  // Test 20: Reject av1C marker=0
  it('Test 20: rejects av1C with marker bit=0', () => {
    const av1C = buildAv1CPayload(0, 4, 0, 0, 0, 0, 1, 1, 0, 0, 0);
    av1C[0] = 0x01; // marker=0, version=1 — invalid
    expect(() => parseAv1C(av1C)).toThrow(Mp4Av1CBadMarkerError);
  });

  // Test 21: Reject width=20000
  it('Test 21: rejects VisualSampleEntry with width=20000 > MAX_VIDEO_DIMENSION', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67])],
      [new Uint8Array([0x68])],
    );
    const box = buildAvcSampleEntry('avc1', 20000, 720, avcC);
    const payload = extractVisualPayload('avc1', box);
    expect(() => parseVisualSampleEntry('avc1', payload, { value: 0 })).toThrow(
      Mp4VisualDimensionOutOfRangeError,
    );
  });

  // Test 22: Reject dvh1 4cc → Mp4UnsupportedVideoCodecError
  it('Test 22: rejects dvh1 sample entry with Mp4UnsupportedVideoCodecError via stsd', () => {
    // Build a stsd payload with a dvh1 sample entry of sufficient size.
    const dvh1Payload = new Uint8Array(100);
    const view = new DataView(dvh1Payload.buffer);
    view.setUint32(4, 1, false); // entry_count=1
    view.setUint32(8, 100 - 8, false); // entry size = 92
    dvh1Payload[12] = 0x64; // 'd'
    dvh1Payload[13] = 0x76; // 'v'
    dvh1Payload[14] = 0x68; // 'h'
    dvh1Payload[15] = 0x31; // '1' → 'dvh1'
    expect(() => parseStsd(dvh1Payload, new Uint8Array(0))).toThrow(Mp4UnsupportedVideoCodecError);
  });

  // Test 23: Reject visual entry without codec config
  it('Test 23: rejects avc1 entry missing avcC child box → Mp4AvcCMissingError', () => {
    // VisualSampleEntry with only the 78-byte header, no avcC child.
    const header = buildVisualSampleEntryHeader(1280, 720);
    // Manually wrap as avc1 box.
    const boxSize = 8 + header.length;
    const box = new Uint8Array(boxSize);
    const view = new DataView(box.buffer);
    view.setUint32(0, boxSize, false);
    box[4] = 0x61;
    box[5] = 0x76;
    box[6] = 0x63;
    box[7] = 0x31; // 'avc1'
    box.set(header, 8);
    const payload = extractVisualPayload('avc1', box);
    expect(() => parseVisualSampleEntry('avc1', payload, { value: 0 })).toThrow(
      Mp4AvcCMissingError,
    );
  });

  // Test 24: Payload too small
  it('Test 24: rejects VisualSampleEntry with payload < 78 bytes', () => {
    const tiny = new Uint8Array(40);
    expect(() => parseVisualSampleEntry('avc1', tiny, { value: 0 })).toThrow(
      Mp4VisualSampleEntryTooSmallError,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 24 extra: M4A regression — parseStsd still returns audio for mp4a
// ---------------------------------------------------------------------------

describe('M4A regression', () => {
  it('Test 24b: parseStsd on mp4a still returns kind=audio (M4A regression)', () => {
    const asc = new Uint8Array([0x12, 0x10]);

    // Build esds using correct descriptor framing (mirrors hdlr-stsd-mp4a.test.ts).
    function buildDescriptor24b(tag: number, payload: Uint8Array): Uint8Array {
      const out = new Uint8Array(2 + payload.length);
      out[0] = tag;
      out[1] = payload.length & 0x7f;
      out.set(payload, 2);
      return out;
    }
    function concatArrays24b(parts: Uint8Array[]): Uint8Array {
      const total = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    }
    function buildCorrectEsds(oti: number, ascBytes: Uint8Array): Uint8Array {
      const dsi = buildDescriptor24b(0x05, ascBytes);
      // DecoderConfigDescriptor body must be ≥13 bytes:
      // oti(1)+streamType(1)+bufferSize(3)+maxBitrate(4)+avgBitrate(4) = 13
      const dcFixed = new Uint8Array(13);
      dcFixed[0] = oti;
      dcFixed[1] = 0x15; // streamType = audio(0x15)
      const dcPayload = concatArrays24b([dcFixed, dsi]);
      const dc = buildDescriptor24b(0x04, dcPayload);
      const sl = buildDescriptor24b(0x06, new Uint8Array([0x02]));
      const esFixed = new Uint8Array([0x00, 0x01, 0x00]); // ES_ID + flags
      const esPayload = concatArrays24b([esFixed, dc, sl]);
      const es = buildDescriptor24b(0x03, esPayload);
      return concatArrays24b([new Uint8Array(4), es]); // version+flags prefix
    }

    const esdsPayload = buildCorrectEsds(0x40, asc);
    const esdsBoxSize = 8 + esdsPayload.length;
    const esdsBox = new Uint8Array(esdsBoxSize);
    const esdsView = new DataView(esdsBox.buffer);
    esdsView.setUint32(0, esdsBoxSize, false);
    esdsBox[4] = 0x65;
    esdsBox[5] = 0x73;
    esdsBox[6] = 0x64;
    esdsBox[7] = 0x73; // 'esds'
    esdsBox.set(esdsPayload, 8);

    const mp4aPayloadSize = 28 + esdsBoxSize;
    const mp4aBoxSize = 8 + mp4aPayloadSize;
    const mp4aBox = new Uint8Array(mp4aBoxSize);
    const mp4aView = new DataView(mp4aBox.buffer);
    mp4aView.setUint32(0, mp4aBoxSize, false);
    mp4aBox[4] = 0x6d;
    mp4aBox[5] = 0x70;
    mp4aBox[6] = 0x34;
    mp4aBox[7] = 0x61; // 'mp4a'
    mp4aView.setUint16(14, 1, false); // data_reference_index
    mp4aView.setUint16(24, 2, false); // channelCount
    mp4aView.setUint16(26, 16, false); // sampleSize
    mp4aView.setUint32(32, (44100 & 0xffff) << 16, false); // sampleRate Q16.16
    mp4aBox.set(esdsBox, 36);

    const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
    const stsdView = new DataView(stsdPayload.buffer);
    stsdView.setUint32(4, 1, false); // entry_count=1
    stsdPayload.set(mp4aBox, 8);

    const sampleEntry = parseStsd(stsdPayload, new Uint8Array(0));
    expect(sampleEntry.kind).toBe('audio');
    if (sampleEntry.kind !== 'audio') throw new Error('expected audio');
    expect(sampleEntry.entry.channelCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 25: iterateAudioSamples on video track → Mp4IterateWrongKindError
// ---------------------------------------------------------------------------

describe('Iterator wrong-kind guard', () => {
  it('Test 25: iterateAudioSamples on video track throws Mp4IterateWrongKindError', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67])],
      [new Uint8Array([0x68])],
    );
    const box = buildAvcSampleEntry('avc1', 1280, 720, avcC);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });

    const mockVideoTrack = {
      trackId: 1,
      handlerType: 'vide' as const,
      mediaHeader: { version: 0 as const, timescale: 90000, duration: 900000, language: 'und' },
      trackHeader: { version: 0 as const, flags: 3, trackId: 1, duration: 900000, volume: 0 },
      sampleEntry: { kind: 'video' as const, entry },
      sampleTable: {
        sampleCount: 0,
        sampleSizes: new Uint32Array(0),
        sampleOffsets: new Float64Array(0),
        sampleDeltas: new Uint32Array(0),
      },
      sttsEntries: [],
      stscEntries: [],
      chunkOffsets: [] as readonly number[],
      chunkOffsetVariant: 'stco' as const,
      editList: [] as const,
      syncSamples: null,
    };

    expect(() => {
      const gen = iterateAudioSamples(mockVideoTrack, new Uint8Array(0));
      gen.next();
    }).toThrow(Mp4IterateWrongKindError);
  });

  // Test 26: iterateVideoSamples returns correct isKeyframe from stss
  it('Test 26: iterateVideoSamples derives isKeyframe from stss (only sample 1 and 3 are keyframes)', () => {
    const avcC = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67])],
      [new Uint8Array([0x68])],
    );
    const box = buildAvcSampleEntry('avc1', 1280, 720, avcC);
    const entry = parseVisualSampleEntry('avc1', extractVisualPayload('avc1', box), { value: 0 });

    // 4 samples: keyframes at 1-based index 1 and 3 (i.e. 0-based 0 and 2)
    const syncSet = new Set([1, 3]);

    const sampleCount = 4;
    const sampleSizes = new Uint32Array([10, 10, 10, 10]);
    const sampleOffsets = new Float64Array([0, 10, 20, 30]);
    const sampleDeltas = new Uint32Array([3000, 3000, 3000, 3000]);

    const mockVideoTrack = {
      trackId: 1,
      handlerType: 'vide' as const,
      mediaHeader: { version: 0 as const, timescale: 90000, duration: 12000, language: 'und' },
      trackHeader: { version: 0 as const, flags: 3, trackId: 1, duration: 12000, volume: 0 },
      sampleEntry: { kind: 'video' as const, entry },
      sampleTable: { sampleCount, sampleSizes, sampleOffsets, sampleDeltas },
      sttsEntries: [{ sampleCount: 4, sampleDelta: 3000 }],
      stscEntries: [{ firstChunk: 1, samplesPerChunk: 4, sampleDescriptionIndex: 1 }],
      chunkOffsets: [0] as readonly number[],
      chunkOffsetVariant: 'stco' as const,
      editList: [] as const,
      syncSamples: syncSet as ReadonlySet<number>,
    };

    const fileBytes = new Uint8Array(40); // 4 × 10 bytes
    const samples = Array.from(iterateVideoSamples(mockVideoTrack, fileBytes));

    expect(samples).toHaveLength(4);
    expect(samples[0]?.isKeyframe).toBe(true); // 1-based=1 → in syncSet
    expect(samples[1]?.isKeyframe).toBe(false); // 1-based=2 → not in syncSet
    expect(samples[2]?.isKeyframe).toBe(true); // 1-based=3 → in syncSet
    expect(samples[3]?.isKeyframe).toBe(false); // 1-based=4 → not in syncSet
    expect(samples[0]?.kind).toBe('video');
    expect(samples[0]?.index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage boost — av1C / vpcC / hvcC / avcC error paths + codec strings
// ---------------------------------------------------------------------------

describe('Branch coverage — av1C error paths', () => {
  it('throws Mp4InvalidBoxError for av1C payload < 4 bytes', () => {
    expect(() => parseAv1C(new Uint8Array(3))).toThrow(Mp4InvalidBoxError);
  });
});

describe('Branch coverage — vpcC error paths', () => {
  it('throws Mp4InvalidBoxError for vpcC payload < 12 bytes', () => {
    expect(() => parseVpcC(new Uint8Array(11))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when vpcC initDataSize overruns payload', () => {
    // Build a vpcC with non-zero initData, then corrupt the size field to overrun.
    const base = buildVpcCPayload(0, 10, 8, 1, 0, 1, 1, 1, new Uint8Array(3));
    const corrupted = base.slice();
    // Corrupt initDataSize bytes [10..11] to 255 so it overruns the payload.
    corrupted[10] = 0x00;
    corrupted[11] = 0xff;
    expect(() => parseVpcC(corrupted)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Branch coverage — hvcC error paths', () => {
  it('throws Mp4HvcCBadLengthSizeError when lengthSizeMinusOne=2 (reserved)', () => {
    // Build a minimal 23-byte hvcC where byte 21 has bits [1:0] = 0b10 = 2.
    const payload = new Uint8Array(23);
    payload[0] = 1; // configurationVersion
    payload[21] = 0x02; // constantFrameRate=0, numTemporalLayers=0, temporalIdNested=0, lengthSizeMinusOne=2
    expect(() => parseHvcC(payload)).toThrow(Mp4HvcCBadLengthSizeError);
  });

  it('throws Mp4InvalidBoxError for hvcC array header truncated (no bytes after numOfArrays)', () => {
    // numOfArrays=1 at byte 22, but payload ends at 23 bytes → cursor(23) >= payload.length(23)
    const tight = new Uint8Array(23);
    tight[0] = 1; // configurationVersion
    tight[22] = 1; // numOfArrays = 1, but no array bytes follow
    expect(() => parseHvcC(tight)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for hvcC numNalus field truncated', () => {
    // Build a hvcC payload where numNalus u16 field is truncated.
    // typeByte at 23 → cursor=24. Need cursor+2 > payload.length → 24+2=26 > payload.length.
    // So payload.length must be 25 (only 1 byte at offset 24, not 2).
    const tight = new Uint8Array(25);
    tight[0] = 1; // configurationVersion
    tight[22] = 1; // numOfArrays = 1
    tight[23] = 0x20; // typeByte (VPS)
    // cursor=24, payload.length=25 → cursor+2=26 > 25 → truncated numNalus field
    expect(() => parseHvcC(tight)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for hvcC NAL unit length field truncated', () => {
    // numNalus=1, but no NAL length bytes. cursor+2 for NAL length must exceed payload.length.
    // typeByte at [23], numNalus u16 at [24..25] → cursor=26 after numNalus.
    // Need cursor+2=28 > payload.length → payload.length=27.
    const tight = new Uint8Array(27);
    tight[0] = 1;
    tight[22] = 1; // numOfArrays=1
    tight[23] = 0x20; // typeByte
    tight[24] = 0x00;
    tight[25] = 0x01; // numNalus=1
    // cursor=26, NAL length needs 2 bytes at [26..27], payload.length=27 → 26+2=28 > 27 → truncated
    expect(() => parseHvcC(tight)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for hvcC NAL unit overruns payload', () => {
    // Build hvcC where NAL length = 200 but only 2 bytes remain after length field.
    const out = new Uint8Array(30);
    out[0] = 1; // configurationVersion
    out[22] = 1; // numOfArrays = 1
    out[23] = 0x20; // VPS
    out[24] = 0x00;
    out[25] = 0x01; // numNalus = 1
    // NAL length = 200 at [26..27]
    out[26] = 0x00;
    out[27] = 0xc8; // 200
    // cursor becomes 28, cursor+200=228 > 30 → overrun
    expect(() => parseHvcC(out)).toThrow(Mp4InvalidBoxError);
  });
});

describe('Branch coverage — avcC high-profile extension error paths', () => {
  // Build a base avcC with profile=0x64 (High) so extension parsing triggers.
  function buildHighProfileAvcC(): Uint8Array {
    return buildAvcCPayload(
      0x64,
      0x00,
      0x1f,
      3,
      [new Uint8Array([0x67, 0x64, 0x00, 0x1f])],
      [new Uint8Array([0x68])],
    );
  }

  it('throws Mp4InvalidBoxError when avcC extension truncated at bit_depth_luma (1 ext byte)', () => {
    const avcC = buildHighProfileAvcC();
    const out = new Uint8Array(avcC.length + 1);
    out.set(avcC);
    out[avcC.length] = 0xff; // chromaFormat byte only — luma missing
    expect(() => parseAvcC(out)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when avcC extension truncated at bit_depth_chroma (2 ext bytes)', () => {
    const avcC = buildHighProfileAvcC();
    const out = new Uint8Array(avcC.length + 2);
    out.set(avcC);
    out[avcC.length] = 0xff; // chromaFormat
    out[avcC.length + 1] = 0xff; // bitDepthLuma — chroma missing
    expect(() => parseAvcC(out)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when avcC extension truncated at numSPSExt (3 ext bytes)', () => {
    const avcC = buildHighProfileAvcC();
    const out = new Uint8Array(avcC.length + 3);
    out.set(avcC);
    out[avcC.length] = 0xff; // chromaFormat
    out[avcC.length + 1] = 0xff; // bitDepthLuma
    out[avcC.length + 2] = 0xff; // bitDepthChroma — numSPSExt missing
    expect(() => parseAvcC(out)).toThrow(Mp4InvalidBoxError);
  });

  it('parses avcC with full extension including numSPSExt=0 (4 ext bytes — success)', () => {
    const avcC = buildHighProfileAvcC();
    const out = new Uint8Array(avcC.length + 4);
    out.set(avcC);
    out[avcC.length] = 0xfc; // chromaFormat = 0 (bits [1:0])
    out[avcC.length + 1] = 0xf8; // bitDepthLumaMinus8 = 0
    out[avcC.length + 2] = 0xf8; // bitDepthChromaMinus8 = 0
    out[avcC.length + 3] = 0x00; // numSPSExt = 0 — no ext entries
    const cfg = parseAvcC(out);
    expect(cfg.chromaFormat).toBe(0);
    expect(cfg.bitDepthLumaMinus8).toBe(0);
    expect(cfg.bitDepthChromaMinus8).toBe(0);
    expect(cfg.spsExt).not.toBeNull();
  });

  it('parses avcC with numSPSExt=1 (exercises spsExt loop)', () => {
    // Build High-profile avcC with numSPSExt=1 and a 3-byte SPS extension.
    const avcC = buildHighProfileAvcC();
    const spsExtData = new Uint8Array([0x01, 0x02, 0x03]); // 3-byte SPS ext
    // Extension: chromaFormat(1) + luma(1) + chroma(1) + numSPSExt(1) + extLen(2) + extData(3)
    const ext = new Uint8Array(4 + 2 + spsExtData.length);
    ext[0] = 0xfc; // chromaFormat
    ext[1] = 0xf8; // bitDepthLumaMinus8
    ext[2] = 0xf8; // bitDepthChromaMinus8
    ext[3] = 0x01; // numSPSExt = 1
    ext[4] = 0x00;
    ext[5] = 0x03; // extLen = 3
    ext.set(spsExtData, 6);
    const out = new Uint8Array(avcC.length + ext.length);
    out.set(avcC);
    out.set(ext, avcC.length);
    const cfg = parseAvcC(out);
    expect(cfg.spsExt).not.toBeNull();
    expect(cfg.spsExt?.length).toBe(1);
  });
});

describe('Branch coverage — AV1 codec string bit-depth branches', () => {
  it('derives av01.0.04M.12 for twelveBit=1', () => {
    const av1C = buildAv1CPayload(0, 4, 0, 1, 1, 0, 1, 1, 0, 0, 0);
    const cfg = parseAv1C(av1C);
    expect(deriveVideoCodecString('av01', cfg)).toBe('av01.0.04M.12');
  });

  it('derives av01.0.04M.10 for highBitdepth=1, twelveBit=0', () => {
    const av1C = buildAv1CPayload(0, 4, 0, 1, 0, 0, 1, 1, 0, 0, 0);
    const cfg = parseAv1C(av1C);
    expect(deriveVideoCodecString('av01', cfg)).toBe('av01.0.04M.10');
  });

  it('derives av01.0.04H.08 for seqTier0=1 (high tier)', () => {
    const av1C = buildAv1CPayload(0, 4, 1, 0, 0, 0, 1, 1, 0, 0, 0);
    const cfg = parseAv1C(av1C);
    expect(deriveVideoCodecString('av01', cfg)).toBe('av01.0.04H.08');
  });
});

describe('Branch coverage — HEVC codec string profile space A/B/C and constraint bytes', () => {
  it('encodes profile_space=1 as A prefix in hvc1 codec string', () => {
    // compat_flags=0 reversed=0 → '0'; tier=0; levelIdc=93; no constraints
    const hvcC = buildHvcCPayload(1, 0, 1, 0, new Uint8Array(6), 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toMatch(/^hvc1\.A1\./);
  });

  it('encodes profile_space=2 as B prefix', () => {
    const hvcC = buildHvcCPayload(2, 0, 1, 0, new Uint8Array(6), 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toMatch(/^hvc1\.B1\./);
  });

  it('encodes profile_space=3 as C prefix', () => {
    const hvcC = buildHvcCPayload(3, 0, 1, 0, new Uint8Array(6), 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toMatch(/^hvc1\.C1\./);
  });

  it('encodes high tier as H in codec string', () => {
    // tierFlag=1 → H
    const hvcC = buildHvcCPayload(0, 1, 1, 0x60000000, new Uint8Array(6), 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toContain('.H93');
  });

  it('includes non-zero constraint bytes in codec string', () => {
    // constraint indicator flags: [0xB0, 0x00, ...] → only 1 byte non-zero
    const constraintFlags = new Uint8Array([0xb0, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, constraintFlags, 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    // Should end with .b0 (constraint byte 0xB0 lowercase hex per WebCodecs spec)
    expect(s).toMatch(/\.b0$/);
  });

  it('handles compat_flags=0 producing "0" without padding', () => {
    const hvcC = buildHvcCPayload(0, 0, 1, 0x00000000, new Uint8Array(6), 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    // reversed(0) = 0, toString(16) = '0'
    expect(s).toContain('.0.');
  });
});

describe('Branch coverage — visual-sample-entry.ts missing config and single extra box', () => {
  it('throws Mp4VpcCMissingError for vp09 entry with no vpcC child box', () => {
    // Build a vp09 entry with only the 78-byte header, no vpcC.
    const header = buildVisualSampleEntryHeader(1280, 720);
    const boxSize = 8 + header.length;
    const box = new Uint8Array(boxSize);
    const view = new DataView(box.buffer);
    view.setUint32(0, boxSize, false);
    box[4] = 0x76;
    box[5] = 0x70;
    box[6] = 0x30;
    box[7] = 0x39; // 'vp09'
    box.set(header, 8);
    const payload = box.subarray(8);
    expect(() => parseVisualSampleEntry('vp09', payload, { value: 0 })).toThrow(
      Mp4VpcCMissingError,
    );
  });

  it('throws Mp4Av1CMissingError for av01 entry with no av1C child box', () => {
    const header = buildVisualSampleEntryHeader(1280, 720);
    const boxSize = 8 + header.length;
    const box = new Uint8Array(boxSize);
    const view = new DataView(box.buffer);
    view.setUint32(0, boxSize, false);
    box[4] = 0x61;
    box[5] = 0x76;
    box[6] = 0x30;
    box[7] = 0x31; // 'av01'
    box.set(header, 8);
    const payload = box.subarray(8);
    expect(() => parseVisualSampleEntry('av01', payload, { value: 0 })).toThrow(
      Mp4Av1CMissingError,
    );
  });
});

// ---------------------------------------------------------------------------
// F1 regression — HEVC constraint indicator hex is lowercase (WebCodecs §8.2)
// ---------------------------------------------------------------------------

describe('F1 regression — HEVC constraint indicator bytes are lowercase hex', () => {
  it('constraint indicator byte 0xAB produces lowercase "ab" not "AB"', () => {
    // 0xAB contains hex digit 'A' and 'B' — these must be lowercase per WebCodecs spec.
    // Byte at index 0 is 0xAB; index 1 is non-zero (0x10) so both bytes are emitted.
    const constraintFlags = new Uint8Array([0xab, 0x10, 0x00, 0x00, 0x00, 0x00]);
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, constraintFlags, 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    // Must contain 'ab' not 'AB' and '10' not '10' (digit-only, either case works same)
    expect(s).toContain('.ab.');
    expect(s).not.toContain('.AB.');
    expect(s).toContain('.10');
    expect(s).not.toMatch(/[A-F]/); // no uppercase hex anywhere in the codec string
  });

  it('constraint indicator byte 0xF0 produces lowercase "f0"', () => {
    const constraintFlags = new Uint8Array([0xf0, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, constraintFlags, 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    expect(s).toMatch(/\.f0$/);
    expect(s).not.toMatch(/\.F0$/);
  });
});

// ---------------------------------------------------------------------------
// F5 regression — compressorname Latin-1 round-trip
// ---------------------------------------------------------------------------

describe('F5 regression — compressorname Latin-1 byte preservation on round-trip', () => {
  it('round-trips a compressor name containing Latin-1 byte 0xE9 correctly', () => {
    // Build a VisualSampleEntry with compressorName containing char code 0xE9
    // (Latin-1 'é'). The parser decodes Latin-1, so compressorName[0] = 'é' (charCode 0xE9).
    // The serializer must write byte 0xE9 back, not UTF-8 0xC3 0xA9.

    // Build header bytes manually so byte 43 = 0xE9 (the first name char).
    const avcCPayload = buildAvcCPayload(
      0x42,
      0xe0,
      0x1e,
      3,
      [new Uint8Array([0x67, 0x42, 0xe0, 0x1e])],
      [new Uint8Array([0x68, 0xce, 0x38, 0x80])],
    );
    const box = buildAvcSampleEntry('avc1', 640, 480, avcCPayload);
    // box layout: size(4)+type(4)+payload; payload[42]=nameLen, payload[43..73]=name chars
    // Set nameLen=3, chars=[0xE9, 0x74, 0x65] ('é', 't', 'e')
    const payloadStart = 8;
    box[payloadStart + 42] = 3; // nameLen = 3
    box[payloadStart + 43] = 0xe9; // Latin-1 'é'
    box[payloadStart + 44] = 0x74; // 't'
    box[payloadStart + 45] = 0x65; // 'e'

    const payload = extractVisualPayload('avc1', box);
    const entry = parseVisualSampleEntry('avc1', payload, { value: 0 });

    // compressorName should decode 0xE9 as 'é' (Latin-1)
    expect(entry.compressorName.charCodeAt(0)).toBe(0xe9);
    expect(entry.compressorName.length).toBe(3);

    // Round-trip: serialized bytes at the name position must be identical
    const serialized = serializeVisualSampleEntry(entry);
    // Serialized: size(4)+type(4)+payload[0..]; nameLen at payload+42, name at payload+43
    expect(serialized[payloadStart + 42]).toBe(3); // nameLen preserved
    expect(serialized[payloadStart + 43]).toBe(0xe9); // Latin-1 byte preserved
    expect(serialized[payloadStart + 44]).toBe(0x74);
    expect(serialized[payloadStart + 45]).toBe(0x65);
  });
});

// ---------------------------------------------------------------------------
// F8 regression — HEVC profile_space A/B/C and multi-byte constraint indicator
// ---------------------------------------------------------------------------

describe('F8 regression — HEVC lastNonZero scan preserves non-zero byte at index 1', () => {
  it('emits both constraint bytes when index 0 is zero but index 1 is non-zero', () => {
    // lastNonZero scan: if constraintFlags = [0x00, 0x40, 0x00, ...] then lastNonZero=1
    // so we emit 2 constraint bytes: '00' and '40'.
    const constraintFlags = new Uint8Array([0x00, 0x40, 0x00, 0x00, 0x00, 0x00]);
    const hvcC = buildHvcCPayload(0, 0, 1, 0x60000000, constraintFlags, 93, []);
    const cfg = parseHvcC(hvcC);
    const s = deriveVideoCodecString('hvc1', cfg);
    // Must contain '.00.40' at the end (two constraint bytes)
    expect(s).toMatch(/\.00\.40$/);
  });
});
