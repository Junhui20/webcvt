import { describe, expect, it } from 'vitest';
import {
  type AvcParamSets,
  annexBToAvcc,
  avccToAnnexB,
  deriveAvcCodecString,
  removeEmulationPreventionBytes,
  splitAnnexBNalUnits,
  synthesiseAvcDecoderConfig,
} from './nal-conversion.ts';

// ---------------------------------------------------------------------------
// Annex-B split tests
// ---------------------------------------------------------------------------

describe('splitAnnexBNalUnits', () => {
  it('splits on 3-byte start codes (0x00 0x00 0x01)', () => {
    const payload = new Uint8Array([
      0x00,
      0x00,
      0x01,
      0x67,
      0x01,
      0x02, // SPS NAL
      0x00,
      0x00,
      0x01,
      0x68,
      0x03,
      0x04, // PPS NAL
    ]);
    const nals = splitAnnexBNalUnits(payload);
    expect(nals).toHaveLength(2);
    expect(nals[0]).toEqual(new Uint8Array([0x67, 0x01, 0x02]));
    expect(nals[1]).toEqual(new Uint8Array([0x68, 0x03, 0x04]));
  });

  it('splits on 4-byte start codes (0x00 0x00 0x00 0x01)', () => {
    const payload = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x01,
      0x67,
      0xaa,
      0xbb, // SPS NAL
      0x00,
      0x00,
      0x00,
      0x01,
      0x68,
      0xcc, // PPS NAL
    ]);
    const nals = splitAnnexBNalUnits(payload);
    expect(nals).toHaveLength(2);
    expect(nals[0]?.[0]).toBe(0x67);
    expect(nals[1]?.[0]).toBe(0x68);
  });

  it('does not confuse emulation prevention byte 0x00 0x00 0x03 with start codes (Trap #9)', () => {
    // A NAL containing 0x00 0x00 0x03 followed by the sync byte 0x47 (Trap §1 / §9)
    // This sequence inside a NAL should NOT be treated as a start code
    const payload = new Uint8Array([
      0x00,
      0x00,
      0x01,
      0x65, // IDR start code + NAL header
      0xaa,
      0xbb, // real NAL data
      0x00,
      0x00,
      0x03, // emulation prevention
      0x47, // sync byte inside NAL — NOT a start code
      0xcc,
    ]);
    // splitAnnexBNalUnits finds start codes, not emulation prevention bytes
    // The 0x00 0x00 0x03 should not be split on (0x03 != 0x01)
    const nals = splitAnnexBNalUnits(payload);
    expect(nals).toHaveLength(1);
    expect(nals[0]?.[0]).toBe(0x65);
  });

  it('returns empty array for payload with no start codes', () => {
    const payload = new Uint8Array([0x67, 0x01, 0x02, 0x03]);
    expect(splitAnnexBNalUnits(payload)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// annexBToAvcc tests
// ---------------------------------------------------------------------------

describe('annexBToAvcc', () => {
  it('converts Annex-B to AVCC with 4-byte length prefixes', () => {
    const spsNal = new Uint8Array([0x67, 0x42, 0x00, 0x1f, 0xab, 0xcd]);
    const ppsNal = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const idrNal = new Uint8Array([0x65, 0x88, 0x84, 0x00]);

    const payload = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x01,
      ...spsNal,
      0x00,
      0x00,
      0x00,
      0x01,
      ...ppsNal,
      0x00,
      0x00,
      0x00,
      0x01,
      ...idrNal,
    ]);

    const paramSets: AvcParamSets = { sps: null, pps: null };
    const { avcc, hasIdr } = annexBToAvcc(payload, paramSets);

    expect(hasIdr).toBe(true);
    expect(paramSets.sps).toBeTruthy();
    expect(paramSets.pps).toBeTruthy();

    // First 4 bytes = SPS length
    const spsLen = (avcc[0]! << 24) | (avcc[1]! << 16) | (avcc[2]! << 8) | avcc[3]!;
    expect(spsLen).toBe(spsNal.length);
  });

  it('detects IDR frame (NAL type 5) and sets hasIdr=true', () => {
    const idrNal = new Uint8Array([0x65, 0x00, 0x01]);
    const payload = new Uint8Array([0x00, 0x00, 0x01, ...idrNal]);
    const paramSets: AvcParamSets = { sps: null, pps: null };
    const { hasIdr } = annexBToAvcc(payload, paramSets);
    expect(hasIdr).toBe(true);
  });

  it('non-IDR frame has hasIdr=false', () => {
    const sliceNal = new Uint8Array([0x41, 0x00, 0x01]); // NAL type 1 = non-IDR slice
    const payload = new Uint8Array([0x00, 0x00, 0x01, ...sliceNal]);
    const paramSets: AvcParamSets = { sps: null, pps: null };
    const { hasIdr } = annexBToAvcc(payload, paramSets);
    expect(hasIdr).toBe(false);
  });

  it('returns empty AVCC for payload with no start codes', () => {
    const paramSets: AvcParamSets = { sps: null, pps: null };
    const { avcc } = annexBToAvcc(new Uint8Array([0x01, 0x02, 0x03]), paramSets);
    expect(avcc.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AVCC → Annex-B
// ---------------------------------------------------------------------------

describe('avccToAnnexB', () => {
  it('round-trips: Annex-B → AVCC → Annex-B', () => {
    const nal1 = new Uint8Array([0x67, 0x42, 0x00, 0x1f]);
    const nal2 = new Uint8Array([0x65, 0x88, 0x84]);

    // Build AVCC manually
    const avcc = new Uint8Array(4 + nal1.length + 4 + nal2.length);
    avcc[0] = 0;
    avcc[1] = 0;
    avcc[2] = 0;
    avcc[3] = nal1.length;
    avcc.set(nal1, 4);
    avcc[4 + nal1.length] = 0;
    avcc[5 + nal1.length] = 0;
    avcc[6 + nal1.length] = 0;
    avcc[7 + nal1.length] = nal2.length;
    avcc.set(nal2, 8 + nal1.length);

    const annexB = avccToAnnexB(avcc);
    // Should start with 4-byte start code
    expect(annexB[0]).toBe(0x00);
    expect(annexB[1]).toBe(0x00);
    expect(annexB[2]).toBe(0x00);
    expect(annexB[3]).toBe(0x01);
    expect(annexB[4]).toBe(0x67);
  });
});

// ---------------------------------------------------------------------------
// AVCDecoderConfigurationRecord synthesis
// ---------------------------------------------------------------------------

describe('synthesiseAvcDecoderConfig', () => {
  it('synthesises AVCDecoderConfigurationRecord from captured SPS + PPS', () => {
    const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]); // profile=100, compat=0, level=40
    const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]);

    const paramSets: AvcParamSets = { sps, pps };
    const record = synthesiseAvcDecoderConfig(paramSets);

    expect(record).not.toBeNull();
    expect(record?.[0]).toBe(0x01); // configurationVersion
    expect(record?.[1]).toBe(0x64); // AVCProfileIndication = sps[1] = 100 = 0x64
    expect(record?.[2]).toBe(0x00); // profile_compatibility = sps[2]
    expect(record?.[3]).toBe(0x28); // AVCLevelIndication = sps[3] = 40 = 0x28
    expect(record?.[4]).toBe(0xff); // reserved + lengthSizeMinusOne
    expect(record?.[5]).toBe(0xe1); // reserved + numSPS = 1
  });

  it('returns null when SPS is null', () => {
    const paramSets: AvcParamSets = { sps: null, pps: new Uint8Array([0x68]) };
    expect(synthesiseAvcDecoderConfig(paramSets)).toBeNull();
  });

  it('returns null when PPS is null', () => {
    const paramSets: AvcParamSets = { sps: new Uint8Array([0x67, 0x42, 0x00, 0x1f]), pps: null };
    expect(synthesiseAvcDecoderConfig(paramSets)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AVC codec string derivation
// ---------------------------------------------------------------------------

describe('deriveAvcCodecString', () => {
  it('derives correct codec string from SPS bytes', () => {
    // profile=100 (0x64), flags=0x00, level=40 (0x28) → avc1.640028
    const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]);
    expect(deriveAvcCodecString(sps)).toBe('avc1.640028');
  });

  it('derives codec string for Baseline profile', () => {
    // profile=66 (0x42), flags=0xc0, level=30 (0x1e) → avc1.42c01e
    const sps = new Uint8Array([0x67, 0x42, 0xc0, 0x1e]);
    expect(deriveAvcCodecString(sps)).toBe('avc1.42c01e');
  });

  it('returns null for SPS shorter than 4 bytes', () => {
    expect(deriveAvcCodecString(new Uint8Array([0x67, 0x42]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Emulation prevention byte removal (Trap #9)
// ---------------------------------------------------------------------------

describe('removeEmulationPreventionBytes', () => {
  it('removes 0x03 from 0x00 0x00 0x03 sequences', () => {
    const input = new Uint8Array([0x00, 0x00, 0x03, 0x01, 0xaa, 0xbb]);
    const result = removeEmulationPreventionBytes(input);
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x01, 0xaa, 0xbb]));
  });

  it('does not remove 0x03 in other contexts', () => {
    const input = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = removeEmulationPreventionBytes(input);
    expect(result).toEqual(input);
  });

  it('handles multiple emulation prevention bytes', () => {
    // [00 00 03 00 00 00 03 02]: EPB at index 2 and index 6
    // After first EPB removal: output [00,00], continue at 3
    // After second EPB removal at 4..6: output [00,00,00], continue at 7
    // Final byte 02 appended
    const input = new Uint8Array([0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x03, 0x02]);
    const result = removeEmulationPreventionBytes(input);
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x02]));
  });
});
