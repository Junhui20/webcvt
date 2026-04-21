/**
 * avcC (AVC Decoder Configuration Record) parser.
 *
 * Spec: ISO/IEC 14496-15 §5.2.4.1
 *
 * Wire format (inside avcC box payload):
 *   [0]    configurationVersion:u8  = 1
 *   [1]    AVCProfileIndication:u8
 *   [2]    profile_compatibility:u8
 *   [3]    AVCLevelIndication:u8
 *   [4]    0b111111xx               lengthSizeMinusOne in low 2 bits
 *   [5]    0b111xxxxx               numOfSequenceParameterSets in low 5 bits
 *   then:  for each SPS → u16 length + SPS bytes
 *   [n]    numOfPictureParameterSets:u8
 *   then:  for each PPS → u16 length + PPS bytes
 *   // Optional High-profile trailing extension (when cursor < payload.length):
 *   [m]    0b111111xx               chroma_format in low 2 bits
 *   [m+1]  0b11111xxx               bit_depth_luma_minus8 in low 3 bits
 *   [m+2]  0b11111xxx               bit_depth_chroma_minus8 in low 3 bits
 *   [m+3]  numOfSequenceParameterSetExt:u8
 *   then:  for each SPS-Ext → u16 length + SPS-Ext bytes
 *
 * All multi-byte fields are big-endian.
 */

import { MAX_VIDEO_NAL_UNITS_PER_ARRAY, MAX_VIDEO_NAL_UNIT_BYTES } from '../constants.ts';
import {
  Mp4AvcCBadLengthSizeError,
  Mp4AvcCBadVersionError,
  Mp4AvcCMissingError,
  Mp4AvcCNalLengthError,
  Mp4InvalidBoxError,
} from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4AvcConfig {
  readonly kind: 'avcC';
  /** Verbatim avcC payload — emitted unchanged on round-trip. */
  readonly bytes: Uint8Array;
  readonly profile: number;
  readonly profileCompatibility: number;
  readonly level: number;
  readonly nalUnitLengthSize: 1 | 2 | 4;
  readonly sps: readonly Uint8Array[];
  readonly pps: readonly Uint8Array[];
  /** null when trailing High-profile extension is absent. */
  readonly spsExt: readonly Uint8Array[] | null;
  /** null when trailing High-profile extension is absent. */
  readonly chromaFormat: number | null;
  /** null when trailing High-profile extension is absent. */
  readonly bitDepthLumaMinus8: number | null;
  /** null when trailing High-profile extension is absent. */
  readonly bitDepthChromaMinus8: number | null;
}

// Re-export error so callers can import from one place.
export { Mp4AvcCMissingError };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an avcC box payload into Mp4AvcConfig.
 *
 * @param payload  Raw bytes of the avcC box payload (after the 8-byte box header).
 * @throws Mp4AvcCBadVersionError       configurationVersion != 1
 * @throws Mp4AvcCBadLengthSizeError    lengthSizeMinusOne == 2 (reserved)
 * @throws Mp4AvcCNalLengthError        a NAL unit length overruns the payload
 * @throws Mp4InvalidBoxError           payload too short
 */
export function parseAvcC(payload: Uint8Array): Mp4AvcConfig {
  // Minimum: version(1) + profile(1) + compat(1) + level(1) + lenSize(1) + numSPS(1) = 6
  // Plus at least numPPS(1) = 7.
  if (payload.length < 7) {
    throw new Mp4InvalidBoxError(
      `avcC payload too short (${payload.length} bytes); need at least 7.`,
    );
  }

  // Defensive copy for verbatim round-trip.
  const bytes = payload.slice();

  let cursor = 0;

  // [0] configurationVersion (ISO/IEC 14496-15 §5.2.4.1.1)
  /* v8 ignore next */
  const configVersion = payload[cursor++] ?? 0;
  if (configVersion !== 1) {
    throw new Mp4AvcCBadVersionError(configVersion);
  }

  // [1] AVCProfileIndication
  /* v8 ignore next */
  const profile = payload[cursor++] ?? 0;
  // [2] profile_compatibility
  /* v8 ignore next */
  const profileCompatibility = payload[cursor++] ?? 0;
  // [3] AVCLevelIndication
  /* v8 ignore next */
  const level = payload[cursor++] ?? 0;

  // [4] 0b111111xx — lengthSizeMinusOne in bits [1:0]
  /* v8 ignore next */
  const lenSizeByte = payload[cursor++] ?? 0;
  const lengthSizeMinusOne = lenSizeByte & 0x03;
  if (lengthSizeMinusOne === 2) {
    throw new Mp4AvcCBadLengthSizeError(lengthSizeMinusOne);
  }
  const nalUnitLengthSize = (lengthSizeMinusOne + 1) as 1 | 2 | 4;

  // [5] 0b111xxxxx — numOfSequenceParameterSets in bits [4:0]
  /* v8 ignore next */
  const numSpsByte = payload[cursor++] ?? 0;
  const numSps = Math.min(numSpsByte & 0x1f, MAX_VIDEO_NAL_UNITS_PER_ARRAY);

  const sps: Uint8Array[] = [];
  for (let i = 0; i < numSps; i++) {
    if (cursor + 2 > bytes.length) {
      throw new Mp4AvcCNalLengthError(cursor, 2, bytes.length);
    }
    // u16 length (big-endian) at cursor
    /* v8 ignore next */
    const spsLen = ((payload[cursor] ?? 0) << 8) | (payload[cursor + 1] ?? 0);
    cursor += 2;
    if (cursor + spsLen > bytes.length) {
      throw new Mp4AvcCNalLengthError(cursor, spsLen, bytes.length);
    }
    if (spsLen > MAX_VIDEO_NAL_UNIT_BYTES) {
      throw new Mp4AvcCNalLengthError(cursor, spsLen, MAX_VIDEO_NAL_UNIT_BYTES);
    }
    // Zero-copy subarray into the defensive copy.
    sps.push(bytes.subarray(cursor, cursor + spsLen));
    cursor += spsLen;
  }

  // numOfPictureParameterSets:u8
  if (cursor >= payload.length) {
    throw new Mp4InvalidBoxError('avcC payload truncated before numPPS field.');
  }
  /* v8 ignore next */
  const numPps = Math.min(payload[cursor++] ?? 0, MAX_VIDEO_NAL_UNITS_PER_ARRAY);

  const pps: Uint8Array[] = [];
  for (let i = 0; i < numPps; i++) {
    if (cursor + 2 > bytes.length) {
      throw new Mp4AvcCNalLengthError(cursor, 2, bytes.length);
    }
    /* v8 ignore next */
    const ppsLen = ((payload[cursor] ?? 0) << 8) | (payload[cursor + 1] ?? 0);
    cursor += 2;
    if (cursor + ppsLen > bytes.length) {
      throw new Mp4AvcCNalLengthError(cursor, ppsLen, bytes.length);
    }
    if (ppsLen > MAX_VIDEO_NAL_UNIT_BYTES) {
      throw new Mp4AvcCNalLengthError(cursor, ppsLen, MAX_VIDEO_NAL_UNIT_BYTES);
    }
    pps.push(bytes.subarray(cursor, cursor + ppsLen));
    cursor += ppsLen;
  }

  // Optional High-profile trailing extension: present iff cursor < payload.length
  // (ISO/IEC 14496-15 §5.2.4.1.1 — High-profile extension clause)
  let spsExt: readonly Uint8Array[] | null = null;
  let chromaFormat: number | null = null;
  let bitDepthLumaMinus8: number | null = null;
  let bitDepthChromaMinus8: number | null = null;

  if (cursor < payload.length) {
    // [m]   0b111111xx — chroma_format in bits [1:0]
    /* v8 ignore next */
    const chromaByte = payload[cursor++] ?? 0;
    chromaFormat = chromaByte & 0x03;

    // [m+1] 0b11111xxx — bit_depth_luma_minus8 in bits [2:0]
    if (cursor >= payload.length) {
      throw new Mp4InvalidBoxError('avcC trailing extension truncated at bit_depth_luma.');
    }
    /* v8 ignore next */
    const lumaByte = payload[cursor++] ?? 0;
    bitDepthLumaMinus8 = lumaByte & 0x07;

    // [m+2] 0b11111xxx — bit_depth_chroma_minus8 in bits [2:0]
    if (cursor >= payload.length) {
      throw new Mp4InvalidBoxError('avcC trailing extension truncated at bit_depth_chroma.');
    }
    /* v8 ignore next */
    const chromaDByte = payload[cursor++] ?? 0;
    bitDepthChromaMinus8 = chromaDByte & 0x07;

    // [m+3] numOfSequenceParameterSetExt:u8
    if (cursor >= payload.length) {
      throw new Mp4InvalidBoxError('avcC trailing extension truncated at numSPSExt.');
    }
    /* v8 ignore next */
    const numSpsExt = Math.min(payload[cursor++] ?? 0, MAX_VIDEO_NAL_UNITS_PER_ARRAY);
    const ext: Uint8Array[] = [];
    for (let i = 0; i < numSpsExt; i++) {
      if (cursor + 2 > bytes.length) {
        throw new Mp4AvcCNalLengthError(cursor, 2, bytes.length);
      }
      /* v8 ignore next */
      const extLen = ((payload[cursor] ?? 0) << 8) | (payload[cursor + 1] ?? 0);
      cursor += 2;
      if (cursor + extLen > bytes.length) {
        throw new Mp4AvcCNalLengthError(cursor, extLen, bytes.length);
      }
      if (extLen > MAX_VIDEO_NAL_UNIT_BYTES) {
        throw new Mp4AvcCNalLengthError(cursor, extLen, MAX_VIDEO_NAL_UNIT_BYTES);
      }
      ext.push(bytes.subarray(cursor, cursor + extLen));
      cursor += extLen;
    }
    spsExt = ext;
  }

  return {
    kind: 'avcC',
    bytes,
    profile,
    profileCompatibility,
    level,
    nalUnitLengthSize,
    sps,
    pps,
    spsExt,
    chromaFormat,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
  };
}
