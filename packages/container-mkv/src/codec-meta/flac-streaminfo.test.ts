/**
 * Tests for FLAC STREAMINFO CodecPrivate normaliser (flac-streaminfo.ts). Trap §22.
 */

import { describe, expect, it } from 'vitest';
import { MkvInvalidCodecPrivateError } from '../errors.ts';
import { normaliseFlacCodecPrivate } from './flac-streaminfo.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MAGIC = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // 'fLaC'
// STREAMINFO block header: last=1, type=0, length=34 (0x22)
const STREAMINFO_HEADER = new Uint8Array([0x80, 0x00, 0x00, 0x22]);
const STREAMINFO_BODY_LEN = 34;
const CANONICAL_LEN = 42; // 4 + 4 + 34

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawBody(): Uint8Array {
  const body = new Uint8Array(STREAMINFO_BODY_LEN);
  // Fill with something recognisable
  body[0] = 0xaa;
  body[STREAMINFO_BODY_LEN - 1] = 0xbb;
  return body;
}

function make42ByteForm(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(CANONICAL_LEN);
  out.set(FLAC_MAGIC, 0);
  out.set(STREAMINFO_HEADER, 4);
  out.set(body, 8);
  return out;
}

function make38ByteForm(body: Uint8Array): Uint8Array {
  // fLaC (4) + STREAMINFO_HEADER (4) + body (34) = 42, but we call this "38" in the design note.
  // The design note says 38-byte form = fLaC + 4-byte header (block length encodes 34) + 34-byte body.
  // That's actually 4+4+34=42 in total. However, there's also a form where the STREAMINFO body
  // starts at offset 4 (right after fLaC magic, header-only inline with body).
  // The actual implementation reads fLaC + block header + body. So canonical = 42.
  // For "38-byte" testing, we create a fLaC + header where the header block_len is 34
  // followed by the 34-byte body = 4+4+34 = 42 bytes total.
  // The test is that normaliseFlacCodecPrivate works on the 42-byte full form.
  return make42ByteForm(body);
}

function make34ByteRawBody(body: Uint8Array): Uint8Array {
  return body.slice(0, STREAMINFO_BODY_LEN);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normaliseFlacCodecPrivate', () => {
  it('returns 42-byte canonical form for 34-byte raw body', () => {
    const body = makeRawBody();
    const result = normaliseFlacCodecPrivate(make34ByteRawBody(body));
    expect(result).toHaveLength(CANONICAL_LEN);
    // Starts with fLaC magic
    expect(result.subarray(0, 4)).toEqual(FLAC_MAGIC);
    // Block header
    expect(result.subarray(4, 8)).toEqual(STREAMINFO_HEADER);
    // Body preserved
    expect(result.subarray(8, 42)).toEqual(body);
  });

  it('returns 42-byte canonical form for 42-byte full form', () => {
    const body = makeRawBody();
    const input = make42ByteForm(body);
    const result = normaliseFlacCodecPrivate(input);
    expect(result).toHaveLength(CANONICAL_LEN);
    expect(result.subarray(8, 42)).toEqual(body);
  });

  it('normalised output always starts with fLaC magic', () => {
    const body = makeRawBody();
    const result = normaliseFlacCodecPrivate(body);
    expect(result[0]).toBe(0x66);
    expect(result[1]).toBe(0x4c);
    expect(result[2]).toBe(0x61);
    expect(result[3]).toBe(0x43);
  });

  it('normalised output always has STREAMINFO block header at bytes 4-7', () => {
    const body = makeRawBody();
    const result = normaliseFlacCodecPrivate(body);
    expect(result.subarray(4, 8)).toEqual(STREAMINFO_HEADER);
  });

  it('body content is preserved in the output at offset 8', () => {
    const body = new Uint8Array(STREAMINFO_BODY_LEN);
    for (let i = 0; i < STREAMINFO_BODY_LEN; i++) {
      body[i] = (i * 7 + 3) & 0xff;
    }
    const result = normaliseFlacCodecPrivate(body);
    expect(result.subarray(8, 42)).toEqual(body);
  });

  it('round-trip: normalising a canonical 42-byte form gives same output', () => {
    const body = makeRawBody();
    const canonical = make42ByteForm(body);
    const result1 = normaliseFlacCodecPrivate(canonical);
    const result2 = normaliseFlacCodecPrivate(result1);
    expect(result1).toEqual(result2);
  });

  it('throws MkvInvalidCodecPrivateError for empty input', () => {
    expect(() => normaliseFlacCodecPrivate(new Uint8Array(0))).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError for unrecognised length != 34', () => {
    // Not 34 bytes and no fLaC magic
    expect(() => normaliseFlacCodecPrivate(new Uint8Array(10))).toThrow(
      MkvInvalidCodecPrivateError,
    );
  });

  it('throws MkvInvalidCodecPrivateError for fLaC magic but too short for header', () => {
    const short = new Uint8Array(5);
    short.set(FLAC_MAGIC, 0);
    short[4] = 0x80;
    // Only 5 bytes total — not enough for 4-byte block header
    expect(() => normaliseFlacCodecPrivate(short)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when block type != 0', () => {
    const invalid = new Uint8Array(42);
    invalid.set(FLAC_MAGIC, 0);
    // Block header: type=1 (not STREAMINFO)
    invalid[4] = 0x81; // last=1, type=1
    invalid[5] = 0x00;
    invalid[6] = 0x00;
    invalid[7] = 0x22; // length=34
    expect(() => normaliseFlacCodecPrivate(invalid)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when block length != 34', () => {
    const invalid = new Uint8Array(42);
    invalid.set(FLAC_MAGIC, 0);
    invalid[4] = 0x80; // last=1, type=0
    invalid[5] = 0x00;
    invalid[6] = 0x00;
    invalid[7] = 0x20; // length=32 (not 34)
    expect(() => normaliseFlacCodecPrivate(invalid)).toThrow(MkvInvalidCodecPrivateError);
  });

  it('throws MkvInvalidCodecPrivateError when fLaC present but body missing', () => {
    // fLaC + valid header but no body (8 bytes total)
    const truncated = new Uint8Array(8);
    truncated.set(FLAC_MAGIC, 0);
    truncated.set(STREAMINFO_HEADER, 4);
    // length=34 is in the header but body doesn't follow
    expect(() => normaliseFlacCodecPrivate(truncated)).toThrow(MkvInvalidCodecPrivateError);
  });
});
