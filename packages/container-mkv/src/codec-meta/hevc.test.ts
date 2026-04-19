/**
 * Tests for HEVCDecoderConfigurationRecord parser (hevc.ts).
 */

import { describe, expect, it } from 'vitest';
import { MkvInvalidCodecPrivateError } from '../errors.ts';
import { parseHevcDecoderConfig } from './hevc.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid HEVCDecoderConfigurationRecord (23-byte header, no arrays).
 *
 * Byte layout (ISO 14496-15 §8.3.3):
 *   byte 0:  configurationVersion = 1
 *   byte 1:  general_profile_space(2) | general_tier_flag(1) | general_profile_idc(5)
 *   bytes 2-5:  general_profile_compatibility_flags (32 bits)
 *   bytes 6-11: general_constraint_indicator_flags (48 bits)
 *   byte 12: general_level_idc
 *   bytes 13-22: remaining fixed fields
 *   byte 22: numOfArrays
 */
function buildHevcRecord(
  profileSpace: number,
  tierFlag: number,
  profileIdc: number,
  compatFlags: number,
  constraintByte: number,
  levelIdc: number,
  numOfArrays = 0,
  arrays: Array<{ type: number; nalus: Uint8Array[] }> = [],
): Uint8Array {
  const byte1 = ((profileSpace & 0x03) << 6) | ((tierFlag & 0x01) << 5) | (profileIdc & 0x1f);
  const header = new Uint8Array(23);
  header[0] = 1; // configurationVersion
  header[1] = byte1;
  header[2] = (compatFlags >> 24) & 0xff;
  header[3] = (compatFlags >> 16) & 0xff;
  header[4] = (compatFlags >> 8) & 0xff;
  header[5] = compatFlags & 0xff;
  header[6] = constraintByte;
  // bytes 7-11: zero (remaining constraint bytes)
  header[12] = levelIdc;
  // bytes 13-21: zero (other fields)
  header[22] = numOfArrays;

  const arrayParts: number[] = [];
  for (const arr of arrays) {
    arrayParts.push(arr.type & 0x3f); // array_completeness | reserved | NAL_unit_type
    arrayParts.push((arr.nalus.length >> 8) & 0xff, arr.nalus.length & 0xff); // numNalus
    for (const nal of arr.nalus) {
      arrayParts.push((nal.length >> 8) & 0xff, nal.length & 0xff);
      arrayParts.push(...Array.from(nal));
    }
  }

  const result = new Uint8Array(23 + arrayParts.length);
  result.set(header, 0);
  result.set(new Uint8Array(arrayParts), 23);
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseHevcDecoderConfig', () => {
  it('returns hev1.1.00000006.L93.B0 for Main Profile L3.1 no tier (Q-H-2)', () => {
    // profileSpace=0, tierFlag=0 (main tier → 'L'), profileIdc=1, compatFlags=0x00000006,
    // constraintByte=0, level=93. compatHex padded to 8 digits → "00000006".
    const record = buildHevcRecord(0, 0, 1, 0x00000006, 0x00, 93);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.1.00000006.L93.B0');
  });

  it('returns H prefix (not LH) for high-tier codec string when tierFlag=1 (Q-H-2a)', () => {
    // tier_flag=1 → high tier → level prefix MUST be 'H', not 'LH'.
    const record = buildHevcRecord(0, 1, 1, 0x00000006, 0x00, 120);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.1.00000006.H120.B0');
  });

  it('returns hev1.1.00000060.H120.B0 for high-tier Main10 L4.0 with compat 0x60 (Q-H-2 regression)', () => {
    // Regression: high-tier Main10 at level 4.0 (levelIdc=120), compat flags=0x60000000
    // in wire byte order (big-endian: bytes 2-5 = 0x60,0x00,0x00,0x00).
    // The 32-bit compatFlags value read big-endian = 0x60000000.
    // padStart(8,'0') → "60000000".  tier_flag=1 → 'H'.
    const record = buildHevcRecord(0, 1, 1, 0x60000000, 0x00, 120);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.1.60000000.H120.B0');
  });

  it('pads compatHex to 8 digits when value has fewer than 8 hex digits (Q-H-2b)', () => {
    // compatFlags=0x00000060 → without padding would emit "60"; with padStart(8,'0') → "00000060"
    const record = buildHevcRecord(0, 0, 1, 0x00000060, 0x00, 93);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.1.00000060.L93.B0');
  });

  it('returns profile space letter A for profileSpace=1 (Q-H-2 compat)', () => {
    const record = buildHevcRecord(1, 0, 2, 0x00000004, 0x00, 60);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.A2.00000004.L60.B0');
  });

  it('returns profile space letter B for profileSpace=2 (Q-H-2 compat)', () => {
    const record = buildHevcRecord(2, 0, 1, 0x00000000, 0x90, 60);
    const result = parseHevcDecoderConfig(record);
    expect(result).toBe('hev1.B1.00000000.L60.B90');
  });

  it('includes constraint byte in hex in codec string', () => {
    const record = buildHevcRecord(0, 0, 1, 0x00000000, 0xb0, 90);
    const result = parseHevcDecoderConfig(record);
    expect(result).toContain('Bb0');
  });

  it('parses record with one VPS array (1 NALU)', () => {
    const vpsData = new Uint8Array(12).fill(0xaa);
    const record = buildHevcRecord(0, 0, 1, 0x06, 0x00, 90, 1, [{ type: 0x20, nalus: [vpsData] }]);
    expect(() => parseHevcDecoderConfig(record)).not.toThrow();
    expect(parseHevcDecoderConfig(record)).toMatch(/^hev1\./);
  });

  it('throws MkvInvalidCodecPrivateError for input shorter than 23 bytes', () => {
    expect(() => parseHevcDecoderConfig(new Uint8Array(22))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError for empty input', () => {
    expect(() => parseHevcDecoderConfig(new Uint8Array(0))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when configVersion != 1', () => {
    const record = buildHevcRecord(0, 0, 1, 0, 0, 90);
    record[0] = 2; // override configurationVersion
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when numOfArrays exceeds cap (8)', () => {
    const record = buildHevcRecord(0, 0, 1, 0, 0, 90, 9); // 9 > cap of 8
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when array header is truncated', () => {
    // numOfArrays=1 but no array data follows
    const record = new Uint8Array(23);
    record[0] = 1;
    record[22] = 1; // numOfArrays=1 but payload stops here
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when numNalus in array exceeds cap (64)', () => {
    // Build record with numOfArrays=1, numNalus=65
    const record = new Uint8Array(26);
    record[0] = 1;
    record[22] = 1; // numOfArrays=1
    record[23] = 0x20; // array type
    record[24] = 0x00; // numNalus high byte
    record[25] = 65; // numNalus = 65 > cap
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when NAL unit missing length field', () => {
    // numOfArrays=1, numNalus=1 but no nal length follows
    const record = new Uint8Array(26);
    record[0] = 1;
    record[22] = 1; // numOfArrays=1
    record[23] = 0x20; // array type
    record[24] = 0x00;
    record[25] = 0x01; // numNalus=1 but no length bytes follow
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when NAL unit extends beyond record', () => {
    // numOfArrays=1, numNalus=1, nalLen=100 but no data follows
    const record = new Uint8Array(28);
    record[0] = 1;
    record[22] = 1;
    record[23] = 0x20;
    record[24] = 0x00;
    record[25] = 0x01; // numNalus=1
    record[26] = 0x00;
    record[27] = 0x64; // nalLen=100 (extends beyond)
    expect(() => parseHevcDecoderConfig(record)).toThrow(MkvInvalidCodecPrivateError);
  });
});
