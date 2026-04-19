/**
 * AVCDecoderConfigurationRecord parser (ISO 14496-15 §5.3.3).
 *
 * Derives the WebCodecs codec string 'avc1.<6 hex digits>' from
 * CodecPrivate bytes (AVCProfileIndication, profile_compatibility,
 * AVCLevelIndication at bytes 1..3). Trap §20.
 *
 * Security: caps SPS and PPS array counts at MAX_AVC_PARAM_SETS_PER_TYPE (32).
 */

import { MAX_AVC_PARAM_SETS_PER_TYPE } from '../constants.ts';
import { MkvInvalidCodecPrivateError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an AVCDecoderConfigurationRecord and derive the WebCodecs codec string.
 *
 * Byte layout (ISO 14496-15 §5.3.3):
 *   byte 0: configurationVersion (must be 1)
 *   byte 1: AVCProfileIndication
 *   byte 2: profile_compatibility
 *   byte 3: AVCLevelIndication
 *   byte 4: reserved(111111) | lengthSizeMinusOne(2 bits)
 *   byte 5: reserved(111) | numOfSPS(5 bits)
 *   [SPS NAL units: each prefixed by 2-byte length]
 *   numOfPPS (1 byte)
 *   [PPS NAL units: each prefixed by 2-byte length]
 *
 * @throws MkvInvalidCodecPrivateError if the record is malformed.
 */
export function parseAvcDecoderConfig(codecPrivate: Uint8Array): string {
  if (codecPrivate.length < 6) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEG4/ISO/AVC',
      `AVCDecoderConfigurationRecord too short: ${codecPrivate.length} bytes (min 6)`,
    );
  }

  const configVersion = codecPrivate[0] as number;
  if (configVersion !== 1) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEG4/ISO/AVC',
      `configurationVersion is ${configVersion}; only 1 is supported`,
    );
  }

  const profile = codecPrivate[1] as number;
  const compat = codecPrivate[2] as number;
  const level = codecPrivate[3] as number;

  // Validate the record by scanning SPS/PPS arrays (security cap enforcement).
  validateAvcRecord(codecPrivate);

  // Codec string: avc1.<profile_hex><compat_hex><level_hex>
  const profileHex = profile.toString(16).padStart(2, '0');
  const compatHex = compat.toString(16).padStart(2, '0');
  const levelHex = level.toString(16).padStart(2, '0');

  return `avc1.${profileHex}${compatHex}${levelHex}`;
}

// ---------------------------------------------------------------------------
// Internal validation
// ---------------------------------------------------------------------------

function validateAvcRecord(codecPrivate: Uint8Array): void {
  // byte 5: reserved(111) | numOfSPS(5 bits)
  const numOfSPS = (codecPrivate[5] as number) & 0x1f;
  if (numOfSPS > MAX_AVC_PARAM_SETS_PER_TYPE) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEG4/ISO/AVC',
      `numOfSPS ${numOfSPS} exceeds cap ${MAX_AVC_PARAM_SETS_PER_TYPE}`,
    );
  }

  let cursor = 6;
  for (let i = 0; i < numOfSPS; i++) {
    if (cursor + 2 > codecPrivate.length) {
      throw new MkvInvalidCodecPrivateError(
        'V_MPEG4/ISO/AVC',
        'SPS array truncated: missing length field',
      );
    }
    const spsLen = ((codecPrivate[cursor] as number) << 8) | (codecPrivate[cursor + 1] as number);
    cursor += 2 + spsLen;
    if (cursor > codecPrivate.length) {
      throw new MkvInvalidCodecPrivateError(
        'V_MPEG4/ISO/AVC',
        `SPS NAL unit ${i} extends beyond CodecPrivate`,
      );
    }
  }

  if (cursor >= codecPrivate.length) {
    // No PPS byte — treat as 0 PPS (valid for some encoders).
    return;
  }

  const numOfPPS = codecPrivate[cursor] as number;
  if (numOfPPS > MAX_AVC_PARAM_SETS_PER_TYPE) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEG4/ISO/AVC',
      `numOfPPS ${numOfPPS} exceeds cap ${MAX_AVC_PARAM_SETS_PER_TYPE}`,
    );
  }
  cursor++;

  for (let i = 0; i < numOfPPS; i++) {
    if (cursor + 2 > codecPrivate.length) {
      throw new MkvInvalidCodecPrivateError(
        'V_MPEG4/ISO/AVC',
        'PPS array truncated: missing length field',
      );
    }
    const ppsLen = ((codecPrivate[cursor] as number) << 8) | (codecPrivate[cursor + 1] as number);
    cursor += 2 + ppsLen;
    if (cursor > codecPrivate.length) {
      throw new MkvInvalidCodecPrivateError(
        'V_MPEG4/ISO/AVC',
        `PPS NAL unit ${i} extends beyond CodecPrivate`,
      );
    }
  }
}
