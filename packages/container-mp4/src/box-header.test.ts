/**
 * Tests for box-header.ts — MP4 box header parsing.
 *
 * Tests are written first (RED) per TDD discipline. Covers:
 * - Normal 8-byte header
 * - largesize (size==1) 16-byte header
 * - size==0 EOF extension
 * - Error cases: truncated, size < 8
 * - encodeFourCC and writeBoxHeader
 */

import { describe, expect, it } from 'vitest';
import { encodeFourCC, readBoxHeader, writeBoxHeader, writeLargeBoxHeader } from './box-header.ts';
import { Mp4InvalidBoxError } from './errors.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBox(type: string, payloadSize: number, rawSize?: number): Uint8Array {
  const actualSize = rawSize ?? 8 + payloadSize;
  const buf = new Uint8Array(actualSize || 8 + payloadSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, rawSize ?? 8 + payloadSize, false);
  for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i) & 0xff;
  return buf;
}

function makeLargeBox(type: string, payloadSize: number): Uint8Array {
  const totalSize = 16 + payloadSize;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 1, false); // signal largesize
  for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i) & 0xff;
  // largesize as u64 big-endian at offset 8
  view.setUint32(8, 0, false); // hi
  view.setUint32(12, totalSize, false); // lo
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readBoxHeader', () => {
  it('parses a normal 8-byte header correctly', () => {
    const buf = makeBox('moov', 100);
    const hdr = readBoxHeader(buf, 0, buf.length);
    expect(hdr).not.toBeNull();
    expect(hdr!.type).toBe('moov');
    expect(hdr!.size).toBe(108);
    expect(hdr!.headerSize).toBe(8);
    expect(hdr!.payloadOffset).toBe(8);
    expect(hdr!.payloadSize).toBe(100);
  });

  it('parses a largesize (size==1) header correctly', () => {
    const buf = makeLargeBox('mdat', 1000);
    const hdr = readBoxHeader(buf, 0, buf.length);
    expect(hdr).not.toBeNull();
    expect(hdr!.type).toBe('mdat');
    expect(hdr!.size).toBe(1016);
    expect(hdr!.headerSize).toBe(16);
    expect(hdr!.payloadOffset).toBe(16);
    expect(hdr!.payloadSize).toBe(1000);
  });

  it('handles size==0 (EOF extension) correctly', () => {
    const buf = new Uint8Array(100);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0, false); // size == 0
    buf[4] = 0x6d;
    buf[5] = 0x64;
    buf[6] = 0x61;
    buf[7] = 0x74; // 'mdat'
    const hdr = readBoxHeader(buf, 0, 100);
    expect(hdr).not.toBeNull();
    expect(hdr!.size).toBe(100);
    expect(hdr!.payloadSize).toBe(92); // 100 - 8
  });

  it('returns null when fewer than 8 bytes remain', () => {
    const buf = new Uint8Array(4);
    expect(readBoxHeader(buf, 0, 4)).toBeNull();
  });

  it('throws Mp4InvalidBoxError when largesize box has fewer than 16 bytes', () => {
    const buf = new Uint8Array(12);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 1, false); // signal largesize
    buf[4] = 0x6d;
    buf[5] = 0x6f;
    buf[6] = 0x6f;
    buf[7] = 0x76; // 'moov'
    expect(() => readBoxHeader(buf, 0, 12)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when size < 8', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 4, false); // size < 8
    buf[4] = 0x66;
    buf[5] = 0x74;
    buf[6] = 0x79;
    buf[7] = 0x70; // 'ftyp'
    expect(() => readBoxHeader(buf, 0, 8)).toThrow(Mp4InvalidBoxError);
  });

  it('handles offset correctly when reading a box not at position 0', () => {
    const buf = new Uint8Array(20);
    const view = new DataView(buf.buffer);
    // Place a box at offset 8.
    view.setUint32(8, 12, false);
    buf[12] = 0x66;
    buf[13] = 0x74;
    buf[14] = 0x79;
    buf[15] = 0x70; // 'ftyp'
    const hdr = readBoxHeader(buf, 8, buf.length);
    expect(hdr).not.toBeNull();
    expect(hdr!.type).toBe('ftyp');
    expect(hdr!.size).toBe(12);
    expect(hdr!.payloadOffset).toBe(16);
  });

  it('throws Mp4InvalidBoxError when largesize value is less than 16', () => {
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 1, false);
    buf[4] = 0x6d;
    buf[5] = 0x6f;
    buf[6] = 0x6f;
    buf[7] = 0x76; // 'moov'
    view.setUint32(8, 0, false);
    view.setUint32(12, 8, false); // largeSize = 8 < 16
    expect(() => readBoxHeader(buf, 0, 16)).toThrow(Mp4InvalidBoxError);
  });

  it('Sec-M-2: throws Mp4InvalidBoxError when largesize exceeds remaining bytes', () => {
    // 32-byte buffer, size=1, largesize=0xFFFFFFFF_FFFFFFFF (huge).
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 1, false); // signal largesize
    buf[4] = 0x6d;
    buf[5] = 0x6f;
    buf[6] = 0x6f;
    buf[7] = 0x76; // 'moov'
    // largesize hi = 0xFFFFFFFF, lo = 0xFFFFFFFF
    view.setUint32(8, 0xffffffff, false);
    view.setUint32(12, 0xffffffff, false);
    // fileLength = 32, so largeSize >> remaining bytes
    expect(() => readBoxHeader(buf, 0, 32)).toThrow(Mp4InvalidBoxError);
  });

  it('Sec-M-3: throws Mp4InvalidBoxError when size==0 is used for a non-mdat box', () => {
    // A 'moov' box with size==0 should be rejected.
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0, false); // size == 0
    buf[4] = 0x6d;
    buf[5] = 0x6f;
    buf[6] = 0x6f;
    buf[7] = 0x76; // 'moov'
    expect(() => readBoxHeader(buf, 0, 8)).toThrow(Mp4InvalidBoxError);
  });
});

describe('encodeFourCC', () => {
  it('encodes a four-character code to bytes', () => {
    const bytes = encodeFourCC('moov');
    expect(bytes).toEqual(new Uint8Array([0x6d, 0x6f, 0x6f, 0x76]));
  });

  it('encodes spaces correctly (M4A  brand)', () => {
    const bytes = encodeFourCC('M4A ');
    expect(bytes[3]).toBe(0x20); // space
  });
});

describe('writeBoxHeader', () => {
  it('writes an 8-byte box header to a buffer', () => {
    const buf = new Uint8Array(16);
    writeBoxHeader(buf, 0, 108, 'moov');
    const view = new DataView(buf.buffer);
    expect(view.getUint32(0, false)).toBe(108);
    expect(String.fromCharCode(buf[4]!, buf[5]!, buf[6]!, buf[7]!)).toBe('moov');
  });
});

describe('writeLargeBoxHeader', () => {
  it('writes a 16-byte largesize box header', () => {
    const buf = new Uint8Array(16);
    writeLargeBoxHeader(buf, 0, 0x1_0000_0010, 'mdat');
    const view = new DataView(buf.buffer);
    // size field = 1 (signals largesize)
    expect(view.getUint32(0, false)).toBe(1);
    expect(String.fromCharCode(buf[4]!, buf[5]!, buf[6]!, buf[7]!)).toBe('mdat');
    const hi = view.getUint32(8, false);
    const lo = view.getUint32(12, false);
    expect(hi * 0x100000000 + lo).toBe(0x1_0000_0010);
  });
});
