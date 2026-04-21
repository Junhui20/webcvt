/**
 * av1C (AV1 Codec Configuration Record) parser.
 *
 * Spec: AV1-ISOBMFF v1.2.0 §2.3
 *
 * Wire format (av1C box payload — NOT a FullBox):
 *   [0]    marker:1(=1) | version:7(=1)
 *   [1]    seq_profile:3 | seq_level_idx_0:5
 *   [2]    seq_tier_0:1 | high_bitdepth:1 | twelve_bit:1 | monochrome:1 |
 *          chroma_subsampling_x:1 | chroma_subsampling_y:1 | chroma_sample_position:2
 *   [3]    000:3 | initial_presentation_delay_present:1 |
 *          initial_presentation_delay_minus_one_or_reserved:4
 *   [4..]  configOBUs:bytes
 *
 * All multi-byte fields are big-endian (none here — all bytes are single or bit-packed).
 */

import { Mp4Av1CBadMarkerError, Mp4Av1CMissingError, Mp4InvalidBoxError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4Av1Config {
  readonly kind: 'av1C';
  /** Verbatim av1C payload — emitted unchanged on round-trip. */
  readonly bytes: Uint8Array;
  readonly seqProfile: number;
  readonly seqLevelIdx0: number;
  readonly seqTier0: 0 | 1;
  readonly highBitdepth: 0 | 1;
  readonly twelveBit: 0 | 1;
  readonly monochrome: 0 | 1;
  readonly chromaSubsamplingX: 0 | 1;
  readonly chromaSubsamplingY: 0 | 1;
  readonly chromaSamplePosition: number;
  readonly initialPresentationDelayPresent: 0 | 1;
  /** 4-bit value: delay_minus_one when present, reserved when absent. */
  readonly initialPresentationDelayMinusOne: number;
  /** Remaining bytes after the 4-byte header (configOBUs). */
  readonly configObus: Uint8Array;
}

// Re-export so caller can import from one place.
export { Mp4Av1CMissingError };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an av1C box payload into Mp4Av1Config.
 *
 * @param payload  Raw bytes of the av1C box payload (after the 8-byte box header).
 * @throws Mp4Av1CBadMarkerError   byte 0 marker bit != 1 or version bits != 1
 * @throws Mp4InvalidBoxError      payload too short (< 4 bytes)
 */
export function parseAv1C(payload: Uint8Array): Mp4Av1Config {
  // Minimum 4 bytes: the fixed header.
  if (payload.length < 4) {
    throw new Mp4InvalidBoxError(
      `av1C payload too short (${payload.length} bytes); need at least 4.`,
    );
  }

  // Defensive copy for verbatim round-trip.
  const bytes = payload.slice();

  // [0] marker:1(must=1) | version:7(must=1)
  // AV1-ISOBMFF §2.3.3: "The value of the marker field shall be set to 1."
  // "The value of the version field shall be set to 1."
  // v8 ignores: Uint8Array[i] never returns undefined; ?? 0 fallback is unreachable.
  /* v8 ignore next */
  const byte0 = payload[0] ?? 0;
  const marker = (byte0 >> 7) & 0x01; // bit [7]
  const version = byte0 & 0x7f; // bits [6:0]
  if (marker !== 1 || version !== 1) {
    throw new Mp4Av1CBadMarkerError(byte0);
  }

  // [1] seq_profile:3 | seq_level_idx_0:5
  /* v8 ignore next */
  const byte1 = payload[1] ?? 0;
  const seqProfile = (byte1 >> 5) & 0x07; // bits [7:5]
  const seqLevelIdx0 = byte1 & 0x1f; // bits [4:0]

  // [2] seq_tier_0:1 | high_bitdepth:1 | twelve_bit:1 | monochrome:1 |
  //     chroma_subsampling_x:1 | chroma_subsampling_y:1 | chroma_sample_position:2
  /* v8 ignore next */
  const byte2 = payload[2] ?? 0;
  const seqTier0 = ((byte2 >> 7) & 0x01) as 0 | 1; // bit [7]
  const highBitdepth = ((byte2 >> 6) & 0x01) as 0 | 1; // bit [6]
  const twelveBit = ((byte2 >> 5) & 0x01) as 0 | 1; // bit [5]
  const monochrome = ((byte2 >> 4) & 0x01) as 0 | 1; // bit [4]
  const chromaSubsamplingX = ((byte2 >> 3) & 0x01) as 0 | 1; // bit [3]
  const chromaSubsamplingY = ((byte2 >> 2) & 0x01) as 0 | 1; // bit [2]
  const chromaSamplePosition = byte2 & 0x03; // bits [1:0]

  // [3] 000:3 | initial_presentation_delay_present:1 |
  //     initial_presentation_delay_minus_one_or_reserved:4
  /* v8 ignore next */
  const byte3 = payload[3] ?? 0;
  const initialPresentationDelayPresent = ((byte3 >> 4) & 0x01) as 0 | 1; // bit [4]
  const initialPresentationDelayMinusOne = byte3 & 0x0f; // bits [3:0]

  // [4..] configOBUs (zero-copy from defensive copy)
  const configObus = bytes.subarray(4);

  return {
    kind: 'av1C',
    bytes,
    seqProfile,
    seqLevelIdx0,
    seqTier0,
    highBitdepth,
    twelveBit,
    monochrome,
    chromaSubsamplingX,
    chromaSubsamplingY,
    chromaSamplePosition,
    initialPresentationDelayPresent,
    initialPresentationDelayMinusOne,
    configObus,
  };
}
