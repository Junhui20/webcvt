/**
 * AVC NAL unit conversion and codec parameter extraction.
 *
 * Handles:
 * - Annex-B framing → AVCC length-prefixed framing (for WebCodecs — Trap §9)
 * - Emulation prevention byte handling (0x00 0x00 0x03 — Trap §9)
 * - SPS (type 7) / PPS (type 8) capture
 * - AVCDecoderConfigurationRecord synthesis from SPS + PPS
 * - AVC codec string derivation from raw SPS bytes (not from AVCDecoderConfigurationRecord)
 *   profile_idc/constraint_set_flags/level_idc at fixed offsets in SPS NAL payload
 *
 * References:
 * - ISO/IEC 14496-10 Annex B (Annex-B framing)
 * - ISO/IEC 14496-15 §5.3.3 (AVCDecoderConfigurationRecord)
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NalUnit {
  /** NAL unit type (low 5 bits of first byte). */
  nalUnitType: number;
  /** Raw NAL unit data (after emulation prevention byte removal). */
  data: Uint8Array;
}

export interface AvcParamSets {
  /** Most recent SPS NAL unit payload (nal_unit_type=7). */
  sps: Uint8Array | null;
  /** Most recent PPS NAL unit payload (nal_unit_type=8). */
  pps: Uint8Array | null;
}

// ---------------------------------------------------------------------------
// NAL unit type constants
// ---------------------------------------------------------------------------

const NAL_TYPE_IDR = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;

// ---------------------------------------------------------------------------
// Annex-B → AVCC conversion (Trap §9)
// ---------------------------------------------------------------------------

/**
 * Split an Annex-B byte-stream payload into individual NAL units,
 * handling both 3-byte (0x00 0x00 0x01) and 4-byte (0x00 0x00 0x00 0x01)
 * start codes. Returns NAL unit data WITHOUT the start code prefix.
 *
 * Does NOT strip emulation prevention bytes — that is done only when
 * parsing SPS/PPS headers for codec string derivation.
 */
export function splitAnnexBNalUnits(payload: Uint8Array): Uint8Array[] {
  const startCodePositions: number[] = [];

  for (let i = 0; i < payload.length - 2; i++) {
    if (payload[i] === 0x00 && payload[i + 1] === 0x00) {
      if (payload[i + 2] === 0x01) {
        startCodePositions.push(i);
        i += 2; // skip past the start code
      } else if (payload[i + 2] === 0x00 && i + 3 < payload.length && payload[i + 3] === 0x01) {
        startCodePositions.push(i);
        i += 3; // skip past the 4-byte start code
      }
    }
  }

  if (startCodePositions.length === 0) return [];

  const nals: Uint8Array[] = [];
  for (let j = 0; j < startCodePositions.length; j++) {
    const scPos = startCodePositions[j] as number;
    const nextScPos =
      j + 1 < startCodePositions.length ? (startCodePositions[j + 1] as number) : payload.length;

    // Determine start code length: 4-byte if preceded by an extra 0x00
    let scLen = 3;
    if (scPos + 3 < payload.length && payload[scPos + 2] === 0x00 && payload[scPos + 3] === 0x01) {
      scLen = 4;
    } else if (
      scPos > 0 &&
      payload[scPos - 1] === 0x00 &&
      payload[scPos] === 0x00 &&
      payload[scPos + 1] === 0x00 &&
      payload[scPos + 2] === 0x01
    ) {
      // Already handled by the 4-byte branch detection in the loop above
      scLen = 4;
    }

    const nalStart = scPos + scLen;
    if (nalStart < nextScPos) {
      nals.push(payload.subarray(nalStart, nextScPos));
    }
  }

  return nals;
}

/**
 * Convert Annex-B framed AVC payload to AVCC length-prefixed format.
 *
 * Each NAL is preceded by a 4-byte big-endian length (per ISO/IEC 14496-15 §5).
 * Also updates paramSets when SPS/PPS NALs are encountered.
 *
 * @returns { avcc, hasIdr } — AVCC bytes and whether an IDR NAL was present.
 */
export function annexBToAvcc(
  payload: Uint8Array,
  paramSets: AvcParamSets,
): { avcc: Uint8Array; hasIdr: boolean } {
  const rawNals = splitAnnexBNalUnits(payload);
  if (rawNals.length === 0) {
    return { avcc: new Uint8Array(0), hasIdr: false };
  }

  let hasIdr = false;
  let totalSize = 0;

  for (const nal of rawNals) {
    totalSize += 4 + nal.length;

    if (nal.length === 0) continue;
    const nalType = (nal[0] as number) & 0x1f;

    if (nalType === NAL_TYPE_SPS) {
      paramSets.sps = nal;
    } else if (nalType === NAL_TYPE_PPS) {
      paramSets.pps = nal;
    } else if (nalType === NAL_TYPE_IDR) {
      hasIdr = true;
    }
  }

  const avcc = new Uint8Array(totalSize);
  let offset = 0;
  for (const nal of rawNals) {
    const len = nal.length;
    avcc[offset] = (len >>> 24) & 0xff;
    avcc[offset + 1] = (len >>> 16) & 0xff;
    avcc[offset + 2] = (len >>> 8) & 0xff;
    avcc[offset + 3] = len & 0xff;
    offset += 4;
    avcc.set(nal, offset);
    offset += len;
  }

  return { avcc, hasIdr };
}

// ---------------------------------------------------------------------------
// AVCC → Annex-B conversion (muxer write path)
// ---------------------------------------------------------------------------

/**
 * Convert AVCC length-prefixed AVC payload back to Annex-B framing.
 * Uses 4-byte start codes (0x00 0x00 0x00 0x01) per ITU-T H.264 Annex B.
 */
export function avccToAnnexB(payload: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let cursor = 0;
  const START_CODE = new Uint8Array([0x00, 0x00, 0x00, 0x01]);

  while (cursor + 4 <= payload.length) {
    const nalLen =
      (((payload[cursor] as number) << 24) |
        ((payload[cursor + 1] as number) << 16) |
        ((payload[cursor + 2] as number) << 8) |
        (payload[cursor + 3] as number)) >>>
      0;
    cursor += 4;

    if (nalLen === 0 || cursor + nalLen > payload.length) break;

    parts.push(START_CODE);
    parts.push(payload.subarray(cursor, cursor + nalLen));
    cursor += nalLen;
  }

  // Concatenate all parts
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AVCDecoderConfigurationRecord synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesise an AVCDecoderConfigurationRecord from SPS + PPS NAL units.
 *
 * Layout (ISO/IEC 14496-15 §5.3.3):
 *   byte 0: configurationVersion = 1
 *   byte 1: AVCProfileIndication = sps[1]
 *   byte 2: profile_compatibility = sps[2]
 *   byte 3: AVCLevelIndication = sps[3]
 *   byte 4: reserved(111111) | lengthSizeMinusOne(2) = 0xFF (4-byte lengths)
 *   byte 5: reserved(111) | numOfSPS(5) = 0xE1 (1 SPS)
 *   [2-byte SPS length] [SPS NAL bytes]
 *   byte N: numOfPPS = 1
 *   [2-byte PPS length] [PPS NAL bytes]
 *
 * Returns null if SPS or PPS is not available.
 */
export function synthesiseAvcDecoderConfig(paramSets: AvcParamSets): Uint8Array | null {
  const { sps, pps } = paramSets;
  if (!sps || !pps || sps.length < 4) return null;

  const totalSize = 6 + 2 + sps.length + 1 + 2 + pps.length;
  const record = new Uint8Array(totalSize);
  let off = 0;

  record[off++] = 0x01; // configurationVersion
  record[off++] = sps[1] as number; // AVCProfileIndication
  record[off++] = sps[2] as number; // profile_compatibility
  record[off++] = sps[3] as number; // AVCLevelIndication
  record[off++] = 0xff; // reserved + lengthSizeMinusOne = 3 (4-byte lengths)
  record[off++] = 0xe1; // reserved + numSPS = 1

  // SPS
  record[off++] = (sps.length >> 8) & 0xff;
  record[off++] = sps.length & 0xff;
  record.set(sps, off);
  off += sps.length;

  // PPS
  record[off++] = 0x01; // numPPS = 1
  record[off++] = (pps.length >> 8) & 0xff;
  record[off++] = pps.length & 0xff;
  record.set(pps, off);

  return record;
}

// ---------------------------------------------------------------------------
// AVC codec string derivation from raw SPS bytes (Trap §9 / design note §WebCodecs)
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs AVC codec string from raw SPS NAL unit bytes.
 *
 * SPS NAL payload byte offsets (after the NAL header byte):
 *   byte 0 (sps[0]) = NAL header (forbidden_zero_bit + nal_ref_idc + nal_unit_type)
 *   byte 1 (sps[1]) = profile_idc
 *   byte 2 (sps[2]) = constraint_set_flags (byte-aligned)
 *   byte 3 (sps[3]) = level_idc
 *
 * Returns 'avc1.<profile_hex><flags_hex><level_hex>' e.g. 'avc1.64001f'.
 * Returns null if SPS is too short (< 4 bytes).
 */
export function deriveAvcCodecString(spsNal: Uint8Array): string | null {
  if (spsNal.length < 4) return null;

  const profile = spsNal[1] as number;
  const flags = spsNal[2] as number;
  const level = spsNal[3] as number;

  const profileHex = profile.toString(16).padStart(2, '0');
  const flagsHex = flags.toString(16).padStart(2, '0');
  const levelHex = level.toString(16).padStart(2, '0');

  return `avc1.${profileHex}${flagsHex}${levelHex}`;
}

// ---------------------------------------------------------------------------
// Emulation prevention byte removal (Trap §9 — used only for SPS/PPS parsing)
// ---------------------------------------------------------------------------

/**
 * Remove emulation prevention bytes (0x00 0x00 0x03) from a NAL payload.
 *
 * The sequence 0x00 0x00 0x03 0x{00|01|02|03} in a NAL payload has the 0x03
 * byte removed. This is needed before parsing RBSP syntax elements.
 */
export function removeEmulationPreventionBytes(nal: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i + 2 < nal.length && nal[i] === 0x00 && nal[i + 1] === 0x00 && nal[i + 2] === 0x03) {
      result.push(0x00);
      result.push(0x00);
      i += 2; // skip the 0x03 emulation prevention byte
    } else {
      result.push(nal[i] as number);
    }
  }
  return new Uint8Array(result);
}
