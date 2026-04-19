/**
 * FLAC audio frame header decoder.
 *
 * Frame header layout (§9.1):
 *   14 bits sync code: 0b11111111111110 (0x3FFE)
 *    1 bit reserved (must be 0)
 *    1 bit blocking_strategy: 0=fixed, 1=variable
 *    4 bits block_size_bits (lookup; 0b0110/0b0111 = uncommon 8/16-bit after header)
 *    4 bits sample_rate_bits (lookup; 0b1100/0b1101/0b1110 = uncommon after header)
 *    4 bits channel_assignment (0-7=raw, 8=left+side, 9=side+right, 10=mid+side)
 *    3 bits sample_size_bits (lookup)
 *    1 bit reserved (0)
 *   var  UTF-8 coded frame_number (fixed) or sample_number (variable)
 *   var  uncommon block size (if block_size_bits == 0b0110 or 0b0111) — AFTER the varint (Trap #7)
 *   var  uncommon sample rate (if sample_rate_bits == 0b1100..0b1110) — AFTER the uncommon block size
 *    8   CRC-8 of everything so far (poly 0x07, init 0)
 *
 * Refs: https://xiph.org/flac/format.html#frame_header
 */

import { crc8 } from './crc.ts';
import { FlacCrc8MismatchError, FlacInvalidFrameError, FlacInvalidVarintError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChannelAssignment = 'raw' | 'left+side' | 'side+right' | 'mid+side';

export interface FlacFrame {
  /**
   * For variable-blocksize: sample number of first sample.
   * For fixed-blocksize: frame_number * blockSize.
   */
  sampleNumber: number;
  blockSize: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  channelAssignment: ChannelAssignment;
  /** Full frame bytes from sync through CRC-16 inclusive. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Sync code
// ---------------------------------------------------------------------------

export const FRAME_SYNC_CODE = 0x3ffe; // 14-bit sync: 0b11111111111110

// ---------------------------------------------------------------------------
// UTF-8 style variable-length integer decoder (Trap #1)
//
// FLAC uses an extended UTF-8 scheme that allows up to 36 bits of payload
// via a 7-byte form:
//
//   Bytes  Bits  Lead byte pattern  Payload bits
//   1      7     0xxxxxxx           7
//   2      11    110xxxxx 10xxxxxx  11
//   3      16    1110xxxx 10xxxxxx 10xxxxxx  16
//   4      21    11110xxx ...       21
//   5      26    111110xx ...       26
//   6      31    1111110x ...       31
//   7      36    11111110 ...       36 (lead byte carries 0 payload bits)
//
// Standard UTF-8 stops at 4 bytes / 21 bits. Do NOT use TextDecoder here.
// ---------------------------------------------------------------------------

/**
 * Decode an extended UTF-8 variable-length integer from `bytes` at `offset`.
 *
 * @returns `{ value, bytesRead }` — value as a JS number (safe up to 36 bits
 *          since Number.MAX_SAFE_INTEGER > 2^53).
 * @throws FlacInvalidVarintError on malformed encoding.
 */
export function decodeVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; bytesRead: number } {
  // M-2: Explicit bounds check instead of ?? 0 to catch truncated inputs.
  if (offset >= bytes.length) {
    throw new FlacInvalidVarintError(offset);
  }
  const lead = bytes[offset] as number;

  let extraBytes: number;
  let value: number;

  if ((lead & 0x80) === 0) {
    // 1-byte form: 0xxxxxxx
    return { value: lead, bytesRead: 1 };
  }
  if ((lead & 0xe0) === 0xc0) {
    // 2-byte form: 110xxxxx
    extraBytes = 1;
    value = lead & 0x1f;
  } else if ((lead & 0xf0) === 0xe0) {
    // 3-byte form: 1110xxxx
    extraBytes = 2;
    value = lead & 0x0f;
  } else if ((lead & 0xf8) === 0xf0) {
    // 4-byte form: 11110xxx
    extraBytes = 3;
    value = lead & 0x07;
  } else if ((lead & 0xfc) === 0xf8) {
    // 5-byte form: 111110xx
    extraBytes = 4;
    value = lead & 0x03;
  } else if ((lead & 0xfe) === 0xfc) {
    // 6-byte form: 1111110x
    extraBytes = 5;
    value = lead & 0x01;
  } else if (lead === 0xfe) {
    // 7-byte form (extended, non-standard): 11111110
    // Lead byte carries 0 payload bits — all 36 bits come from 6 continuations.
    extraBytes = 6;
    value = 0;
  } else {
    throw new FlacInvalidVarintError(offset);
  }

  for (let i = 1; i <= extraBytes; i++) {
    const cb = bytes[offset + i];
    if (cb === undefined || (cb & 0xc0) !== 0x80) {
      throw new FlacInvalidVarintError(offset);
    }
    value = value * 64 + (cb & 0x3f);
  }

  return { value, bytesRead: extraBytes + 1 };
}

/**
 * Encode a non-negative integer as an extended UTF-8 variable-length integer.
 *
 * @param value - Non-negative integer, up to 36 bits.
 * @returns Encoded bytes (1–7 bytes).
 */
export function encodeVarint(value: number): Uint8Array {
  if (value < 0x80) {
    return new Uint8Array([value]);
  }
  if (value < 0x800) {
    return new Uint8Array([0xc0 | (value >> 6), 0x80 | (value & 0x3f)]);
  }
  if (value < 0x10000) {
    return new Uint8Array([
      0xe0 | (value >> 12),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ]);
  }
  if (value < 0x200000) {
    return new Uint8Array([
      0xf0 | (value >> 18),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ]);
  }
  if (value < 0x4000000) {
    return new Uint8Array([
      0xf8 | (value >> 24),
      0x80 | ((value >> 18) & 0x3f),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ]);
  }
  if (value < 0x80000000) {
    return new Uint8Array([
      0xfc | (value >> 30),
      0x80 | ((value >> 24) & 0x3f),
      0x80 | ((value >> 18) & 0x3f),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ]);
  }
  // 7-byte extended form for values >= 2^31 (up to 36 bits)
  // Lead byte: 0xFE (no payload bits); 6 continuation bytes of 6 bits each
  const b5 = (value / 0x40) & 0x3f; // avoid >> on large numbers
  const b6 = value & 0x3f;
  const v2 = Math.floor(value / 0x1000);
  const b4 = v2 & 0x3f;
  const v3 = Math.floor(value / 0x40000);
  const b3 = v3 & 0x3f;
  const v4 = Math.floor(value / 0x1000000);
  const b2 = v4 & 0x3f;
  const v5 = Math.floor(value / 0x40000000);
  const b1 = v5 & 0x3f;
  return new Uint8Array([0xfe, 0x80 | b1, 0x80 | b2, 0x80 | b3, 0x80 | b4, 0x80 | b5, 0x80 | b6]);
}

// ---------------------------------------------------------------------------
// Block size lookup table
// ---------------------------------------------------------------------------

/**
 * Resolve block size from block_size_bits nibble.
 * Returns null when the value is uncommon (needs extra bytes after varint).
 */
function resolveBlockSize(
  bits: number,
  bytes: Uint8Array,
  pos: number,
): { blockSize: number; extraBytes: number } | null {
  if (bits === 0b0001) return { blockSize: 192, extraBytes: 0 };
  if (bits >= 0b0010 && bits <= 0b0101) {
    return { blockSize: 576 * (1 << (bits - 2)), extraBytes: 0 };
  }
  if (bits === 0b0110) {
    // 8-bit uncommon (Trap #7: comes AFTER the varint)
    // M-2: Explicit bounds check.
    if (pos >= bytes.length) throw new FlacInvalidVarintError(pos);
    return { blockSize: (bytes[pos] as number) + 1, extraBytes: 1 };
  }
  if (bits === 0b0111) {
    // 16-bit uncommon
    // M-2: Explicit bounds check.
    if (pos + 1 >= bytes.length) throw new FlacInvalidVarintError(pos);
    const val = ((bytes[pos] as number) << 8) | (bytes[pos + 1] as number);
    return { blockSize: val + 1, extraBytes: 2 };
  }
  if (bits >= 0b1000 && bits <= 0b1111) {
    return { blockSize: 256 * (1 << (bits - 8)), extraBytes: 0 };
  }
  return null; // bits == 0 → reserved
}

// ---------------------------------------------------------------------------
// Sample rate lookup table
// ---------------------------------------------------------------------------

/**
 * Resolve sample rate from sample_rate_bits nibble.
 * Returns null when the value is from STREAMINFO (bits == 0) or uncommon.
 */
function resolveSampleRate(
  bits: number,
  streaminfoRate: number,
  bytes: Uint8Array,
  pos: number,
): { sampleRate: number; extraBytes: number } | null {
  const RATES: Array<number | null> = [
    null, // 0000 = get from STREAMINFO
    88200,
    176400,
    192000,
    8000,
    16000,
    22050,
    24000,
    32000,
    44100,
    48000,
    96000,
    null, // 1100 = 8-bit uncommon (kHz * 1000 in Hz? No: see spec — 8-bit in kHz)
    null, // 1101 = 16-bit uncommon (Hz)
    null, // 1110 = 16-bit uncommon (10*Hz)
    null, // 1111 = invalid
  ];

  if (bits === 0b0000) return { sampleRate: streaminfoRate, extraBytes: 0 };
  if (bits === 0b1111) return null; // invalid
  if (bits === 0b1100) {
    // M-2: Explicit bounds check.
    if (pos >= bytes.length) throw new FlacInvalidVarintError(pos);
    return { sampleRate: (bytes[pos] as number) * 1000, extraBytes: 1 };
  }
  if (bits === 0b1101) {
    // M-2: Explicit bounds check.
    if (pos + 1 >= bytes.length) throw new FlacInvalidVarintError(pos);
    const hz = ((bytes[pos] as number) << 8) | (bytes[pos + 1] as number);
    return { sampleRate: hz, extraBytes: 2 };
  }
  if (bits === 0b1110) {
    // M-2: Explicit bounds check.
    if (pos + 1 >= bytes.length) throw new FlacInvalidVarintError(pos);
    const hz10 = ((bytes[pos] as number) << 8) | (bytes[pos + 1] as number);
    return { sampleRate: hz10 * 10, extraBytes: 2 };
  }
  const rate = RATES[bits];
  return rate !== null && rate !== undefined ? { sampleRate: rate, extraBytes: 0 } : null;
}

// ---------------------------------------------------------------------------
// Sample size lookup
// ---------------------------------------------------------------------------

function resolveBitsPerSample(bits: number, streaminfoSampleSize: number): number {
  const SIZES = [streaminfoSampleSize, 8, 12, 0, 16, 20, 24, 32];
  return SIZES[bits] ?? 0;
}

// ---------------------------------------------------------------------------
// Channel assignment lookup
// ---------------------------------------------------------------------------

function resolveChannelAssignment(nibble: number): {
  channels: number;
  assignment: ChannelAssignment;
} {
  if (nibble <= 7) return { channels: nibble + 1, assignment: 'raw' };
  if (nibble === 8) return { channels: 2, assignment: 'left+side' };
  if (nibble === 9) return { channels: 2, assignment: 'side+right' };
  if (nibble === 10) return { channels: 2, assignment: 'mid+side' };
  // 11–15 reserved
  return { channels: 0, assignment: 'raw' };
}

// ---------------------------------------------------------------------------
// Frame header parser
// ---------------------------------------------------------------------------

export interface ParsedFrameHeader {
  sampleNumber: number;
  blockSize: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  channelAssignment: ChannelAssignment;
  /** Number of bytes this header occupies (up to and including the CRC-8 byte). */
  headerBytes: number;
}

/**
 * Parse a FLAC frame header from `bytes` at `offset`.
 *
 * @param bytes - Full file/frame buffer.
 * @param offset - Byte offset of the first sync byte (0xFF).
 * @param streaminfoSampleRate - From STREAMINFO, used when frame header says "from streaminfo".
 * @param streaminfoSampleSize - From STREAMINFO bits_per_sample.
 * @param verifyCrc - If true, verify CRC-8 and throw on mismatch.
 *
 * @throws FlacInvalidVarintError, FlacCrc8MismatchError
 */
export function parseFrameHeader(
  bytes: Uint8Array,
  offset: number,
  streaminfoSampleRate: number,
  streaminfoSampleSize: number,
  verifyCrc = true,
): ParsedFrameHeader {
  // Bytes 0–1: sync (14 bits) + reserved (1) + blocking_strategy (1)
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;

  // sync is top 14 bits of the two bytes
  const sync = ((b0 << 6) | (b1 >> 2)) & 0x3fff;
  if (sync !== FRAME_SYNC_CODE) {
    throw new FlacCrc8MismatchError(offset, FRAME_SYNC_CODE, sync);
  }

  const variableBlocksize = (b1 & 0x01) !== 0;

  // Byte 2: block_size_bits (4) + sample_rate_bits (4)
  const b2 = bytes[offset + 2] ?? 0;
  const blockSizeBits = (b2 >> 4) & 0x0f;
  const sampleRateBits = b2 & 0x0f;

  // Byte 3: channel_assignment (4) + sample_size_bits (3) + reserved (1)
  const b3 = bytes[offset + 3] ?? 0;
  const channelNibble = (b3 >> 4) & 0x0f;
  const sampleSizeBits = (b3 >> 1) & 0x07;

  const { channels, assignment: channelAssignment } = resolveChannelAssignment(channelNibble);
  const bitsPerSampleFromHeader = resolveBitsPerSample(sampleSizeBits, streaminfoSampleSize);

  // Byte 4+: UTF-8 varint for frame/sample number
  const varintOffset = offset + 4;
  const { value: rawNumber, bytesRead: varintBytes } = decodeVarint(bytes, varintOffset);

  let pos = varintOffset + varintBytes;

  // Trap #7: uncommon block size / sample rate come AFTER the varint
  const blockSizeResult = resolveBlockSize(blockSizeBits, bytes, pos);
  if (blockSizeResult === null) {
    // Q-2: Reserved block-size nibble — this is a frame format error, not a CRC error.
    throw new FlacInvalidFrameError(
      `Reserved block_size_bits nibble 0x${blockSizeBits.toString(16)} at offset ${offset}`,
      offset,
    );
  }
  pos += blockSizeResult.extraBytes;

  const sampleRateResult = resolveSampleRate(sampleRateBits, streaminfoSampleRate, bytes, pos);
  if (sampleRateResult === null) {
    // Q-2: Reserved/invalid sample-rate nibble — this is a frame format error, not a CRC error.
    throw new FlacInvalidFrameError(
      `Reserved sample_rate_bits nibble 0x${sampleRateBits.toString(16)} at offset ${offset}`,
      offset,
    );
  }
  pos += sampleRateResult.extraBytes;

  // CRC-8 byte
  const crc8Byte = bytes[pos] ?? 0;
  const headerBytes = pos - offset + 1; // including CRC-8

  if (verifyCrc) {
    const computed = crc8(bytes, offset, pos);
    if (computed !== crc8Byte) {
      throw new FlacCrc8MismatchError(offset, crc8Byte, computed);
    }
  }

  // Resolve sample number: in variable-blocksize mode, rawNumber IS the sample number.
  // In fixed-blocksize mode, rawNumber is the frame number; sample = frame * blockSize.
  const sampleNumber = variableBlocksize ? rawNumber : rawNumber * blockSizeResult.blockSize;

  const bitsPerSample =
    bitsPerSampleFromHeader !== 0 ? bitsPerSampleFromHeader : streaminfoSampleSize;

  return {
    sampleNumber,
    blockSize: blockSizeResult.blockSize,
    sampleRate: sampleRateResult.sampleRate,
    channels,
    bitsPerSample,
    channelAssignment,
    headerBytes,
  };
}
