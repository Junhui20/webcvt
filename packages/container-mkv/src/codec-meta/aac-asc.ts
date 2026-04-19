/**
 * AudioSpecificConfig (ASC) parser — inline re-implementation for container-mkv.
 *
 * Per design note: DO NOT import from @webcvt/container-aac. This is an inline
 * ~30-50 LOC parser that extracts only the audio_object_type from the first 5 bits
 * of CodecPrivate, which is all we need to derive the WebCodecs codec string
 * 'mp4a.40.<aot>' for A_AAC tracks.
 *
 * Bit layout (ISO/IEC 14496-3 §1.6.2.1):
 *   bits 4:0 (first 5 bits) — audio_object_type (AOT)
 *     If AOT == 31: extended_object_type follows (AOT = 32 + next 6 bits)
 *   bits 3:0 next 4 bits    — sampling_frequency_index
 *     If sfi == 0xf: 24-bit sampling_frequency follows
 *   bits 3:0 next 4 bits    — channel_configuration
 *
 * Common AOTs:
 *   2 = AAC-LC, 5 = HE-AAC (SBR), 29 = HE-AACv2 (SBR+PS)
 */

import { MkvInvalidCodecPrivateError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an AudioSpecificConfig and return the WebCodecs codec string.
 *
 * @param codecPrivate  The raw CodecPrivate bytes for an A_AAC track.
 * @returns 'mp4a.40.<aot>' where aot is the audio object type.
 * @throws MkvInvalidCodecPrivateError if the ASC is malformed or too short.
 */
export function parseAacAsc(codecPrivate: Uint8Array): string {
  if (codecPrivate.length < 2) {
    throw new MkvInvalidCodecPrivateError(
      'A_AAC',
      `AudioSpecificConfig too short: ${codecPrivate.length} bytes (min 2)`,
    );
  }

  // Read first byte to extract AOT (bits 7:3 of byte 0 = bits [4:0] of the 5-bit AOT field).
  const byte0 = codecPrivate[0] as number;
  const byte1 = codecPrivate[1] as number;

  // audio_object_type: top 5 bits of the bit stream.
  let aot = (byte0 >> 3) & 0x1f;

  // Extended AOT: if aot == 31, read 6 more bits.
  if (aot === 31) {
    // bits 2:0 of byte0 + bits 7:5 of byte1 give 6-bit extension
    const ext6 = ((byte0 & 0x07) << 3) | ((byte1 >> 5) & 0x07);
    aot = 32 + ext6;
  }

  if (aot === 0) {
    throw new MkvInvalidCodecPrivateError(
      'A_AAC',
      'AudioSpecificConfig has audio_object_type 0 (invalid)',
    );
  }

  return `mp4a.40.${aot}`;
}
