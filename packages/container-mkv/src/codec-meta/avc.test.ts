/**
 * Tests for AVCDecoderConfigurationRecord parser (avc.ts).
 */

import { describe, expect, it } from 'vitest';
import { MkvInvalidCodecPrivateError } from '../errors.ts';
import { parseAvcDecoderConfig } from './avc.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid AVCDecoderConfigurationRecord.
 * Layout: [configVersion=1, profile, compat, level, 0xFF, numSPS|0xE0, ...SPS, numPPS, ...PPS]
 */
function buildAvcRecord(
  profile: number,
  compat: number,
  level: number,
  spsNalus: Uint8Array[] = [],
  ppsNalus: Uint8Array[] = [],
): Uint8Array {
  const parts: number[] = [
    1, // configurationVersion
    profile,
    compat,
    level,
    0xff, // reserved | lengthSizeMinusOne=3
    0xe0 | spsNalus.length, // reserved | numSPS
  ];

  for (const sps of spsNalus) {
    parts.push((sps.length >> 8) & 0xff, sps.length & 0xff);
    parts.push(...Array.from(sps));
  }

  parts.push(ppsNalus.length); // numPPS
  for (const pps of ppsNalus) {
    parts.push((pps.length >> 8) & 0xff, pps.length & 0xff);
    parts.push(...Array.from(pps));
  }

  return new Uint8Array(parts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAvcDecoderConfig', () => {
  it('returns avc1.640028 for High Profile L4.0 with no NALUs', () => {
    // profile=0x64 (100 = High), compat=0x00, level=0x28 (40)
    const record = buildAvcRecord(0x64, 0x00, 0x28);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.640028');
  });

  it('returns avc1.42001f for Baseline Profile L3.1', () => {
    // profile=0x42 (66 = Baseline), compat=0x00, level=0x1f (31)
    const record = buildAvcRecord(0x42, 0x00, 0x1f);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.42001f');
  });

  it('pads hex values to 2 characters (profile=1 → 01)', () => {
    const record = buildAvcRecord(0x01, 0x00, 0x01);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.010001');
  });

  it('includes compat byte in codec string', () => {
    const record = buildAvcRecord(0x64, 0xc0, 0x28);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.64c028');
  });

  it('parses record with one SPS NALU', () => {
    const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac]); // 5-byte SPS
    const record = buildAvcRecord(0x64, 0x00, 0x28, [sps]);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.640028');
  });

  it('parses record with one SPS and one PPS NALU', () => {
    const sps = new Uint8Array([0x67, 0x42, 0xc0, 0x1e]);
    const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const record = buildAvcRecord(0x42, 0xc0, 0x1e, [sps], [pps]);
    expect(parseAvcDecoderConfig(record)).toBe('avc1.42c01e');
  });

  it('throws MkvInvalidCodecPrivateError for too-short input (< 6 bytes)', () => {
    expect(() => parseAvcDecoderConfig(new Uint8Array([0x01, 0x64, 0x00]))).toThrow(
      MkvInvalidCodecPrivateError,
    );
  });

  it('throws MkvInvalidCodecPrivateError for configVersion != 1', () => {
    const record = new Uint8Array([0x02, 0x64, 0x00, 0x28, 0xff, 0xe0]);
    expect(() => parseAvcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when numSPS exceeds cap (32)', () => {
    // numSPS field = 33 (> 32 cap)
    const record = new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe0 | 33]);
    expect(() => parseAvcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when SPS array is truncated', () => {
    // numSPS=1, then only 1 byte (should be 2-byte length + data)
    const record = new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00]);
    expect(() => parseAvcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when SPS NAL extends beyond record', () => {
    // numSPS=1, length=100 but no data follows
    const record = new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x64]);
    expect(() => parseAvcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when numPPS exceeds cap (32)', () => {
    // numSPS=0, numPPS=33
    const record = new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe0, 33]);
    expect(() => parseAvcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('handles empty byte array (< 6 bytes) with error', () => {
    expect(() => parseAvcDecoderConfig(new Uint8Array(0))).toThrow(MkvInvalidCodecPrivateError);
  });
});
