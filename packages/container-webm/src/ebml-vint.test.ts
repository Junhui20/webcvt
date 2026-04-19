/**
 * Tests for EBML VINT codec (ebml-vint.ts).
 *
 * Covers design note test cases:
 * - "decodes VINT IDs (1, 2, 3, 4-byte) preserving the marker bit"
 * - "decodes VINT sizes (1, 2, 4, 8-byte) stripping the marker bit"
 * - "rejects unknown-size element (all-ones VINT) for first pass"
 */

import { describe, expect, it } from 'vitest';
import { readVintId, readVintSize, writeVintId, writeVintSize } from './ebml-vint.ts';
import { WebmVintError } from './errors.ts';

describe('readVintId', () => {
  it('decodes 1-byte ID (0x80 form) preserving marker bit', () => {
    // ID 0x80: width=1, value=0x80
    const bytes = new Uint8Array([0x80]);
    const result = readVintId(bytes, 0);
    expect(result.value).toBe(0x80);
    expect(result.width).toBe(1);
  });

  it('decodes 1-byte ID 0xA3 (SimpleBlock) preserving marker bit', () => {
    const bytes = new Uint8Array([0xa3]);
    const result = readVintId(bytes, 0);
    expect(result.value).toBe(0xa3);
    expect(result.width).toBe(1);
  });

  it('decodes 2-byte ID 0x4286 (EBMLVersion) preserving marker bit', () => {
    const bytes = new Uint8Array([0x42, 0x86]);
    const result = readVintId(bytes, 0);
    expect(result.value).toBe(0x4286);
    expect(result.width).toBe(2);
  });

  it('decodes 4-byte ID 0x1A45DFA3 (EBML header) preserving marker bit', () => {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const result = readVintId(bytes, 0);
    expect(result.value).toBe(0x1a45dfa3);
    expect(result.width).toBe(4);
  });

  it('decodes 4-byte ID 0x18538067 (Segment) preserving marker bit', () => {
    const bytes = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const result = readVintId(bytes, 0);
    expect(result.value).toBe(0x18538067);
    expect(result.width).toBe(4);
  });

  it('reads ID at non-zero offset', () => {
    const bytes = new Uint8Array([0x00, 0x42, 0x86]);
    const result = readVintId(bytes, 1);
    expect(result.value).toBe(0x4286);
    expect(result.width).toBe(2);
  });

  it('throws WebmVintError on 0x00 first byte (invalid)', () => {
    const bytes = new Uint8Array([0x00]);
    expect(() => readVintId(bytes, 0)).toThrow(WebmVintError);
  });

  it('throws WebmVintError when offset >= buffer length', () => {
    const bytes = new Uint8Array([0x42, 0x86]);
    expect(() => readVintId(bytes, 2)).toThrow(WebmVintError);
  });

  it('throws WebmVintError on 5-byte ID (exceeds max ID width 4)', () => {
    // 5-byte VINT starts with 0x08
    const bytes = new Uint8Array([0x08, 0x00, 0x00, 0x00, 0x00]);
    expect(() => readVintId(bytes, 0)).toThrow(WebmVintError);
  });
});

describe('readVintSize', () => {
  it('decodes 1-byte size 0x82 → 2 (strips marker)', () => {
    // 0x82 = 0b10000010 → marker bit is bit 7, payload = 0b0000010 = 2
    const bytes = new Uint8Array([0x82]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(2n);
    expect(result.width).toBe(1);
  });

  it('decodes 1-byte size 0x81 → 1', () => {
    const bytes = new Uint8Array([0x81]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(1n);
    expect(result.width).toBe(1);
  });

  it('decodes 1-byte size 0xFE → 126 (max 1-byte non-unknown)', () => {
    // 0xFE = 0b11111110 → payload 0b1111110 = 126
    const bytes = new Uint8Array([0xfe]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(126n);
    expect(result.width).toBe(1);
  });

  it('recognises 1-byte unknown size 0xFF → -1n', () => {
    const bytes = new Uint8Array([0xff]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(-1n);
    expect(result.width).toBe(1);
  });

  it('decodes 2-byte size 0x4083 → 131', () => {
    // 0x4083: first byte 0x40 = 0b01000000 → width 2
    // Strip marker from first byte: 0x40 & ~0x40 = 0x00
    // Value = (0x00 << 8) | 0x83 = 0x83 = 131
    const bytes = new Uint8Array([0x40, 0x83]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(131n);
    expect(result.width).toBe(2);
  });

  it('decodes 4-byte size', () => {
    // 0x10 0x00 0x01 0x00 → width 4, strip marker from 0x10 → 0x00
    // value = (0x00 << 24) | (0x00 << 16) | (0x01 << 8) | 0x00 = 256
    const bytes = new Uint8Array([0x10, 0x00, 0x01, 0x00]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(256n);
    expect(result.width).toBe(4);
  });

  it('decodes 8-byte size (large segment)', () => {
    // 0x01 followed by 7 bytes → width 8
    // 0x01 0x00 0x00 0x00 0x00 0x00 0x00 0x10 → strip marker from 0x01 → 0x00
    // value = 0x10 = 16
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(16n);
    expect(result.width).toBe(8);
  });

  it('recognises 2-byte unknown size 0x7FFF → -1n', () => {
    const bytes = new Uint8Array([0x7f, 0xff]);
    const result = readVintSize(bytes, 0);
    expect(result.value).toBe(-1n);
    expect(result.width).toBe(2);
  });

  it('throws WebmVintError on 0x00 first byte', () => {
    const bytes = new Uint8Array([0x00]);
    expect(() => readVintSize(bytes, 0)).toThrow(WebmVintError);
  });

  it('throws WebmVintError when buffer too short for declared width', () => {
    // 2-byte VINT but only 1 byte in buffer
    const bytes = new Uint8Array([0x40]);
    expect(() => readVintSize(bytes, 0)).toThrow(WebmVintError);
  });
});

describe('writeVintId', () => {
  it('encodes 1-byte ID 0xA3 correctly', () => {
    const result = writeVintId(0xa3);
    expect(result).toEqual(new Uint8Array([0xa3]));
  });

  it('encodes 2-byte ID 0x4286 correctly', () => {
    const result = writeVintId(0x4286);
    expect(result).toEqual(new Uint8Array([0x42, 0x86]));
  });

  it('encodes 4-byte ID 0x1A45DFA3 correctly', () => {
    const result = writeVintId(0x1a45dfa3);
    expect(result).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  });

  it('round-trips ID 0x18538067', () => {
    const bytes = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const id = readVintId(bytes, 0).value;
    const encoded = writeVintId(id);
    expect(encoded).toEqual(bytes);
  });
});

describe('writeVintSize', () => {
  it('encodes size 2 as 0x82', () => {
    const result = writeVintSize(2n);
    expect(result).toEqual(new Uint8Array([0x82]));
  });

  it('encodes size 0 as 0x80', () => {
    const result = writeVintSize(0n);
    expect(result).toEqual(new Uint8Array([0x80]));
  });

  it('encodes size 126 as 0xFE (max 1-byte non-unknown)', () => {
    const result = writeVintSize(126n);
    expect(result).toEqual(new Uint8Array([0xfe]));
  });

  it('encodes size 127 in 2 bytes', () => {
    const result = writeVintSize(127n);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0x40);
  });

  it('encodes with forced width=8', () => {
    const result = writeVintSize(0n, 8);
    expect(result.length).toBe(8);
    expect(result[0]).toBe(0x01); // 8-byte marker
  });

  it('round-trips size 131', () => {
    const original = new Uint8Array([0x40, 0x83]);
    const size = readVintSize(original, 0).value;
    const encoded = writeVintSize(size, 2);
    expect(encoded).toEqual(original);
  });
});
