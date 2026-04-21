/**
 * WebCodecs codec string derivation for video tracks.
 *
 * Reference: W3C WebCodecs Codec Registry (AVC/HEVC/VP9/AV1 sections).
 * Clean-room: no mp4box.js / FFmpeg / Bento4 consulted.
 *
 * §8.1 AVC  — "avc1.PPCCLL"  always avc1. prefix (even for avc3 source)
 * §8.2 HEVC — "hvc1.A.B.C.DD…" or "hev1.A.B.C.DD…" (depends on 4cc)
 * §8.3 VP9  — "vp09.PP.LL.BD.CS.CP.TC.MC.RF" (long form, always)
 * §8.4 AV1  — "av01.P.LLT.BD" (short form)
 */

import type { Mp4Av1Config } from './av1C.ts';
import type { Mp4AvcConfig } from './avcC.ts';
import type { Mp4HvcConfig } from './hvcC.ts';
import type { Mp4VideoCodecConfig, Mp4VideoFormat } from './visual-sample-entry.ts';
import type { Mp4VpcConfig } from './vpcC.ts';

// ---------------------------------------------------------------------------
// AVC codec string — §8.1
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs AVC codec string.
 *
 * Per the W3C WebCodecs Codec Registry, the codec string for both avc1 and
 * avc3 source 4ccs always uses the "avc1." prefix.
 *
 * Format: "avc1.PPCCLL"
 *   PP = AVCProfileIndication (hex, 2 digits, lowercase, zero-padded)
 *   CC = profile_compatibility (hex, 2 digits, lowercase, zero-padded)
 *   LL = AVCLevelIndication   (hex, 2 digits, lowercase, zero-padded)
 */
function deriveAvcCodecString(cfg: Mp4AvcConfig): string {
  const pp = cfg.profile.toString(16).padStart(2, '0').toLowerCase();
  const cc = cfg.profileCompatibility.toString(16).padStart(2, '0').toLowerCase();
  const ll = cfg.level.toString(16).padStart(2, '0').toLowerCase();
  return `avc1.${pp}${cc}${ll}`;
}

// ---------------------------------------------------------------------------
// HEVC codec string — §8.2
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs HEVC codec string.
 *
 * Per the W3C WebCodecs Codec Registry / ISO/IEC 14496-15 Annex E:
 *   prefix = 'hvc1' or 'hev1' (from source 4cc)
 *   A = profile_space prefix: '' | 'A' | 'B' | 'C'
 *   B = general_profile_idc (decimal)
 *   C = REVERSED general_profile_compatibility_flags as 8-digit hex (leading
 *       zeros stripped, no trailing zeros — but the standard uses the reversed
 *       32-bit integer as hex); output is hex, lowercase, no leading 0x.
 *       Trailing zero nibbles are stripped per the registry spec.
 *   DD… = tier ('L' for main, 'H' for high) + general_level_idc (decimal)
 *          followed by constraint indicator bytes with trailing zero-bytes stripped.
 *
 * Example: hvc1.1.6.L93.B0
 */
function deriveHvcCodecString(format: Mp4VideoFormat, cfg: Mp4HvcConfig): string {
  // Profile space: 0='' 1='A' 2='B' 3='C'
  const spaceChar = ['', 'A', 'B', 'C'][cfg.generalProfileSpace] ?? '';

  // Reversed compatibility flags: bit-reverse the 32-bit integer, output as hex.
  // The WebCodecs registry specifies the 32 bits are reversed and output as hex
  // without leading zeros (no zero-padding), no trailing zero stripping needed.
  const reversed = reverseBits32(cfg.generalProfileCompatibilityFlags);
  const compatStripped = reversed.toString(16).toLowerCase() || '0';

  // Tier: L = main (tier flag=0), H = high (tier flag=1)
  const tier = cfg.generalTierFlag === 1 ? 'H' : 'L';
  const levelStr = `${tier}${cfg.generalLevelIdc}`;

  // Constraint indicator bytes: 6 bytes, trailing zero-bytes stripped.
  const constraintBytes: string[] = [];
  let lastNonZero = -1;
  for (let i = 0; i < 6; i++) {
    if ((cfg.generalConstraintIndicatorFlags[i] ?? 0) !== 0) {
      lastNonZero = i;
    }
  }
  for (let i = 0; i <= lastNonZero; i++) {
    constraintBytes.push(
      (cfg.generalConstraintIndicatorFlags[i] ?? 0).toString(16).padStart(2, '0').toLowerCase(),
    );
  }

  // Format: prefix.A.B.C.DD[.constraint...]
  const prefix = format; // 'hvc1' or 'hev1'
  const parts = [`${prefix}.${spaceChar}${cfg.generalProfileIdc}`, compatStripped, levelStr];
  for (const cb of constraintBytes) {
    parts.push(cb);
  }
  return parts.join('.');
}

/**
 * Reverse all 32 bits of an unsigned 32-bit integer.
 */
function reverseBits32(input: number): number {
  let n = input;
  let result = 0;
  for (let i = 0; i < 32; i++) {
    result = ((result << 1) | (n & 1)) >>> 0;
    n = (n >>> 1) >>> 0;
  }
  return result >>> 0;
}

// ---------------------------------------------------------------------------
// VP9 codec string — §8.3
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs VP9 codec string (always long form).
 *
 * Format: "vp09.PP.LL.BD.CS.CP.TC.MC.RF"
 *   PP = profile (2-digit decimal, zero-padded)
 *   LL = level (2-digit decimal, zero-padded)
 *   BD = bit depth (2-digit decimal, zero-padded)
 *   CS = chroma subsampling (2-digit decimal, zero-padded)
 *   CP = colour primaries (2-digit decimal, zero-padded)
 *   TC = transfer characteristics (2-digit decimal, zero-padded)
 *   MC = matrix coefficients (2-digit decimal, zero-padded)
 *   RF = video full range flag (2-digit decimal: 00 or 01)
 */
function deriveVpcCodecString(cfg: Mp4VpcConfig): string {
  const pp = cfg.profile.toString().padStart(2, '0');
  const ll = cfg.level.toString().padStart(2, '0');
  const bd = cfg.bitDepth.toString().padStart(2, '0');
  const cs = cfg.chromaSubsampling.toString().padStart(2, '0');
  const cp = cfg.colourPrimaries.toString().padStart(2, '0');
  const tc = cfg.transferCharacteristics.toString().padStart(2, '0');
  const mc = cfg.matrixCoefficients.toString().padStart(2, '0');
  const rf = cfg.videoFullRangeFlag.toString().padStart(2, '0');
  return `vp09.${pp}.${ll}.${bd}.${cs}.${cp}.${tc}.${mc}.${rf}`;
}

// ---------------------------------------------------------------------------
// AV1 codec string — §8.4
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs AV1 codec string (short form).
 *
 * Format: "av01.P.LLT.BD"
 *   P  = seq_profile (single decimal digit)
 *   LL = seq_level_idx_0 (2-digit decimal, zero-padded)
 *   T  = seq_tier_0 → 'M' (main=0) or 'H' (high=1)
 *   BD = bit depth (08 / 10 / 12)
 */
function deriveAv1CodecString(cfg: Mp4Av1Config): string {
  const p = cfg.seqProfile.toString();
  const ll = cfg.seqLevelIdx0.toString().padStart(2, '0');
  const t = cfg.seqTier0 === 1 ? 'H' : 'M';

  // Bit depth derived from highBitdepth + twelveBit flags (AV1 spec §5.5.2).
  let bd: string;
  if (cfg.twelveBit === 1) {
    bd = '12';
  } else if (cfg.highBitdepth === 1) {
    bd = '10';
  } else {
    bd = '08';
  }

  return `av01.${p}.${ll}${t}.${bd}`;
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * Derive the WebCodecs codec string for any of the four supported
 * video codec config kinds.
 *
 * @param format Source 4cc (used for hev1 vs hvc1 prefix selection).
 * @param config Parsed codec configuration.
 */
export function deriveVideoCodecString(
  format: Mp4VideoFormat,
  config: Mp4VideoCodecConfig,
): string {
  switch (config.kind) {
    case 'avcC':
      return deriveAvcCodecString(config);
    case 'hvcC':
      return deriveHvcCodecString(format, config);
    case 'vpcC':
      return deriveVpcCodecString(config);
    case 'av1C':
      return deriveAv1CodecString(config);
  }
}
