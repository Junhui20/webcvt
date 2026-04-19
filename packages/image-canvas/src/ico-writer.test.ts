import { describe, expect, it } from 'vitest';
import { writeIco } from './ico-writer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake PNG payload (8 bytes of zeros) for testing. */
function fakePng(size: number): Uint8Array {
  return new Uint8Array(size);
}

// ---------------------------------------------------------------------------
// ICONDIR layout constants (byte offsets)
// ---------------------------------------------------------------------------
// Offset 0: idReserved  (2 bytes, must be 0)
// Offset 2: idType      (2 bytes, must be 1 for ICO)
// Offset 4: idCount     (2 bytes, number of images)
// Total ICONDIR header: 6 bytes
//
// ICONDIRENTRY per image (16 bytes):
// Offset 0:  bWidth     (1 byte)  — 0 means 256
// Offset 1:  bHeight    (1 byte)  — 0 means 256
// Offset 2:  bColorCount (1 byte) — 0 for PNG
// Offset 3:  bReserved  (1 byte)  — must be 0
// Offset 4:  wPlanes    (2 bytes)
// Offset 6:  wBitCount  (2 bytes)
// Offset 8:  dwBytesInRes (4 bytes)
// Offset 12: dwImageOffset (4 bytes) — offset from start of file
// ---------------------------------------------------------------------------

function readUint16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | ((buf[offset + 1] ?? 0) << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeIco', () => {
  describe('ICONDIR header', () => {
    it('writes idReserved = 0', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(readUint16LE(result, 0)).toBe(0);
    });

    it('writes idType = 1 (ICO)', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(readUint16LE(result, 2)).toBe(1);
    });

    it('writes idCount = 1', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(readUint16LE(result, 4)).toBe(1);
    });
  });

  describe('ICONDIRENTRY (offset 6)', () => {
    it('writes bWidth correctly for 16×16', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(result[6]).toBe(16);
    });

    it('writes bHeight correctly for 16×16', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(result[7]).toBe(16);
    });

    it('writes bWidth = 0 for 256×256 (ICO encoding convention)', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 256, 256);
      expect(result[6]).toBe(0);
    });

    it('writes bHeight = 0 for 256×256 (ICO encoding convention)', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 256, 256);
      expect(result[7]).toBe(0);
    });

    it('writes bColorCount = 0', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(result[8]).toBe(0);
    });

    it('writes bReserved = 0', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(result[9]).toBe(0);
    });

    it('writes dwBytesInRes equal to payload length', () => {
      const payload = fakePng(128);
      const result = writeIco(payload, 32, 32);
      // dwBytesInRes is at ICONDIR(6) + entry offset 8 = byte 14
      expect(readUint32LE(result, 14)).toBe(128);
    });

    it('writes dwImageOffset = 22 (6 header + 16 entry)', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      // dwImageOffset is at ICONDIR(6) + entry offset 12 = byte 18
      expect(readUint32LE(result, 18)).toBe(22);
    });
  });

  describe('payload embedding', () => {
    it('embeds the PNG payload starting at offset 22', () => {
      const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = writeIco(payload, 16, 16);
      const embedded = result.slice(22, 30);
      expect(embedded).toEqual(payload);
    });

    it('total size equals 22 + payload.length', () => {
      const payload = fakePng(500);
      const result = writeIco(payload, 32, 32);
      expect(result.byteLength).toBe(22 + 500);
    });
  });

  describe('edge cases', () => {
    it('handles 32×32 dimensions', () => {
      const payload = fakePng(200);
      const result = writeIco(payload, 32, 32);
      expect(result[6]).toBe(32);
      expect(result[7]).toBe(32);
    });

    it('handles 48×48 dimensions', () => {
      const payload = fakePng(300);
      const result = writeIco(payload, 48, 48);
      expect(result[6]).toBe(48);
      expect(result[7]).toBe(48);
    });

    it('produces a Uint8Array', () => {
      const payload = fakePng(64);
      const result = writeIco(payload, 16, 16);
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });
});
