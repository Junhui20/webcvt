/**
 * HEVCDecoderConfigurationRecord parser (ISO 14496-15 §8.3.3).
 *
 * Derives the WebCodecs codec string 'hev1.<profile_space>.<profile_compat>.L<tier_level>.B<constraint>'
 * from CodecPrivate bytes. Trap §21.
 *
 * Security: caps numOfArrays at MAX_HEVC_PARAM_SET_ARRAYS (8) and
 * numNalus per array at MAX_HEVC_NALUS_PER_ARRAY (64).
 */

import { MAX_HEVC_NALUS_PER_ARRAY, MAX_HEVC_PARAM_SET_ARRAYS } from '../constants.ts';
import { MkvInvalidCodecPrivateError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an HEVCDecoderConfigurationRecord and derive the WebCodecs codec string.
 *
 * Byte layout (ISO 14496-15 §8.3.3), relevant fields:
 *   byte 0:  configurationVersion (must be 1)
 *   byte 1:  general_profile_space(2) | general_tier_flag(1) | general_profile_idc(5)
 *   byte 2-5: general_profile_compatibility_flags (32 bits)
 *   byte 6-11: general_constraint_indicator_flags (48 bits)
 *   byte 12: general_level_idc
 *   byte 13-14: min_spatial_segmentation_idc (incl. reserved bits)
 *   byte 15: parallelismType (incl. reserved)
 *   byte 16: chroma_format_idc (incl. reserved)
 *   byte 17: bit_depth_luma_minus8 (incl. reserved)
 *   byte 18: bit_depth_chroma_minus8 (incl. reserved)
 *   byte 19-20: avgFrameRate
 *   byte 21: constantFrameRate(2) | numTemporalLayers(3) | temporalIdNested(1) | lengthSizeMinusOne(2)
 *   byte 22: numOfArrays
 *   [arrays: (array_completeness|reserved|NAL_unit_type)(1 byte), numNalus(2 bytes), [nalLen(2)+nal_bytes]+]
 *
 * @throws MkvInvalidCodecPrivateError if the record is malformed.
 */
export function parseHevcDecoderConfig(codecPrivate: Uint8Array): string {
  if (codecPrivate.length < 23) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEGH/ISO/HEVC',
      `HEVCDecoderConfigurationRecord too short: ${codecPrivate.length} bytes (min 23)`,
    );
  }

  const configVersion = codecPrivate[0] as number;
  if (configVersion !== 1) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEGH/ISO/HEVC',
      `configurationVersion is ${configVersion}; only 1 is supported`,
    );
  }

  // byte 1: general_profile_space(2) | general_tier_flag(1) | general_profile_idc(5)
  const byte1 = codecPrivate[1] as number;
  const profileSpace = (byte1 >> 6) & 0x03;
  const tierFlag = (byte1 >> 5) & 0x01;
  const profileIdc = byte1 & 0x1f;

  // bytes 2-5: general_profile_compatibility_flags (big-endian 32-bit)
  const compatFlags =
    ((codecPrivate[2] as number) << 24) |
    ((codecPrivate[3] as number) << 16) |
    ((codecPrivate[4] as number) << 8) |
    (codecPrivate[5] as number);

  // bytes 6-11: general_constraint_indicator_flags (48 bits; take first byte for B<constraint>)
  const constraintByte = codecPrivate[6] as number;

  // byte 12: general_level_idc
  const levelIdc = codecPrivate[12] as number;

  // WebCodecs codec string format (per ISO 14496-15 §D.7 and W3C WebCodecs registry):
  //   hev1.{profileSpace}{profileIdc}.{compatHex}.{levelPrefix}{levelIdc}.B{constraintHex}
  // profileSpace: '' for 0, 'A' for 1, 'B' for 2, 'C' for 3
  const profileSpaceStr = profileSpace === 0 ? '' : String.fromCharCode(0x40 + profileSpace);

  // Q-H-2(b): compat flags are 32-bit; pad to 8 hex digits (conservative, spec-correct).
  // Example: 0x00000060 → "00000060", not "60".
  const compatHex = (compatFlags >>> 0).toString(16).padStart(8, '0');

  // Q-H-2(a): tier prefix is MUTUALLY EXCLUSIVE — either 'L' (main tier, tier_flag=0)
  // or 'H' (high tier, tier_flag=1). The old code emitted '.L' + 'H' + level which
  // produced '.LH120' instead of the correct '.H120' for high tier.
  const levelPrefix = tierFlag === 0 ? 'L' : 'H';
  const levelStr = `${levelPrefix}${levelIdc}`;

  // constraint: B<first_byte_of_constraint_flags_in_hex>
  const constraintHex = constraintByte.toString(16);

  // Validate arrays (Trap §21 security caps).
  validateHevcArrays(codecPrivate);

  // Build: hev1.<profileSpace><profileIdc>.<compatHex>.<levelStr>.B<constraintHex>
  return `hev1.${profileSpaceStr}${profileIdc}.${compatHex}.${levelStr}.B${constraintHex}`;
}

// ---------------------------------------------------------------------------
// Internal validation
// ---------------------------------------------------------------------------

function validateHevcArrays(codecPrivate: Uint8Array): void {
  const numOfArrays = codecPrivate[22] as number;
  if (numOfArrays > MAX_HEVC_PARAM_SET_ARRAYS) {
    throw new MkvInvalidCodecPrivateError(
      'V_MPEGH/ISO/HEVC',
      `numOfArrays ${numOfArrays} exceeds cap ${MAX_HEVC_PARAM_SET_ARRAYS}`,
    );
  }

  let cursor = 23;
  for (let a = 0; a < numOfArrays; a++) {
    if (cursor + 3 > codecPrivate.length) {
      throw new MkvInvalidCodecPrivateError('V_MPEGH/ISO/HEVC', `Array ${a} header truncated`);
    }
    // Skip: array_completeness | reserved | NAL_unit_type (1 byte)
    cursor++;
    const numNalus = ((codecPrivate[cursor] as number) << 8) | (codecPrivate[cursor + 1] as number);
    cursor += 2;

    if (numNalus > MAX_HEVC_NALUS_PER_ARRAY) {
      throw new MkvInvalidCodecPrivateError(
        'V_MPEGH/ISO/HEVC',
        `Array ${a} numNalus ${numNalus} exceeds cap ${MAX_HEVC_NALUS_PER_ARRAY}`,
      );
    }

    for (let n = 0; n < numNalus; n++) {
      if (cursor + 2 > codecPrivate.length) {
        throw new MkvInvalidCodecPrivateError(
          'V_MPEGH/ISO/HEVC',
          `NAL unit ${n} in array ${a} missing length field`,
        );
      }
      const nalLen = ((codecPrivate[cursor] as number) << 8) | (codecPrivate[cursor + 1] as number);
      cursor += 2 + nalLen;
      if (cursor > codecPrivate.length) {
        throw new MkvInvalidCodecPrivateError(
          'V_MPEGH/ISO/HEVC',
          `NAL unit ${n} in array ${a} extends beyond CodecPrivate`,
        );
      }
    }
  }
}
