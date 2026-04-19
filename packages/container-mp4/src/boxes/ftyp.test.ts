/**
 * Tests for boxes/ftyp.ts — ftyp box parser and brand recognition.
 *
 * Design note test cases covered:
 *   - "parses ftyp box and recognises mp42 / isom / M4A  brands"
 *   - "rejects fragmented MP4 brand (iso5) with Mp4UnsupportedBrandError"
 */

import { describe, expect, it } from 'vitest';
import { Mp4UnsupportedBrandError } from '../errors.ts';
import { isAcceptedBrand, parseFtyp, serializeFtyp } from './ftyp.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeBrand(brand: string): Uint8Array {
  const b = new Uint8Array(4);
  for (let i = 0; i < 4; i++) b[i] = brand.charCodeAt(i) & 0xff;
  return b;
}

function buildFtypPayload(major: string, minor: number, compatible: string[]): Uint8Array {
  const size = 8 + compatible.length * 4;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  buf.set(encodeBrand(major), 0);
  view.setUint32(4, minor, false);
  let off = 8;
  for (const brand of compatible) {
    buf.set(encodeBrand(brand), off);
    off += 4;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseFtyp', () => {
  it('parses M4A  major brand correctly', () => {
    const payload = buildFtypPayload('M4A ', 0, ['isom', 'mp42']);
    const ftyp = parseFtyp(payload);
    expect(ftyp.majorBrand).toBe('M4A ');
    expect(ftyp.minorVersion).toBe(0);
    expect(ftyp.compatibleBrands).toContain('isom');
    expect(ftyp.compatibleBrands).toContain('mp42');
  });

  it('parses mp42 major brand correctly', () => {
    const payload = buildFtypPayload('mp42', 0, ['isom', 'M4A ']);
    const ftyp = parseFtyp(payload);
    expect(ftyp.majorBrand).toBe('mp42');
  });

  it('parses isom major brand correctly', () => {
    const payload = buildFtypPayload('isom', 512, ['iso2', 'avc1', 'mp41']);
    const ftyp = parseFtyp(payload);
    expect(ftyp.majorBrand).toBe('isom');
    expect(ftyp.minorVersion).toBe(512);
  });

  it('rejects iso5 major brand with Mp4UnsupportedBrandError', () => {
    const payload = buildFtypPayload('iso5', 0, []);
    expect(() => parseFtyp(payload)).toThrow(Mp4UnsupportedBrandError);
  });

  it('rejects iso6 compatible brand with Mp4UnsupportedBrandError', () => {
    const payload = buildFtypPayload('isom', 0, ['iso5', 'iso6']);
    expect(() => parseFtyp(payload)).toThrow(Mp4UnsupportedBrandError);
  });

  it('rejects dash compatible brand with Mp4UnsupportedBrandError', () => {
    const payload = buildFtypPayload('isom', 0, ['dash']);
    expect(() => parseFtyp(payload)).toThrow(Mp4UnsupportedBrandError);
  });

  it('handles truncated payload (< 8 bytes) gracefully', () => {
    const payload = buildFtypPayload('isom', 0, []);
    const ftyp = parseFtyp(payload.subarray(0, 4));
    expect(ftyp.majorBrand).toBe('isom');
    expect(ftyp.compatibleBrands).toHaveLength(0);
  });

  it('handles empty payload gracefully', () => {
    const ftyp = parseFtyp(new Uint8Array(0));
    expect(ftyp.majorBrand).toBe('isom'); // default
  });
});

describe('serializeFtyp', () => {
  it('round-trips ftyp data correctly', () => {
    const payload = buildFtypPayload('M4A ', 0, ['isom', 'mp42']);
    const ftyp = parseFtyp(payload);
    const serialized = serializeFtyp(ftyp);
    const reparsed = parseFtyp(serialized);
    expect(reparsed.majorBrand).toBe(ftyp.majorBrand);
    expect(reparsed.minorVersion).toBe(ftyp.minorVersion);
    expect(reparsed.compatibleBrands).toEqual(ftyp.compatibleBrands);
  });
});

describe('isAcceptedBrand', () => {
  it('returns true for M4A  major brand', () => {
    expect(isAcceptedBrand({ majorBrand: 'M4A ', minorVersion: 0, compatibleBrands: [] })).toBe(
      true,
    );
  });

  it('returns true when M4A  is in compatible brands', () => {
    expect(
      isAcceptedBrand({ majorBrand: 'unknown', minorVersion: 0, compatibleBrands: ['M4A '] }),
    ).toBe(true);
  });

  it('returns true for mp42 major brand', () => {
    expect(isAcceptedBrand({ majorBrand: 'mp42', minorVersion: 0, compatibleBrands: [] })).toBe(
      true,
    );
  });

  it('returns false for unrecognised brand', () => {
    expect(isAcceptedBrand({ majorBrand: 'unkn', minorVersion: 0, compatibleBrands: [] })).toBe(
      false,
    );
  });
});
