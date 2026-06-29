/**
 * Tests for codec-meta/av1c.ts — AV1 (V_AV01) codec-string derivation.
 *
 * Spec: AV1 ISOBMFF binding v1.2.0 §2.3; WebCodecs "av01.P.LLT.BD".
 */

import { describe, expect, it } from 'vitest';
import { MkvInvalidCodecPrivateError } from '../errors.ts';
import { parseAv1CodecString } from './av1c.ts';

describe('parseAv1CodecString', () => {
  it('derives av01 for profile 0, level 4, main tier, 8-bit', () => {
    // b0=0x81 marker+version; b1=(0<<5)|4=0x04; b2=0x00 (tier0=0, 8-bit); b3=0.
    expect(parseAv1CodecString(new Uint8Array([0x81, 0x04, 0x00, 0x00]))).toBe('av01.0.04M.08');
  });

  it('encodes high tier + 10-bit with profile 1, level 8', () => {
    // b1=(1<<5)|8=0x28; b2: tier0=1 (0x80) | high_bitdepth=1 (0x40) = 0xC0.
    expect(parseAv1CodecString(new Uint8Array([0x81, 0x28, 0xc0, 0x00]))).toBe('av01.1.08H.10');
  });

  it('encodes 12-bit (twelve_bit flag overrides high_bitdepth)', () => {
    // b2: twelve_bit=1 (bit5 = 0x20).
    expect(parseAv1CodecString(new Uint8Array([0x81, 0x00, 0x20, 0x00]))).toBe('av01.0.00M.12');
  });

  it('throws on a record shorter than 4 bytes', () => {
    expect(() => parseAv1CodecString(new Uint8Array([0x81, 0x00]))).toThrow(
      MkvInvalidCodecPrivateError,
    );
  });

  it('throws when the marker bit is not set', () => {
    expect(() => parseAv1CodecString(new Uint8Array([0x01, 0x04, 0x00, 0x00]))).toThrow(
      MkvInvalidCodecPrivateError,
    );
  });
});
