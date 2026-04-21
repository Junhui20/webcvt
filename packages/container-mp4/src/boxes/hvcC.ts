/**
 * hvcC (HEVC Decoder Configuration Record) parser.
 *
 * Spec: ISO/IEC 14496-15 §8.3.3.1
 *
 * Wire format (avcC box payload):
 *   [0]      configurationVersion:u8 = 1
 *   [1]      general_profile_space:2 | general_tier_flag:1 | general_profile_idc:5
 *   [2..5]   general_profile_compatibility_flags:u32 (big-endian)
 *   [6..11]  general_constraint_indicator_flags:u8[6]
 *   [12]     general_level_idc:u8
 *   [13..14] 0b1111xxxxxxxxxxxx  min_spatial_segmentation_idc:12 (big-endian)
 *   [15]     0b111111xx          parallelismType:2
 *   [16]     0b111111xx          chromaFormat:2
 *   [17]     0b11111xxx          bitDepthLumaMinus8:3
 *   [18]     0b11111xxx          bitDepthChromaMinus8:3
 *   [19..20] avgFrameRate:u16
 *   [21]     constantFrameRate:2 | numTemporalLayers:3 | temporalIdNested:1 | lengthSizeMinusOne:2
 *   [22]     numOfArrays:u8
 *   then numOfArrays times:
 *     [n]    array_completeness:1 | 0:1 | NAL_unit_type:6
 *     [n+1..n+2] numNalus:u16
 *     for each NALU: [u16 nalUnitLength][NAL bytes]
 *
 * All multi-byte fields are big-endian.
 * Every shift/mask annotated with spec byte offset.
 */

import {
  MAX_HVC_ARRAYS,
  MAX_VIDEO_NAL_UNITS_PER_ARRAY,
  MAX_VIDEO_NAL_UNIT_BYTES,
} from '../constants.ts';
import {
  Mp4HvcCBadLengthSizeError,
  Mp4HvcCBadVersionError,
  Mp4HvcCMissingError,
  Mp4InvalidBoxError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4HvcArray {
  readonly arrayCompleteness: 0 | 1;
  readonly nalUnitType: number;
  readonly nalus: readonly Uint8Array[];
}

export interface Mp4HvcConfig {
  readonly kind: 'hvcC';
  /** Verbatim hvcC payload — emitted unchanged on round-trip. */
  readonly bytes: Uint8Array;
  readonly generalProfileSpace: number;
  readonly generalTierFlag: 0 | 1;
  readonly generalProfileIdc: number;
  readonly generalProfileCompatibilityFlags: number;
  /** 6 raw bytes from the bitstream. */
  readonly generalConstraintIndicatorFlags: Uint8Array;
  readonly generalLevelIdc: number;
  readonly minSpatialSegmentationIdc: number;
  readonly parallelismType: number;
  readonly chromaFormat: number;
  readonly bitDepthLumaMinus8: number;
  readonly bitDepthChromaMinus8: number;
  readonly avgFrameRate: number;
  readonly constantFrameRate: number;
  readonly numTemporalLayers: number;
  readonly temporalIdNested: 0 | 1;
  readonly nalUnitLengthSize: 1 | 2 | 4;
  readonly arrays: readonly Mp4HvcArray[];
}

// Re-export so caller can import from one place.
export { Mp4HvcCMissingError };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an hvcC box payload into Mp4HvcConfig.
 *
 * @param payload  Raw bytes of the hvcC box payload (after the 8-byte box header).
 * @throws Mp4HvcCBadVersionError    configurationVersion != 1
 * @throws Mp4HvcCBadLengthSizeError lengthSizeMinusOne == 2 (reserved)
 * @throws Mp4InvalidBoxError        payload too short or truncated NAL data
 */
export function parseHvcC(payload: Uint8Array): Mp4HvcConfig {
  // Minimum 23 bytes: fixed header (bytes 0..22) before array list.
  if (payload.length < 23) {
    throw new Mp4InvalidBoxError(
      `hvcC payload too short (${payload.length} bytes); need at least 23.`,
    );
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // Defensive copy for verbatim round-trip.
  const bytes = payload.slice();

  let cursor = 0;

  // [0] configurationVersion (ISO/IEC 14496-15 §8.3.3.1)
  /* v8 ignore next */
  const configVersion = payload[cursor++] ?? 0; // byte 0
  if (configVersion !== 1) {
    throw new Mp4HvcCBadVersionError(configVersion);
  }

  // [1] general_profile_space:2 | general_tier_flag:1 | general_profile_idc:5
  /* v8 ignore next */
  const byte1 = payload[cursor++] ?? 0; // byte 1
  const generalProfileSpace = (byte1 >> 6) & 0x03; // bits [7:6]
  const generalTierFlag = ((byte1 >> 5) & 0x01) as 0 | 1; // bit [5]
  const generalProfileIdc = byte1 & 0x1f; // bits [4:0]

  // [2..5] general_profile_compatibility_flags:u32 (big-endian)
  const generalProfileCompatibilityFlags = view.getUint32(cursor, false); // bytes 2..5
  cursor += 4;

  // [6..11] general_constraint_indicator_flags:u8[6]
  const generalConstraintIndicatorFlags = bytes.subarray(cursor, cursor + 6); // bytes 6..11
  cursor += 6;

  // [12] general_level_idc:u8
  /* v8 ignore next */
  const generalLevelIdc = payload[cursor++] ?? 0; // byte 12

  // [13..14] 0b1111xxxxxxxxxxxx — min_spatial_segmentation_idc:12 (big-endian)
  /* v8 ignore next */
  const mssiByte0 = payload[cursor++] ?? 0; // byte 13
  /* v8 ignore next */
  const mssiByte1 = payload[cursor++] ?? 0; // byte 14
  const minSpatialSegmentationIdc = ((mssiByte0 & 0x0f) << 8) | mssiByte1; // bits [11:0]

  // [15] 0b111111xx — parallelismType:2 in bits [1:0]
  /* v8 ignore next */
  const parallelismType = (payload[cursor++] ?? 0) & 0x03; // byte 15

  // [16] 0b111111xx — chromaFormat:2 in bits [1:0]
  /* v8 ignore next */
  const chromaFormat = (payload[cursor++] ?? 0) & 0x03; // byte 16

  // [17] 0b11111xxx — bitDepthLumaMinus8:3 in bits [2:0]
  /* v8 ignore next */
  const bitDepthLumaMinus8 = (payload[cursor++] ?? 0) & 0x07; // byte 17

  // [18] 0b11111xxx — bitDepthChromaMinus8:3 in bits [2:0]
  /* v8 ignore next */
  const bitDepthChromaMinus8 = (payload[cursor++] ?? 0) & 0x07; // byte 18

  // [19..20] avgFrameRate:u16 (big-endian)
  const avgFrameRate = view.getUint16(cursor, false); // bytes 19..20
  cursor += 2;

  // [21] constantFrameRate:2 | numTemporalLayers:3 | temporalIdNested:1 | lengthSizeMinusOne:2
  /* v8 ignore next */
  const byte21 = payload[cursor++] ?? 0; // byte 21
  const constantFrameRate = (byte21 >> 6) & 0x03; // bits [7:6]
  const numTemporalLayers = (byte21 >> 3) & 0x07; // bits [5:3]
  const temporalIdNested = ((byte21 >> 2) & 0x01) as 0 | 1; // bit [2]
  const lengthSizeMinusOne = byte21 & 0x03; // bits [1:0]
  if (lengthSizeMinusOne === 2) {
    throw new Mp4HvcCBadLengthSizeError(lengthSizeMinusOne);
  }
  const nalUnitLengthSize = (lengthSizeMinusOne + 1) as 1 | 2 | 4;

  // [22] numOfArrays:u8
  /* v8 ignore next */
  const numOfArrays = Math.min(payload[cursor++] ?? 0, MAX_HVC_ARRAYS); // byte 22

  const arrays: Mp4HvcArray[] = [];
  for (let a = 0; a < numOfArrays; a++) {
    // array_completeness:1 | 0:1 | NAL_unit_type:6
    if (cursor >= payload.length) {
      throw new Mp4InvalidBoxError('hvcC array header truncated.');
    }
    /* v8 ignore next */
    const typeByte = payload[cursor++] ?? 0;
    const arrayCompleteness = ((typeByte >> 7) & 0x01) as 0 | 1; // bit [7]
    const nalUnitType = typeByte & 0x3f; // bits [5:0]

    // numNalus:u16 (big-endian)
    if (cursor + 2 > payload.length) {
      throw new Mp4InvalidBoxError('hvcC numNalus field truncated.');
    }
    const numNalus = Math.min(view.getUint16(cursor, false), MAX_VIDEO_NAL_UNITS_PER_ARRAY);
    cursor += 2;

    const nalus: Uint8Array[] = [];
    for (let n = 0; n < numNalus; n++) {
      if (cursor + 2 > payload.length) {
        throw new Mp4InvalidBoxError('hvcC NAL unit length field truncated.');
      }
      // nalUnitLength:u16 (big-endian)
      const nalLen = view.getUint16(cursor, false);
      cursor += 2;
      if (cursor + nalLen > payload.length) {
        throw new Mp4InvalidBoxError(
          `hvcC NAL unit (len=${nalLen}) overruns payload at cursor ${cursor}.`,
        );
      }
      if (nalLen > MAX_VIDEO_NAL_UNIT_BYTES) {
        throw new Mp4InvalidBoxError(
          `hvcC NAL unit length ${nalLen} exceeds cap ${MAX_VIDEO_NAL_UNIT_BYTES}.`,
        );
      }
      nalus.push(bytes.subarray(cursor, cursor + nalLen));
      cursor += nalLen;
    }
    arrays.push({ arrayCompleteness, nalUnitType, nalus });
  }

  return {
    kind: 'hvcC',
    bytes,
    generalProfileSpace,
    generalTierFlag,
    generalProfileIdc,
    generalProfileCompatibilityFlags,
    generalConstraintIndicatorFlags,
    generalLevelIdc,
    minSpatialSegmentationIdc,
    parallelismType,
    chromaFormat,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
    avgFrameRate,
    constantFrameRate,
    numTemporalLayers,
    temporalIdNested,
    nalUnitLengthSize,
    arrays,
  };
}
