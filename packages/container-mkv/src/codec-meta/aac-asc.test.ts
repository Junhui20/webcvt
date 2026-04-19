/**
 * Tests for AudioSpecificConfig parser (aac-asc.ts).
 */

import { describe, expect, it } from 'vitest';
import { MkvInvalidCodecPrivateError } from '../errors.ts';
import { parseAacAsc } from './aac-asc.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal 2-byte AudioSpecificConfig.
 *
 * Bit layout: aot(5) | samplingFreqIndex(4) | channelConfig(4) | ...
 * byte0 = (aot << 3) | (sfi >> 1)
 * byte1 = ((sfi & 1) << 7) | (cc << 3)
 */
function buildAsc(aot: number, sfi = 3, channelConfig = 2): Uint8Array {
  const byte0 = ((aot & 0x1f) << 3) | ((sfi >> 1) & 0x07);
  const byte1 = ((sfi & 0x01) << 7) | ((channelConfig & 0x0f) << 3);
  return new Uint8Array([byte0, byte1]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAacAsc', () => {
  it('returns mp4a.40.2 for AAC-LC (AOT=2)', () => {
    expect(parseAacAsc(buildAsc(2))).toBe('mp4a.40.2');
  });

  it('returns mp4a.40.5 for HE-AAC (AOT=5)', () => {
    expect(parseAacAsc(buildAsc(5))).toBe('mp4a.40.5');
  });

  it('returns mp4a.40.29 for HE-AACv2 (AOT=29)', () => {
    expect(parseAacAsc(buildAsc(29))).toBe('mp4a.40.29');
  });

  it('returns mp4a.40.1 for AAC-Main (AOT=1)', () => {
    expect(parseAacAsc(buildAsc(1))).toBe('mp4a.40.1');
  });

  it('handles extended AOT 31 → reads 6 more bits → aot=32+ext', () => {
    // aot=31 (extended), ext6 bits = 0 → final aot = 32
    // byte0: (31 << 3) | (sfi >> 1) = 0xF8 | 0x01 = 0xF9  (sfi=3 → 011 → >>1 = 01 → 0xF9)
    // Actually: byte0 = (31 << 3) | (3 >> 1) = 0xF8 | 0x01 = 0xF9
    // byte1: (3 & 1) << 7 = 0x80, then ext6 bits = 0 → ((byte0 & 0x07) << 3) | ((byte1 >> 5) & 0x07)
    //   byte0 & 0x07 = 0x01 (sfi high), byte1 >> 5 = 0x04 (3 & 1 = 1, then 0x80 >> 5 = 4)
    // This is a bit complex. Let's use a direct bit pattern:
    // aot=31 → byte0 bits[7:3] = 11111
    // ext6: bits[2:0] of byte0 + bits[7:5] of byte1
    // for ext6=0: bits[2:0] of byte0 = 000, bits[7:5] of byte1 = 000
    // byte0 = 0b11111000 = 0xF8
    // byte1 = 0b00000000 = 0x00
    // Final aot = 32 + 0 = 32
    const asc = new Uint8Array([0xf8, 0x00]);
    expect(parseAacAsc(asc)).toBe('mp4a.40.32');
  });

  it('handles extended AOT 31 with ext6=1 → aot=33', () => {
    // ext6=1: bits[2:0] of byte0 = 000, bits[7:5] of byte1 = 001
    // byte0 = 0xF8 (aot=31, lower bits=000)
    // byte1 = 0b00100000 = 0x20 (bits[7:5] = 001)
    // ext6 = (0 << 3) | 1 = 1
    const asc = new Uint8Array([0xf8, 0x20]);
    expect(parseAacAsc(asc)).toBe('mp4a.40.33');
  });

  it('throws MkvInvalidCodecPrivateError for input shorter than 2 bytes', () => {
    expect(() => parseAacAsc(new Uint8Array([0x12]))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError for empty input', () => {
    expect(() => parseAacAsc(new Uint8Array(0))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError for AOT=0 (invalid)', () => {
    // byte0[7:3] = 00000 → aot = 0
    expect(() => parseAacAsc(new Uint8Array([0x00, 0x10]))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('handles AOT=31 at max extension (all 6 bits set → aot=32+63=95)', () => {
    // aot=31 → byte0 bits[7:3] = 11111
    // ext6=63 (all ones): bits[2:0] of byte0 = 111, bits[7:5] of byte1 = 111
    // byte0 = 0b11111111 = 0xFF
    // byte1 = 0b11100000 = 0xE0
    const asc = new Uint8Array([0xff, 0xe0]);
    expect(parseAacAsc(asc)).toBe('mp4a.40.95');
  });

  it('accepts a longer ASC (more than 2 bytes)', () => {
    // Extra bytes should be ignored; AOT=2 is in first 5 bits
    const asc = new Uint8Array([0x10, 0x00, 0x00]);
    expect(parseAacAsc(asc)).toBe('mp4a.40.2');
  });
});
