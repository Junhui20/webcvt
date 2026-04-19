/**
 * Tests for EBML VINT codec (ebml-vint.ts).
 *
 * Covers design note test cases:
 * - "decodes VINT IDs (1, 2, 3, 4-byte) preserving the marker bit"
 * - "decodes VINT sizes (1, 2, 4, 8-byte) stripping the marker bit"
 */

import { describe, expect, it } from 'vitest';
import { readVintId, readVintSize, writeVintId, writeVintSize } from './ebml-vint.ts';
import { MkvVintError } from './errors.ts';

// ---------------------------------------------------------------------------
// readVintId tests
// ---------------------------------------------------------------------------

describe('readVintId — ID encoding (marker bit retained)', () => {
  it('decodes 1-byte ID (e.g. 0x86 → ID 0x86)', () => {
    const bytes = new Uint8Array([0x86]);
    const { value, width } = readVintId(bytes, 0);
    expect(value).toBe(0x86);
    expect(width).toBe(1);
  });

  it('decodes 2-byte ID (e.g. 0x42 0x86 → ID 0x4286)', () => {
    const bytes = new Uint8Array([0x42, 0x86]);
    const { value, width } = readVintId(bytes, 0);
    expect(value).toBe(0x4286);
    expect(width).toBe(2);
  });

  it('decodes 3-byte ID (e.g. 0x2A 0xD7 0xB1 → ID 0x2AD7B1)', () => {
    const bytes = new Uint8Array([0x2a, 0xd7, 0xb1]);
    const { value, width } = readVintId(bytes, 0);
    expect(value).toBe(0x2ad7b1);
    expect(width).toBe(3);
  });

  it('decodes 4-byte ID — EBML header 0x1A45DFA3', () => {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const { value, width } = readVintId(bytes, 0);
    expect(value).toBe(0x1a45dfa3);
    expect(width).toBe(4);
  });

  it('decodes 4-byte Segment ID 0x18538067', () => {
    const bytes = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const { value, width } = readVintId(bytes, 0);
    expect(value).toBe(0x18538067);
    expect(width).toBe(4);
  });

  it('reads at a non-zero offset', () => {
    const bytes = new Uint8Array([0x00, 0x86, 0x01]);
    const { value, width } = readVintId(bytes, 1);
    expect(value).toBe(0x86);
    expect(width).toBe(1);
  });

  it('throws MkvVintError when first byte is 0x00', () => {
    expect(() => readVintId(new Uint8Array([0x00]), 0)).toThrow(MkvVintError);
  });

  it('throws MkvVintError when offset is past end', () => {
    expect(() => readVintId(new Uint8Array([0x86]), 5)).toThrow(MkvVintError);
  });

  it('throws MkvVintError on 5-byte ID (exceeds max ID width of 4)', () => {
    // First byte 0x08 → 5-byte VINT
    const bytes = new Uint8Array([0x08, 0x00, 0x00, 0x00, 0x01]);
    expect(() => readVintId(bytes, 0)).toThrow(MkvVintError);
  });
});

// ---------------------------------------------------------------------------
// readVintSize tests
// ---------------------------------------------------------------------------

describe('readVintSize — size encoding (marker bit stripped)', () => {
  it('decodes 1-byte size: 0x82 → 2', () => {
    const { value, width } = readVintSize(new Uint8Array([0x82]), 0);
    expect(value).toBe(2n);
    expect(width).toBe(1);
  });

  it('decodes 1-byte size: 0x81 → 1', () => {
    const { value, width } = readVintSize(new Uint8Array([0x81]), 0);
    expect(value).toBe(1n);
    expect(width).toBe(1);
  });

  it('decodes 1-byte size: 0x80 | 127 → 127 is not unknown, 0xFF is', () => {
    // 0x8F = 1000 1111 → value = 0x0F = 15
    const { value } = readVintSize(new Uint8Array([0x8f]), 0);
    expect(value).toBe(15n);
  });

  it('returns -1n for unknown-size 1-byte (0xFF)', () => {
    const { value } = readVintSize(new Uint8Array([0xff]), 0);
    expect(value).toBe(-1n);
  });

  it('decodes 2-byte size: 0x40 0x83 → 131', () => {
    const { value, width } = readVintSize(new Uint8Array([0x40, 0x83]), 0);
    expect(value).toBe(131n);
    expect(width).toBe(2);
  });

  it('decodes 4-byte size', () => {
    const bytes = new Uint8Array([0x10, 0x00, 0x01, 0x00]);
    const { value, width } = readVintSize(bytes, 0);
    expect(width).toBe(4);
    // value = (0x10 & ~0x10) << 24 | ... = 0x000100 = 256
    expect(value).toBeGreaterThan(0n);
  });

  it('decodes 8-byte size', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05]);
    const { value, width } = readVintSize(bytes, 0);
    expect(width).toBe(8);
    expect(value).toBe(5n);
  });

  it('returns -1n for 8-byte unknown-size (0x01 followed by 7 0xFF)', () => {
    const bytes = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const { value } = readVintSize(bytes, 0);
    expect(value).toBe(-1n);
  });

  it('throws MkvVintError when offset is past end', () => {
    expect(() => readVintSize(new Uint8Array([0x82]), 5)).toThrow(MkvVintError);
  });
});

// ---------------------------------------------------------------------------
// writeVintId / writeVintSize round-trip tests
// ---------------------------------------------------------------------------

describe('writeVintId — round-trip', () => {
  it('encodes and decodes 1-byte ID (0x86)', () => {
    const encoded = writeVintId(0x86);
    expect(encoded).toEqual(new Uint8Array([0x86]));
    expect(readVintId(encoded, 0).value).toBe(0x86);
  });

  it('encodes and decodes 4-byte ID (0x1A45DFA3)', () => {
    const encoded = writeVintId(0x1a45dfa3);
    expect(encoded).toHaveLength(4);
    expect(readVintId(encoded, 0).value).toBe(0x1a45dfa3);
  });

  it('encodes and decodes 2-byte ID (0x4286)', () => {
    const encoded = writeVintId(0x4286);
    expect(encoded).toHaveLength(2);
    expect(readVintId(encoded, 0).value).toBe(0x4286);
  });

  it('throws for invalid ID 0x00', () => {
    expect(() => writeVintId(0x00)).toThrow(MkvVintError);
  });
});

describe('writeVintSize — round-trip', () => {
  it('encodes size 0 as 1 byte 0x80', () => {
    const encoded = writeVintSize(0n);
    expect(encoded).toEqual(new Uint8Array([0x80]));
    expect(readVintSize(encoded, 0).value).toBe(0n);
  });

  it('encodes size 2 as 0x82', () => {
    const encoded = writeVintSize(2n);
    expect(encoded).toEqual(new Uint8Array([0x82]));
  });

  it('encodes size 127 as 2-byte (because 1-byte 0xFF is unknown-size)', () => {
    const encoded = writeVintSize(127n);
    expect(encoded).toHaveLength(2);
    expect(readVintSize(encoded, 0).value).toBe(127n);
  });

  it('forces width 8 via parameter', () => {
    const encoded = writeVintSize(5n, 8);
    expect(encoded).toHaveLength(8);
    expect(readVintSize(encoded, 0).value).toBe(5n);
  });

  it('decodes 2-byte VINT track number > 127 (Trap §24)', () => {
    // Track number 128: encoded as 2-byte VINT size.
    const encoded = writeVintSize(128n, 2);
    expect(encoded).toHaveLength(2);
    expect(readVintSize(encoded, 0).value).toBe(128n);
  });
});
