/**
 * STREAMINFO block decoder and encoder.
 *
 * The STREAMINFO block body is exactly 34 bytes. Its fields are bit-packed
 * at non-byte-aligned boundaries, requiring a bitwise reader.
 *
 * Layout (big-endian MSB-first):
 *   bits  0–15   min_block_size (16 bits)
 *   bits 16–31   max_block_size (16 bits)
 *   bits 32–55   min_frame_size (24 bits)
 *   bits 56–79   max_frame_size (24 bits)
 *   bits 80–99   sample_rate (20 bits) — CROSSES byte boundary (Trap #6)
 *   bits 100–102 channels - 1 (3 bits)
 *   bits 103–107 bits_per_sample - 1 (5 bits)
 *   bits 108–143 total_samples (36 bits) — 0 = unknown (Trap #9)
 *   bits 144–271 MD5 signature (128 bits = 16 bytes)
 *
 * Total: 272 bits = 34 bytes. ✓
 *
 * Refs: https://xiph.org/flac/format.html#metadata_block_streaminfo
 */

import { FlacInvalidMetadataError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

export interface FlacStreamInfo {
  minBlockSize: number;
  maxBlockSize: number;
  /** 0 = unknown */
  minFrameSize: number;
  /** 0 = unknown */
  maxFrameSize: number;
  sampleRate: number;
  channels: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** 4..32 */
  bitsPerSample: number;
  /** 0 = unknown (Trap #9) */
  totalSamples: number;
  /** 16 bytes */
  md5: Uint8Array;
}

// ---------------------------------------------------------------------------
// STREAMINFO body size
// ---------------------------------------------------------------------------

export const STREAMINFO_SIZE = 34;

// ---------------------------------------------------------------------------
// Bit reader (internal helper)
// ---------------------------------------------------------------------------

class BitReader {
  private readonly data: Uint8Array;
  private bitPos: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.bitPos = 0;
  }

  /** Read `n` bits (1–32) from the stream, MSB first. */
  readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      const byteIndex = Math.floor(this.bitPos / 8);
      const bitIndex = 7 - (this.bitPos % 8);
      // Caller must ensure enough bytes; decodeStreamInfo validates body length.
      const bit = ((this.data[byteIndex] as number) >> bitIndex) & 1;
      result = (result << 1) | bit;
      this.bitPos++;
    }
    return result;
  }

  /** Current byte offset (floored). */
  byteOffset(): number {
    return Math.floor(this.bitPos / 8);
  }
}

// ---------------------------------------------------------------------------
// Bit writer (internal helper)
// ---------------------------------------------------------------------------

class BitWriter {
  private readonly data: Uint8Array;
  private bitPos: number;

  constructor(size: number) {
    this.data = new Uint8Array(size);
    this.bitPos = 0;
  }

  /** Write `n` bits (1–32), MSB first. */
  writeBits(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      const byteIndex = Math.floor(this.bitPos / 8);
      const bitIndex = 7 - (this.bitPos % 8);
      if (bit !== 0) {
        this.data[byteIndex] = (this.data[byteIndex] ?? 0) | (1 << bitIndex);
      }
      this.bitPos++;
    }
  }

  toUint8Array(): Uint8Array {
    return this.data;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode a 34-byte STREAMINFO block body into a FlacStreamInfo.
 *
 * @param body - Raw 34-byte body (NOT including the 4-byte block header).
 * @param offset - Byte offset in the file for error reporting.
 */
export function decodeStreamInfo(body: Uint8Array, offset: number): FlacStreamInfo {
  if (body.length < STREAMINFO_SIZE) {
    throw new FlacInvalidMetadataError(
      `STREAMINFO body too short: ${body.length} bytes (expected ${STREAMINFO_SIZE})`,
      offset,
    );
  }

  const br = new BitReader(body);

  const minBlockSize = br.readBits(16);
  const maxBlockSize = br.readBits(16);
  const minFrameSize = br.readBits(24);
  const maxFrameSize = br.readBits(24);
  // Trap #6: sample_rate is 20 bits crossing byte boundary at byte 10
  const sampleRate = br.readBits(20);
  const channelsMinusOne = br.readBits(3);
  const bitsPerSampleMinusOne = br.readBits(5);
  // total_samples is 36 bits — use two reads to stay in 32-bit safe range
  const totalSamplesHigh = br.readBits(4); // top 4 bits
  const totalSamplesLow = br.readBits(32); // bottom 32 bits
  // Combine: high * 2^32 + low. Use floating-point for large values.
  const totalSamples = totalSamplesHigh * 0x1_0000_0000 + totalSamplesLow;

  // MD5: 16 bytes starting at bit 144 = byte 18
  const md5Start = br.byteOffset();
  const md5 = body.slice(md5Start, md5Start + 16);

  const channels = (channelsMinusOne + 1) as FlacStreamInfo['channels'];

  if (channels < 1 || channels > 8) {
    throw new FlacInvalidMetadataError(`Invalid channel count: ${channels} (must be 1–8)`, offset);
  }

  if (sampleRate === 0 || sampleRate > 655350) {
    throw new FlacInvalidMetadataError(`Invalid sample rate: ${sampleRate}`, offset);
  }

  return {
    minBlockSize,
    maxBlockSize,
    minFrameSize,
    maxFrameSize,
    sampleRate,
    channels,
    bitsPerSample: bitsPerSampleMinusOne + 1,
    totalSamples,
    md5,
  };
}

/**
 * Encode a FlacStreamInfo into a 34-byte STREAMINFO block body.
 */
export function encodeStreamInfo(info: FlacStreamInfo): Uint8Array {
  const bw = new BitWriter(STREAMINFO_SIZE);

  bw.writeBits(info.minBlockSize, 16);
  bw.writeBits(info.maxBlockSize, 16);
  bw.writeBits(info.minFrameSize, 24);
  bw.writeBits(info.maxFrameSize, 24);
  bw.writeBits(info.sampleRate, 20);
  bw.writeBits(info.channels - 1, 3);
  bw.writeBits(info.bitsPerSample - 1, 5);

  // total_samples: 36 bits = top 4 + bottom 32
  const totalHigh = Math.floor(info.totalSamples / 0x1_0000_0000) & 0xf;
  const totalLow = info.totalSamples >>> 0; // unsigned 32-bit
  bw.writeBits(totalHigh, 4);
  bw.writeBits(totalLow, 32);

  // MD5: 16 bytes
  const out = bw.toUint8Array();
  for (let i = 0; i < 16; i++) {
    out[18 + i] = info.md5[i] ?? 0;
  }

  return out;
}
