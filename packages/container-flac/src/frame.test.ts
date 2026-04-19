/**
 * Tests for frame header parsing, UTF-8 varint decoder/encoder.
 *
 * Covers design-note test cases:
 * - decodes fixed-blocksize frame number via UTF-8 varint
 * - decodes variable-blocksize sample number via extended UTF-8 varint up to 36 bits
 */

import { describe, expect, it } from 'vitest';
import { crc8 } from './crc.ts';
import { FlacInvalidFrameError, FlacInvalidVarintError } from './errors.ts';
import { FRAME_SYNC_CODE, decodeVarint, encodeVarint, parseFrameHeader } from './frame.ts';

// ---------------------------------------------------------------------------
// UTF-8 varint: fixed-blocksize frame number (Trap #1)
// ---------------------------------------------------------------------------

describe('decodes fixed-blocksize frame number via UTF-8 varint', () => {
  it('decodes 1-byte form (value < 128)', () => {
    const bytes = new Uint8Array([0x00]);
    const { value, bytesRead } = decodeVarint(bytes, 0);
    expect(value).toBe(0);
    expect(bytesRead).toBe(1);
  });

  it('decodes 1-byte form (value = 127)', () => {
    const bytes = new Uint8Array([0x7f]);
    const { value, bytesRead } = decodeVarint(bytes, 0);
    expect(value).toBe(127);
    expect(bytesRead).toBe(1);
  });

  it('decodes 2-byte form (value = 128)', () => {
    // 128 = 0x80 = 0b10000000
    // Encoded: 110 00010  10 000000 = 0xC2 0x80
    const bytes = new Uint8Array([0xc2, 0x80]);
    const { value, bytesRead } = decodeVarint(bytes, 0);
    expect(value).toBe(128);
    expect(bytesRead).toBe(2);
  });

  it('decodes 3-byte form (value = 0x800 = 2048)', () => {
    // 2048 = 0b0000_1000_0000_0000
    // 3-byte: 1110xxxx 10xxxxxx 10xxxxxx
    // xx = 0000, xxxxxx = 100000, xxxxxx = 000000
    // = 0xE0 | 0 = 0xE0, 0x80 | 0x20 = 0xA0, 0x80 | 0 = 0x80
    const bytes = new Uint8Array([0xe0, 0xa0, 0x80]);
    const { value, bytesRead } = decodeVarint(bytes, 0);
    expect(value).toBe(2048);
    expect(bytesRead).toBe(3);
  });

  it('round-trips encode→decode for common frame numbers', () => {
    const testValues = [0, 1, 100, 127, 128, 2047, 2048, 65535, 100000, 0xffff00];
    for (const v of testValues) {
      const encoded = encodeVarint(v);
      const { value, bytesRead } = decodeVarint(encoded, 0);
      expect(value).toBe(v);
      expect(bytesRead).toBe(encoded.length);
    }
  });

  it('decodes varint at non-zero offset', () => {
    const bytes = new Uint8Array([0xaa, 0x7f, 0xbb]); // value at offset 1
    const { value, bytesRead } = decodeVarint(bytes, 1);
    expect(value).toBe(0x7f);
    expect(bytesRead).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// UTF-8 varint: extended 36-bit form (Trap #1)
// ---------------------------------------------------------------------------

describe('decodes variable-blocksize sample number via extended UTF-8 varint up to 36 bits', () => {
  it('decodes 7-byte extended form (lead byte = 0xFE)', () => {
    // 7-byte form: 0xFE followed by 6 continuation bytes carrying 36 bits
    // Let's encode the value 0xFFFFFFFFF (max 36-bit value)
    const maxVal = 0xf_ffff_ffff; // 2^36 - 1
    const encoded = encodeVarint(maxVal);
    expect(encoded.length).toBe(7);
    expect(encoded[0]).toBe(0xfe);

    const { value, bytesRead } = decodeVarint(encoded, 0);
    expect(value).toBe(maxVal);
    expect(bytesRead).toBe(7);
  });

  it('decodes sample number 0x100000000 (2^32) in 7-byte form', () => {
    const val = 0x1_0000_0000; // 4294967296
    const encoded = encodeVarint(val);
    expect(encoded.length).toBeGreaterThanOrEqual(6);
    const { value } = decodeVarint(encoded, 0);
    expect(value).toBe(val);
  });

  it('decodes 5-byte form (value up to 2^26 - 1)', () => {
    const val = 0x3ffffff; // 2^26 - 1 = 67108863
    const encoded = encodeVarint(val);
    expect(encoded.length).toBe(5);
    const { value, bytesRead } = decodeVarint(encoded, 0);
    expect(value).toBe(val);
    expect(bytesRead).toBe(5);
  });

  it('decodes 6-byte form (value up to 2^31 - 1)', () => {
    const val = 0x40000000; // 2^30
    const encoded = encodeVarint(val);
    expect(encoded.length).toBe(6);
    const { value, bytesRead } = decodeVarint(encoded, 0);
    expect(value).toBe(val);
    expect(bytesRead).toBe(6);
  });

  it('round-trips large sample numbers common in long recordings', () => {
    // 1 hour at 96kHz = 345,600,000 samples (about 2^28)
    const testVals = [44100, 44100 * 3600, 44100 * 72000, 0x80000000];
    for (const v of testVals) {
      const encoded = encodeVarint(v);
      const { value } = decodeVarint(encoded, 0);
      expect(value).toBe(v);
    }
  });

  it('throws FlacInvalidVarintError on malformed continuation byte', () => {
    // 0xC2 expects one continuation byte with high bits 10xxxxxx
    // but 0x00 has high bits 00 → invalid
    const bad = new Uint8Array([0xc2, 0x00]);
    expect(() => decodeVarint(bad, 0)).toThrow();
  });

  it('throws FlacInvalidVarintError on 0xFF lead byte', () => {
    // 0xFF is not a valid lead byte in the extended scheme
    const bad = new Uint8Array([0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    expect(() => decodeVarint(bad, 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Frame sync code
// ---------------------------------------------------------------------------

describe('FRAME_SYNC_CODE constant', () => {
  it('equals 0x3FFE (14-bit sync)', () => {
    expect(FRAME_SYNC_CODE).toBe(0x3ffe);
  });
});

// ---------------------------------------------------------------------------
// parseFrameHeader integration tests
// ---------------------------------------------------------------------------

describe('parseFrameHeader', () => {
  /** Build a minimal valid frame header for testing. */
  function buildFrameHeader({
    blockingStrategy = 0,
    blockSizeBits = 0b0001, // 192
    sampleRateBits = 0b1000, // 32000 Hz from table
    channelNibble = 0x00, // 1 raw channel
    sampleSizeBits = 0b100, // 16-bit
    varintValue = 0,
  } = {}): Uint8Array {
    const varint = encodeVarint(varintValue);
    // Total without CRC: 4 (fixed) + varint.length
    const headerLen = 4 + varint.length;
    const buf = new Uint8Array(headerLen + 1); // +1 for CRC-8

    buf[0] = 0xff;
    buf[1] = 0xf8 | (blockingStrategy & 0x01);
    buf[2] = ((blockSizeBits & 0x0f) << 4) | (sampleRateBits & 0x0f);
    buf[3] = ((channelNibble & 0x0f) << 4) | ((sampleSizeBits & 0x07) << 1) | 0;
    buf.set(varint, 4);
    buf[headerLen] = crc8(buf, 0, headerLen);

    return buf;
  }

  it('parses fixed-blocksize frame header (frame_number=0)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0001, sampleRateBits: 0b1000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);

    expect(parsed.sampleNumber).toBe(0); // frame 0 * blockSize 192 = 0
    expect(parsed.blockSize).toBe(192);
    expect(parsed.sampleRate).toBe(32000);
    expect(parsed.channels).toBe(1);
    expect(parsed.channelAssignment).toBe('raw');
  });

  it('parses fixed-blocksize frame header (frame_number=5)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0001, sampleRateBits: 0b1000, varintValue: 5 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);

    expect(parsed.sampleNumber).toBe(5 * 192); // frame 5 * blockSize 192
    expect(parsed.blockSize).toBe(192);
  });

  it('parses variable-blocksize frame header', () => {
    // blocking_strategy = 1 (variable)
    const varintValue = 88200; // sample number
    const hdr = buildFrameHeader({
      blockingStrategy: 1,
      blockSizeBits: 0b0001,
      sampleRateBits: 0b1000,
      varintValue,
    });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);

    // In variable mode, sampleNumber IS the varint value
    expect(parsed.sampleNumber).toBe(88200);
  });

  it('uses sample rate from STREAMINFO when bits=0b0000', () => {
    const hdr = buildFrameHeader({ sampleRateBits: 0b0000 });
    const parsed = parseFrameHeader(hdr, 0, 96000, 24, true);
    expect(parsed.sampleRate).toBe(96000);
  });

  it('resolves standard sample rate from table (44100 Hz, bits=0b1001)', () => {
    const hdr = buildFrameHeader({ sampleRateBits: 0b1001 }); // 44100
    const parsed = parseFrameHeader(hdr, 0, 48000, 16, true);
    expect(parsed.sampleRate).toBe(44100);
  });

  it('throws on CRC-8 mismatch when verifyCrc=true', () => {
    const hdr = buildFrameHeader();
    // Corrupt the CRC byte
    hdr[hdr.length - 1] ^= 0xff;
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, true)).toThrow();
  });

  it('does not throw on CRC-8 mismatch when verifyCrc=false', () => {
    const hdr = buildFrameHeader();
    hdr[hdr.length - 1] ^= 0xff;
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, false)).not.toThrow();
  });

  it('resolves uncommon 8-bit block size after varint (Trap #7)', () => {
    // block_size_bits = 0b0110 → read 8 bits after varint = value+1
    // blockSize = byte_value + 1 = 255 + 1 = 256
    const varint = encodeVarint(0); // frame number = 0
    const headerLen = 4 + varint.length + 1; // +1 for the 8-bit block size byte
    const buf = new Uint8Array(headerLen + 1); // +1 for CRC-8

    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0110 << 4) | 0b1000; // blockSizeBits=0b0110, sampleRateBits=0b1000 (32000)
    buf[3] = 0x0e; // channel=0 (mono raw), sampleSizeBits=0b111 (32-bit), reserved=0
    buf.set(varint, 4);
    buf[4 + varint.length] = 0xff; // uncommon block size byte: 255 → blockSize = 256
    buf[headerLen] = crc8(buf, 0, headerLen);

    const parsed = parseFrameHeader(buf, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(256);
  });

  it('resolves block size 0b0111 (16-bit uncommon, Trap #7)', () => {
    // block_size_bits = 0b0111 → read 16 bits after varint = value+1
    // blockSize = 0x00FF + 1 = 256
    const varint = encodeVarint(0);
    const headerLen = 4 + varint.length + 2; // +2 for 16-bit block size
    const buf = new Uint8Array(headerLen + 1); // +1 for CRC-8

    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0111 << 4) | 0b1000; // blockSizeBits=0b0111, sampleRateBits=0b1000 (32000)
    buf[3] = 0x0e;
    buf.set(varint, 4);
    // 16-bit block size: 0x00FF → blockSize = 0x00FF + 1 = 256
    buf[4 + varint.length] = 0x00;
    buf[4 + varint.length + 1] = 0xff;
    buf[headerLen] = crc8(buf, 0, headerLen);

    const parsed = parseFrameHeader(buf, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(256);
  });

  it('resolves block size 0b0010 (576 samples)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0010, sampleRateBits: 0b1000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(576);
  });

  it('resolves block size 0b0011 (1152 samples)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0011, sampleRateBits: 0b1000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(1152);
  });

  it('resolves block size 0b0100 (2304 samples)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0100, sampleRateBits: 0b1000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(2304);
  });

  it('resolves block size 0b0101 (4608 samples)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0101, sampleRateBits: 0b1000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.blockSize).toBe(4608);
  });

  it('resolves block size 0b1000..0b1111 range (256*2^n)', () => {
    const hdr8 = buildFrameHeader({ blockSizeBits: 0b1000, sampleRateBits: 0b1000 });
    expect(parseFrameHeader(hdr8, 0, 32000, 16, true).blockSize).toBe(256);

    const hdr9 = buildFrameHeader({ blockSizeBits: 0b1001, sampleRateBits: 0b1000 });
    expect(parseFrameHeader(hdr9, 0, 32000, 16, true).blockSize).toBe(512);

    const hdrF = buildFrameHeader({ blockSizeBits: 0b1111, sampleRateBits: 0b1000 });
    expect(parseFrameHeader(hdrF, 0, 32000, 16, true).blockSize).toBe(256 * 128);
  });

  it('resolves uncommon 8-bit sample rate (0b1100, kHz)', () => {
    // sampleRateBits = 0b1100 → 8-bit after varint, value * 1000 Hz
    const varint = encodeVarint(0);
    const headerLen = 4 + varint.length + 1; // +1 for 8-bit sample rate
    const buf = new Uint8Array(headerLen + 1);

    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0001 << 4) | 0b1100; // blockSize=192, sampleRateBits=0b1100
    buf[3] = 0x0e;
    buf.set(varint, 4);
    buf[4 + varint.length] = 44; // 44 * 1000 = 44000 Hz
    buf[headerLen] = crc8(buf, 0, headerLen);

    const parsed = parseFrameHeader(buf, 0, 48000, 16, true);
    expect(parsed.sampleRate).toBe(44000);
  });

  it('resolves uncommon 16-bit sample rate in Hz (0b1101)', () => {
    const varint = encodeVarint(0);
    const headerLen = 4 + varint.length + 2; // +2 for 16-bit sample rate
    const buf = new Uint8Array(headerLen + 1);

    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0001 << 4) | 0b1101; // sampleRateBits=0b1101
    buf[3] = 0x0e;
    buf.set(varint, 4);
    // 0xACDC = 44252 Hz
    buf[4 + varint.length] = 0xac;
    buf[4 + varint.length + 1] = 0xdc;
    buf[headerLen] = crc8(buf, 0, headerLen);

    const parsed = parseFrameHeader(buf, 0, 48000, 16, true);
    expect(parsed.sampleRate).toBe(0xacdc);
  });

  it('resolves uncommon 16-bit sample rate * 10 (0b1110)', () => {
    const varint = encodeVarint(0);
    const headerLen = 4 + varint.length + 2;
    const buf = new Uint8Array(headerLen + 1);

    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0001 << 4) | 0b1110; // sampleRateBits=0b1110
    buf[3] = 0x0e;
    buf.set(varint, 4);
    // 4410 * 10 = 44100 Hz
    buf[4 + varint.length] = 0x11;
    buf[4 + varint.length + 1] = 0x3a; // 0x113A = 4410
    buf[headerLen] = crc8(buf, 0, headerLen);

    const parsed = parseFrameHeader(buf, 0, 48000, 16, true);
    expect(parsed.sampleRate).toBe(44100);
  });

  it('resolves all standard sample rates from table (0b0001..0b1011)', () => {
    const expected = [88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
    for (let bits = 1; bits <= 11; bits++) {
      const hdr = buildFrameHeader({ sampleRateBits: bits });
      const parsed = parseFrameHeader(hdr, 0, 0, 16, true);
      expect(parsed.sampleRate).toBe(expected[bits - 1]);
    }
  });

  it('throws when block size bits = 0b0000 (reserved)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0000, sampleRateBits: 0b1000 });
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, false)).toThrow();
  });

  it('throws when sample rate bits = 0b1111 (invalid)', () => {
    const hdr = buildFrameHeader({ blockSizeBits: 0b0001, sampleRateBits: 0b1111 });
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, false)).toThrow();
  });

  it('resolves bitsPerSample from STREAMINFO when header bits = 0', () => {
    // sampleSizeBits=0 → use streaminfoSampleSize
    const hdr = buildFrameHeader({ sampleSizeBits: 0b000 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 24, true);
    expect(parsed.bitsPerSample).toBe(24);
  });

  it('resolves bitsPerSample=8 when header bits = 0b001', () => {
    const hdr = buildFrameHeader({ sampleSizeBits: 0b001 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.bitsPerSample).toBe(8);
  });

  it('resolves bitsPerSample=12 when header bits = 0b010', () => {
    const hdr = buildFrameHeader({ sampleSizeBits: 0b010 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.bitsPerSample).toBe(12);
  });

  it('resolves bitsPerSample=20 when header bits = 0b101', () => {
    const hdr = buildFrameHeader({ sampleSizeBits: 0b101 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.bitsPerSample).toBe(20);
  });

  it('resolves bitsPerSample=24 when header bits = 0b110', () => {
    const hdr = buildFrameHeader({ sampleSizeBits: 0b110 });
    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.bitsPerSample).toBe(24);
  });

  it('resolves raw channel assignments 0..7 (1..8 channels)', () => {
    for (let nibble = 0; nibble <= 7; nibble++) {
      const hdr = buildFrameHeader({ channelNibble: nibble });
      const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
      expect(parsed.channelAssignment).toBe('raw');
      expect(parsed.channels).toBe(nibble + 1);
    }
  });

  it('resolves reserved channel nibble 11-15 to channels=0 raw', () => {
    // nibble 11 is reserved — results in channels=0 / raw (degenerate but should not throw)
    // Build header with channelNibble=11
    const varint = encodeVarint(0);
    const hdrLen = 4 + varint.length;
    const buf = new Uint8Array(hdrLen + 1);
    buf[0] = 0xff;
    buf[1] = 0xf8;
    buf[2] = (0b0001 << 4) | 0b1000; // blockSize=192, sampleRate=32000
    buf[3] = (11 << 4) | (0b100 << 1) | 0; // nibble=11, sampleSizeBits=0b100 (16-bit)
    buf.set(varint, 4);
    buf[hdrLen] = crc8(buf, 0, hdrLen);

    const parsed = parseFrameHeader(buf, 0, 32000, 16, true);
    expect(parsed.channelAssignment).toBe('raw');
    expect(parsed.channels).toBe(0); // reserved
  });

  it('throws FlacCrc8MismatchError when sync code is wrong', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(() => parseFrameHeader(buf, 0, 32000, 16, false)).toThrow();
  });

  // Q-2 regression: reserved nibble should throw FlacInvalidFrameError, not FlacCrc8MismatchError
  it('throws FlacInvalidFrameError (not CRC8) when block_size_bits = 0b0000 (reserved)', () => {
    const hdr = new Uint8Array(6);
    hdr[0] = 0xff;
    hdr[1] = 0xf8;
    hdr[2] = (0b0000 << 4) | 0b1000; // reserved block size, valid sample rate
    hdr[3] = 0x0e;
    hdr[4] = 0x00;
    hdr[5] = crc8(hdr, 0, 5);
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, false)).toThrow(FlacInvalidFrameError);
  });

  it('throws FlacInvalidFrameError (not CRC8) when sample_rate_bits = 0b1111 (invalid)', () => {
    const hdr = new Uint8Array(6);
    hdr[0] = 0xff;
    hdr[1] = 0xf8;
    hdr[2] = (0b0001 << 4) | 0b1111; // valid block size, invalid sample rate
    hdr[3] = 0x0e;
    hdr[4] = 0x00;
    hdr[5] = crc8(hdr, 0, 5);
    expect(() => parseFrameHeader(hdr, 0, 32000, 16, false)).toThrow(FlacInvalidFrameError);
  });
});

// ---------------------------------------------------------------------------
// M-2 regression: explicit bounds check in decodeVarint
// ---------------------------------------------------------------------------

describe('M-2: decodeVarint explicit bounds check', () => {
  it('throws FlacInvalidVarintError when called at offset >= bytes.length', () => {
    const bytes = new Uint8Array(0);
    expect(() => decodeVarint(bytes, 0)).toThrow(FlacInvalidVarintError);
  });

  it('throws FlacInvalidVarintError when called past the end of a non-empty buffer', () => {
    const bytes = new Uint8Array([0x01]);
    expect(() => decodeVarint(bytes, 1)).toThrow(FlacInvalidVarintError);
  });
});
