/**
 * ADTS header bit-pack decode and encode.
 *
 * ADTS frame layout (7 bytes fixed + optional 2-byte CRC):
 *
 * byte  bits  field
 *  0    1111 1111                sync word (high 8 bits)
 *  1    1111                     sync word (low 4 bits)
 *  1       1  id                 0=MPEG-4, 1=MPEG-2
 *  1       2  layer              always 00
 *  1       1  protection_absent  1=no CRC, 0=2-byte CRC follows header
 *  2       2  profile_ObjectType_minus_1  00=MAIN 01=LC 10=SSR 11=LTP
 *  2       4  sampling_frequency_index   0..12 valid, 13/14 reserved, 15=explicit
 *  2       1  private_bit        ignored
 *  2    3+3   channel_configuration  high bit at byte2[0], low 2 at byte3[7:6]
 *  3       1  original_copy      ignored
 *  3       1  home               ignored
 *  3       1  copyright_identification_bit
 *  3       1  copyright_identification_start
 *  3    2+8   aac_frame_length   high 2 at byte3[1:0], mid 8 at byte4, low 3 at byte5[7:5]
 *  5       11 adts_buffer_fullness  0x7FF=VBR
 *  6       2  number_of_raw_data_blocks_in_frame  (value 0 = 1 block)
 * [7       16 crc_check          present only when protection_absent==0]
 *
 * Refs: ISO/IEC 14496-3:2019 §1.A.2; ISO/IEC 13818-7:2006 §6.2
 */

import {
  AdtsInvalidLayerError,
  AdtsPceRequiredError,
  AdtsReservedSampleRateError,
  AdtsTruncatedFrameError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AdtsProfile = 'MAIN' | 'LC' | 'SSR' | 'LTP';

export interface AdtsHeader {
  /** MPEG version: 0 bit = MPEG-4 (id=0), 1 bit = MPEG-2 (id=1). */
  mpegVersion: 2 | 4;
  /** Audio object type name (ISO/IEC 14496-3 §1.A.2 profile_ObjectType - 1 mapping). */
  profile: AdtsProfile;
  /** Sample rate in Hz, resolved from sampleRateIndex. */
  sampleRate: number;
  /** Raw sampling_frequency_index (0..12). */
  sampleRateIndex: number;
  /** Channel configuration (0=PCE, 1=mono, 2=stereo, 3..7=surround). */
  channelConfiguration: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Total frame length in bytes including header (and CRC if present). */
  frameBytes: number;
  /** true when protection_absent==0 (CRC present, 9-byte header). */
  hasCrc: boolean;
  /** 16-bit CRC value when hasCrc==true (protection_absent==0). */
  crc?: number;
  /** adts_buffer_fullness (0..0x7FE = CBR level, 0x7FF = VBR). */
  bufferFullness: number;
  /** number_of_raw_data_blocks_in_frame (0 = 1 block). */
  rawBlocks: number;
}

export interface AdtsFrame {
  header: AdtsHeader;
  /**
   * Full frame bytes including ADTS header + optional CRC + access unit payload.
   * Stored as a subarray view during parsing (zero-copy). Callers that need an
   * owned copy should call .slice() themselves.
   */
  data: Uint8Array;
}

export interface AdtsFile {
  frames: AdtsFrame[];
}

// ---------------------------------------------------------------------------
// Sampling frequency index table (ISO/IEC 14496-3 §1.6.3.3)
// ---------------------------------------------------------------------------

export const SAMPLE_RATE_TABLE: readonly number[] = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

const PROFILE_NAMES: readonly AdtsProfile[] = ['MAIN', 'LC', 'SSR', 'LTP'];

/** Maximum valid profile index (0-based: 0=MAIN, 1=LC, 2=SSR, 3=LTP). */
export const PROFILE_INDEX_MAX = 3;

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Parse an ADTS frame header starting at `offset` in `buf`.
 *
 * Assumes buf[offset] === 0xFF and (buf[offset+1] & 0xF0) === 0xF0 (sync word
 * already verified by caller). Validates layer, sampleRateIndex, channelConfiguration.
 *
 * @returns Parsed AdtsHeader
 * @throws AdtsInvalidLayerError, AdtsReservedSampleRateError, AdtsPceRequiredError
 */
export function parseAdtsHeader(buf: Uint8Array, offset: number): AdtsHeader {
  // Byte 1: 1111 | id | layer(2) | protection_absent
  const b1 = buf[offset + 1] as number;
  const id = (b1 >> 3) & 0x1;
  const layer = (b1 >> 1) & 0x3;
  const protectionAbsent = b1 & 0x1;

  if (layer !== 0) {
    throw new AdtsInvalidLayerError(offset, layer);
  }

  // Byte 2: profile(2) | sfi(4) | private(1) | channelHigh(1)
  const b2 = buf[offset + 2] as number;
  const profileRaw = (b2 >> 6) & 0x3;
  const sfi = (b2 >> 2) & 0xf;
  const channelHigh = b2 & 0x1;

  if (sfi >= 13) {
    throw new AdtsReservedSampleRateError(offset, sfi);
  }

  // Byte 3: channelLow(2) | originalCopy(1) | home(1) | copyrightIdBit(1) | copyrightIdStart(1) | frameLenHigh(2)
  const b3 = buf[offset + 3] as number;
  const channelLow = (b3 >> 6) & 0x3;
  const channelConfig = ((channelHigh << 2) | channelLow) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const frameLenHigh = b3 & 0x3; // high 2 bits of 13-bit aac_frame_length

  if (channelConfig === 0) {
    throw new AdtsPceRequiredError(offset);
  }

  // Byte 4: middle 8 bits of aac_frame_length
  const b4 = buf[offset + 4] as number;

  // Byte 5: low 3 bits of aac_frame_length at bits 7-5, then adts_buffer_fullness high 8 bits
  const b5 = buf[offset + 5] as number;
  const frameLenLow = (b5 >> 5) & 0x7; // low 3 bits
  const frameBytes = (frameLenHigh << 11) | (b4 << 3) | frameLenLow;

  // Byte 5 bits 4-0: buffer_fullness high 5 bits
  // Byte 6 bits 7-3: buffer_fullness low 6 bits; bits 2-1: rawBlocks
  const b6 = buf[offset + 6] as number;
  const bufferFullness = ((b5 & 0x1f) << 6) | (b6 >> 2);
  const rawBlocks = b6 & 0x3;

  // CRC is present when protection_absent == 0 (9-byte header)
  const hasCrc = protectionAbsent === 0;
  let crc: number | undefined;
  if (hasCrc) {
    if (offset + 9 > buf.length) {
      throw new AdtsTruncatedFrameError(offset, 9, buf.length - offset);
    }
    const b7 = buf[offset + 7] as number;
    const b8 = buf[offset + 8] as number;
    crc = (b7 << 8) | b8;
  }

  const sampleRate = SAMPLE_RATE_TABLE[sfi] as number;
  const profile = PROFILE_NAMES[profileRaw] as AdtsProfile;

  return {
    mpegVersion: id === 0 ? 4 : 2,
    profile,
    sampleRate,
    sampleRateIndex: sfi,
    channelConfiguration: channelConfig,
    frameBytes,
    hasCrc,
    crc,
    bufferFullness,
    rawBlocks,
  };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Serialize an AdtsHeader to a 7-byte (protection_absent=1) or 9-byte
 * (protection_absent=0) header buffer.
 *
 * The CRC field (bytes 7-8) is written verbatim from header.crc when hasCrc is true.
 * Fresh CRC computation is NOT performed (Phase 1 round-trip only).
 */
export function encodeAdtsHeader(header: AdtsHeader, payloadLength: number): Uint8Array {
  const headerSize = header.hasCrc ? 9 : 7;
  const frameBytes = headerSize + payloadLength;
  const out = new Uint8Array(headerSize);

  // Byte 0: sync high 8 bits
  out[0] = 0xff;

  // Byte 1: sync low 4 bits | id | layer(2) | protection_absent
  const id = header.mpegVersion === 4 ? 0 : 1;
  const protectionAbsent = header.hasCrc ? 0 : 1;
  out[1] = 0xf0 | (id << 3) | (0 << 1) | protectionAbsent;

  // Byte 2: profile(2) | sfi(4) | private_bit(0) | channelHigh(1)
  const profileRaw = PROFILE_NAMES.indexOf(header.profile) & 0x3;
  const channelHigh = (header.channelConfiguration >> 2) & 0x1;
  out[2] = (profileRaw << 6) | (header.sampleRateIndex << 2) | channelHigh;

  // Byte 3: channelLow(2) | original(0) | home(0) | copyrightIdBit(0) | copyrightIdStart(0) | frameLenHigh(2)
  const channelLow = header.channelConfiguration & 0x3;
  const frameLenHigh = (frameBytes >> 11) & 0x3;
  out[3] = (channelLow << 6) | frameLenHigh;

  // Byte 4: middle 8 bits of frameBytes
  out[4] = (frameBytes >> 3) & 0xff;

  // Byte 5: low 3 bits of frameBytes at bits 7-5 | bufferFullness high 5 bits at bits 4-0
  const frameLenLow = frameBytes & 0x7;
  const bufHigh = (header.bufferFullness >> 6) & 0x1f;
  out[5] = (frameLenLow << 5) | bufHigh;

  // Byte 6: bufferFullness low 6 bits at bits 7-2 | rawBlocks at bits 1-0
  const bufLow = header.bufferFullness & 0x3f;
  out[6] = (bufLow << 2) | (header.rawBlocks & 0x3);

  // Bytes 7-8: CRC (preserved verbatim from parse)
  if (header.hasCrc && header.crc !== undefined) {
    out[7] = (header.crc >> 8) & 0xff;
    out[8] = header.crc & 0xff;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if bytes at `offset` carry a valid 12-bit ADTS sync word (0xFFF).
 * Does NOT validate the rest of the header.
 */
export function hasSyncAt(buf: Uint8Array, offset: number): boolean {
  if (offset + 1 >= buf.length) return false;
  return buf[offset] === 0xff && ((buf[offset + 1] as number) & 0xf0) === 0xf0;
}
