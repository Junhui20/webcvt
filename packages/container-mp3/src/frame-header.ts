/**
 * MPEG audio frame header decode.
 *
 * Ref: ISO/IEC 11172-3:1993 §2.4 — Audio frame header and tables.
 * Ref: ISO/IEC 13818-3:1998 — MPEG-2 Layer III extension.
 *
 * Header layout (32 bits, big-endian):
 *   bits 31-21: sync word (0x7FF)
 *   bits 20-19: version  (11=MPEG-1, 10=MPEG-2, 00=MPEG-2.5, 01=reserved)
 *   bits 18-17: layer    (01=LayerIII, 10=LayerII, 11=LayerI, 00=reserved)
 *   bit  16:    protection_absent
 *   bits 15-12: bitrate_index
 *   bits 11-10: sampling_frequency
 *   bit   9:    padding_bit
 *   bit   8:    private_bit
 *   bits  7-6:  channel_mode
 *   bits  5-4:  mode_extension
 *   bit   3:    copyright
 *   bit   2:    original
 *   bits  1-0:  emphasis
 */

import { Mp3FreeFormatError, Mp3InvalidFrameError } from './errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sync check: top 11 bits of the first two bytes must be 0xFF and top 3 bits of b1 must be 0b111. */
const SYNC_BYTE0 = 0xff;
const SYNC_B1_MASK = 0xe0;

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

/**
 * Bitrate lookup table (kbps).
 *
 * Index: [version_class][layer3_index]  where version_class 0 = MPEG-1, 1 = MPEG-2/2.5
 * Row index is bitrate_index (0=free, 15=bad).
 * Only Layer III values are stored; other layers are out of scope.
 */
const BITRATE_TABLE: Readonly<Record<'1' | '2' | '2.5', readonly number[]>> = {
  '1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1],
  '2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1],
  '2.5': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1],
};

/**
 * Sample rate lookup table (Hz).
 * Index: [version][sampling_frequency_index]
 */
const SAMPLE_RATE_TABLE: Readonly<Record<'1' | '2' | '2.5', readonly number[]>> = {
  '1': [44100, 48000, 32000, -1],
  '2': [22050, 24000, 16000, -1],
  '2.5': [11025, 12000, 8000, -1],
};

/**
 * Samples per frame for Layer III by MPEG version.
 * MPEG-1: 1152, MPEG-2/2.5: 576.
 */
const SAMPLES_PER_FRAME: Readonly<Record<'1' | '2' | '2.5', 1152 | 576>> = {
  '1': 1152,
  '2': 576,
  '2.5': 576,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Mp3FrameHeader {
  version: '1' | '2' | '2.5';
  layer: 3;
  /** kbps; 0 = free-format (throws Mp3FreeFormatError before this is returned) */
  bitrate: number;
  sampleRate: number;
  channelMode: 'stereo' | 'joint' | 'dual' | 'mono';
  modeExtension: number;
  padding: boolean;
  /** true if CRC present (protection_absent bit == 0) */
  protected: boolean;
  /** Total frame size in bytes including header and CRC. */
  frameBytes: number;
  /** 1152 for MPEG-1 Layer III; 576 for MPEG-2/2.5 Layer III. */
  samplesPerFrame: 1152 | 576;
}

export interface Mp3Frame {
  header: Mp3FrameHeader;
  /** Full frame bytes including header, CRC, side info, main data. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a 4-byte MPEG frame header from `bytes` at `offset`.
 *
 * Returns `null` if the sync word (top 11 bits 0xFFE) is not present at the
 * given offset — this is the signal to the caller to scan forward.
 *
 * Throws:
 * - `Mp3FreeFormatError` — if bitrate_index == 0 (frame length undeducible)
 * - `Mp3InvalidFrameError` — if header fields are illegal (reserved version,
 *   non-Layer-III layer, reserved sampling frequency, bitrate_index == 15)
 */
export function parseMp3FrameHeader(bytes: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > bytes.length) return null;

  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;

  // Check sync word: byte 0 must be 0xFF and top 3 bits of byte 1 must be 0b111 (0xE0).
  if (b0 !== SYNC_BYTE0 || (b1 & SYNC_B1_MASK) !== SYNC_B1_MASK) return null;

  // Pack all 4 bytes into an unsigned 32-bit word for field extraction.
  // Note: JS bitwise ops work on signed 32-bit; use >>> to shift into positive range.
  const word = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;

  // Extract fields.
  const versionBits = (word >>> 19) & 0x3;
  const layerBits = (word >>> 17) & 0x3;
  const protectionAbsent = (word >>> 16) & 0x1;
  const bitrateIndex = (word >>> 12) & 0xf;
  const sampleRateIndex = (word >>> 10) & 0x3;
  const paddingBit = (word >>> 9) & 0x1;
  const channelModeBits = (word >>> 6) & 0x3;
  const modeExtension = (word >>> 4) & 0x3;

  // Validate version.
  if (versionBits === 0x1) {
    // 01 = reserved
    throw new Mp3InvalidFrameError('version bits 01 are reserved', offset);
  }

  const version = versionBitsToVersion(versionBits);

  // Validate layer — only Layer III (bits 01) is in scope.
  if (layerBits === 0x0) {
    throw new Mp3InvalidFrameError('layer bits 00 are reserved', offset);
  }
  if (layerBits !== 0x1) {
    // 11=LayerI, 10=LayerII — not Layer III
    throw new Mp3InvalidFrameError(
      `layer ${layerBitsToNumber(layerBits)} is not Layer III (only Layer III is supported)`,
      offset,
    );
  }

  // Validate bitrate_index.
  if (bitrateIndex === 0) {
    throw new Mp3FreeFormatError(offset);
  }
  if (bitrateIndex === 0xf) {
    throw new Mp3InvalidFrameError('bitrate_index 15 (0xF) is invalid/reserved', offset);
  }

  // Validate sampling_frequency.
  if (sampleRateIndex === 0x3) {
    throw new Mp3InvalidFrameError('sampling_frequency index 3 is reserved', offset);
  }

  // Resolve bitrate and sample rate from lookup tables.
  const bitrate = BITRATE_TABLE[version][bitrateIndex] ?? -1;
  if (bitrate <= 0) {
    throw new Mp3InvalidFrameError(
      `invalid bitrate index ${bitrateIndex} for MPEG ${version}`,
      offset,
    );
  }

  const sampleRate = SAMPLE_RATE_TABLE[version][sampleRateIndex] ?? -1;
  if (sampleRate <= 0) {
    throw new Mp3InvalidFrameError(`invalid sample rate index ${sampleRateIndex}`, offset);
  }

  const padding = paddingBit === 1;
  const channelMode = channelModeBitsToMode(channelModeBits);

  // Compute frame length.
  // MPEG-1: floor(144 * bitrate_bps / sample_rate) + padding
  // MPEG-2 / 2.5: floor(72 * bitrate_bps / sample_rate) + padding
  const bitrateBps = bitrate * 1000;
  const frameBytes =
    version === '1'
      ? Math.floor((144 * bitrateBps) / sampleRate) + (padding ? 1 : 0)
      : Math.floor((72 * bitrateBps) / sampleRate) + (padding ? 1 : 0);

  const samplesPerFrame = SAMPLES_PER_FRAME[version];

  // Defensive: a 4-byte minimum protects the calling scanner from infinite loops
  // if a future spec table edit ever produced a smaller value. All legitimate
  // Layer III frames are far larger than 4 bytes; this branch is unreachable
  // through valid spec combinations.
  if (frameBytes < 4) {
    return null;
  }

  return {
    version,
    layer: 3,
    bitrate,
    sampleRate,
    channelMode,
    modeExtension,
    padding,
    protected: protectionAbsent === 0,
    frameBytes,
    samplesPerFrame,
  };
}

/**
 * Returns the number of side-information bytes for a Layer III frame.
 * Used to locate the Xing/Info header within the first frame.
 *
 * MPEG-1 stereo: 32 bytes; MPEG-1 mono: 17 bytes.
 * MPEG-2/2.5 stereo: 17 bytes; MPEG-2/2.5 mono: 9 bytes.
 */
export function sideInfoSize(header: Mp3FrameHeader): number {
  const mono = header.channelMode === 'mono';
  if (header.version === '1') {
    return mono ? 17 : 32;
  }
  return mono ? 9 : 17;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function versionBitsToVersion(bits: number): '1' | '2' | '2.5' {
  if (bits === 0x3) return '1';
  if (bits === 0x2) return '2';
  return '2.5'; // bits === 0x0; 0x1 is reserved (already rejected above)
}

function layerBitsToNumber(bits: number): number {
  // bits 11=I, 10=II, 01=III, 00=reserved
  if (bits === 0x3) return 1;
  if (bits === 0x2) return 2;
  if (bits === 0x1) return 3;
  return 0;
}

function channelModeBitsToMode(bits: number): 'stereo' | 'joint' | 'dual' | 'mono' {
  if (bits === 0x0) return 'stereo';
  if (bits === 0x1) return 'joint';
  if (bits === 0x2) return 'dual';
  return 'mono'; // bits === 0x3
}
