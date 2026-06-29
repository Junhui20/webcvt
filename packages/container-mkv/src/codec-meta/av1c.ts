/**
 * AV1 codec metadata for Matroska V_AV01.
 *
 * The CodecPrivate of a V_AV01 track is an AV1CodecConfigurationRecord (av1C),
 * identical to the ISOBMFF av1C box payload. We derive the WebCodecs codec
 * string "av01.P.LLT.BD" from its fixed 4-byte header.
 *
 * Wire format (av1C record):
 *   [0] marker:1(=1) | version:7(=1)
 *   [1] seq_profile:3 | seq_level_idx_0:5
 *   [2] seq_tier_0:1 | high_bitdepth:1 | twelve_bit:1 | monochrome:1 |
 *       chroma_subsampling_x:1 | chroma_subsampling_y:1 | chroma_sample_position:2
 *   [3] reserved:3 | initial_presentation_delay_present:1 | …
 *
 * Spec: AV1 Codec ISO Media File Format Binding v1.2.0 §2.3; WebCodecs AV1
 * codec-string registration. Clean-room — no porting from libaom/dav1d/gpac.
 */

import { MkvInvalidCodecPrivateError } from '../errors.ts';

/**
 * Derive the WebCodecs "av01.P.LLT.BD" codec string from a V_AV01 CodecPrivate
 * (AV1CodecConfigurationRecord).
 *
 * @throws MkvInvalidCodecPrivateError when the record is shorter than 4 bytes
 *   or its marker bit is not set.
 */
export function parseAv1CodecString(codecPrivate: Uint8Array): string {
  if (codecPrivate.length < 4) {
    throw new MkvInvalidCodecPrivateError(
      'V_AV01',
      `av1C record too short (${codecPrivate.length} bytes; need at least 4)`,
    );
  }

  const b0 = codecPrivate[0] ?? 0;
  // marker(1) must be 1; version(7) is 1 for the current record.
  if ((b0 & 0x80) === 0) {
    throw new MkvInvalidCodecPrivateError('V_AV01', 'av1C marker bit is not set');
  }

  const b1 = codecPrivate[1] ?? 0;
  const b2 = codecPrivate[2] ?? 0;

  const seqProfile = (b1 >> 5) & 0x7;
  const seqLevelIdx0 = b1 & 0x1f;
  const seqTier0 = (b2 >> 7) & 0x1;
  const highBitdepth = (b2 >> 6) & 0x1;
  const twelveBit = (b2 >> 5) & 0x1;

  const tier = seqTier0 === 1 ? 'H' : 'M';
  // Bit depth from high_bitdepth + twelve_bit (AV1 spec §5.5.2).
  const bd = twelveBit === 1 ? '12' : highBitdepth === 1 ? '10' : '08';

  return `av01.${seqProfile}.${seqLevelIdx0.toString().padStart(2, '0')}${tier}.${bd}`;
}
