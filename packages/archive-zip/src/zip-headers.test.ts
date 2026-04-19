/**
 * Tests for ZIP binary record layout helpers.
 *
 * Covers MS-DOS time/date encoding and decoding (Trap #13),
 * and verifies that all multi-byte fields use LITTLE-ENDIAN byte order (Trap #18).
 */

import { describe, expect, it } from 'vitest';
import {
  ZIP_CENTRAL_DIR_FIXED_SIZE,
  ZIP_CENTRAL_DIR_SIG,
  ZIP_EOCD_FIXED_SIZE,
  ZIP_EOCD_SIG,
  ZIP_LOCAL_HEADER_FIXED_SIZE,
  ZIP_LOCAL_HEADER_SIG,
} from './constants.ts';
import {
  UTF8_DECODER,
  UTF8_ENCODER,
  decodeMsDosDateTime,
  encodeCentralDirHeader,
  encodeEocd,
  encodeLocalFileHeader,
  encodeMsDosDateTime,
  readU16LE,
  readU32LE,
} from './zip-headers.ts';

describe('decodeMsDosDateTime', () => {
  it('decodes zero time/date to 1980-01-01T00:00:00Z', () => {
    const date = decodeMsDosDateTime(0, 0);
    expect(date.getUTCFullYear()).toBe(1980);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(1);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });

  it('decodes a known date: 2024-06-15 10:30:00', () => {
    // year=2024 → (2024-1980)=44 → << 9 = 22528
    // month=6 → << 5 = 192
    // day=15 → 15
    // dosDate = 22528 | 192 | 15 = 22735 = 0x58CF
    const dosDate = ((44 & 0x7f) << 9) | ((6 & 0x0f) << 5) | (15 & 0x1f);
    // hour=10, minute=30, second=0 → second/2=0
    const dosTime = ((10 & 0x1f) << 11) | ((30 & 0x3f) << 5) | (0 & 0x1f);
    const date = decodeMsDosDateTime(dosTime, dosDate);
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(5); // June = index 5
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCHours()).toBe(10);
    expect(date.getUTCMinutes()).toBe(30);
    expect(date.getUTCSeconds()).toBe(0);
  });

  it('rounds seconds to 2-second resolution (Trap #13)', () => {
    // second=45 → stored as 45/2=22 → decoded as 22*2=44
    const dosTime = ((12 & 0x1f) << 11) | ((0 & 0x3f) << 5) | (22 & 0x1f);
    const dosDate = ((44 & 0x7f) << 9) | ((1 & 0x0f) << 5) | (1 & 0x1f);
    const date = decodeMsDosDateTime(dosTime, dosDate);
    expect(date.getUTCSeconds()).toBe(44); // 22 * 2 = 44
  });
});

describe('encodeMsDosDateTime', () => {
  it('encodes and round-trips a date', () => {
    const original = new Date('2024-03-20T14:45:00Z');
    const [dosTime, dosDate] = encodeMsDosDateTime(original);
    const decoded = decodeMsDosDateTime(dosTime, dosDate);
    expect(decoded.getUTCFullYear()).toBe(2024);
    expect(decoded.getUTCMonth()).toBe(2); // March
    expect(decoded.getUTCDate()).toBe(20);
    expect(decoded.getUTCHours()).toBe(14);
    expect(decoded.getUTCMinutes()).toBe(45);
    // Seconds round to even: 0 -> 0
    expect(decoded.getUTCSeconds()).toBe(0);
  });
});

describe('encodeLocalFileHeader', () => {
  it('writes the correct signature and is little-endian (Trap #18)', () => {
    const nameBytes = UTF8_ENCODER.encode('test.txt');
    const buf = new Uint8Array(ZIP_LOCAL_HEADER_FIXED_SIZE + nameBytes.length);
    encodeLocalFileHeader(buf, 0, nameBytes, {
      method: 0,
      dosTime: 0,
      dosDate: 0,
      crc32: 0xdeadbeef,
      compressedSize: 100,
      uncompressedSize: 100,
    });
    // Signature: 0x04034b50 LE → bytes 50 4B 03 04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    // Name length should be encoded
    expect(readU16LE(buf, 26)).toBe(nameBytes.length);
    // CRC at offset 14
    expect(readU32LE(buf, 14)).toBe(0xdeadbeef);
    // Name bytes after fixed header
    expect(UTF8_DECODER.decode(buf.subarray(30, 30 + nameBytes.length))).toBe('test.txt');
  });
});

describe('encodeEocd', () => {
  it('writes EOCD with correct signature', () => {
    const buf = new Uint8Array(ZIP_EOCD_FIXED_SIZE);
    encodeEocd(buf, 0, {
      numberOfRecords: 3,
      centralDirectorySize: 150,
      centralDirectoryOffset: 500,
    });
    // Signature: 0x06054b50 LE → 50 4B 05 06
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x05);
    expect(buf[3]).toBe(0x06);
    expect(readU16LE(buf, 8)).toBe(3); // record count
    expect(readU32LE(buf, 12)).toBe(150); // CD size
    expect(readU32LE(buf, 16)).toBe(500); // CD offset
  });
});

describe('readU32LE / readU16LE', () => {
  it('reads little-endian u32 correctly', () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
    expect(readU32LE(buf, 0)).toBe(0x04034b50);
  });

  it('reads little-endian u16 correctly', () => {
    const buf = new Uint8Array([0x0a, 0x00]);
    expect(readU16LE(buf, 0)).toBe(10);
  });

  it('returns 0 for out-of-range reads', () => {
    const buf = new Uint8Array([0x50, 0x4b]);
    expect(readU32LE(buf, 0)).toBe(0); // needs 4 bytes, only 2 available
  });
});
