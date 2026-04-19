/**
 * AudioSpecificConfig (ASC) builder.
 *
 * Builds the 5-byte (40-bit) AudioSpecificConfig used by WebCodecs `description`
 * field and MP4 `esds` boxes, derived from an ADTS frame header.
 *
 * Bit layout (ISO/IEC 14496-3 §1.6.2.1):
 *   bits  field
 *    5    audio_object_type          profile + 1  (MAIN=1, LC=2, SSR=3, LTP=4)
 *    4    sampling_frequency_index   from ADTS header sampleRateIndex
 *    4    channel_configuration      from ADTS header channelConfiguration
 *    1    frame_length_flag          0 (1024 samples per frame)
 *    1    depends_on_core_coder      0
 *    1    extension_flag             0
 *   = 16 bits used; packed into 3 bytes (remaining 8 bits of byte 2 are zero).
 *
 * We return 5 bytes (40 bits) to match the WebCodecs description requirement
 * and the common MP4 esds box size. The trailing bytes (3-4) are 0x00 0x00.
 *
 * Phase 1 scope: AAC-LC (object type 2) only. HE-AAC v1/v2 (object types 5/29)
 * are detected separately and routed to backend-wasm.
 *
 * Refs: ISO/IEC 14496-3:2019 §1.6.2.1
 */

import { AdtsInvalidProfileError } from './errors.ts';
import type { AdtsHeader } from './header.ts';
import { PROFILE_INDEX_MAX } from './header.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a 5-byte AudioSpecificConfig from an ADTS frame header.
 *
 * @throws AdtsInvalidProfileError when the profile index is out of the
 *         supported 0..3 range (MAIN, LC, SSR, LTP).
 */
export function buildAudioSpecificConfig(h: AdtsHeader): Uint8Array {
  const profileIndex = profileToIndex(h.profile);
  if (profileIndex < 0 || profileIndex > PROFILE_INDEX_MAX) {
    throw new AdtsInvalidProfileError(profileIndex);
  }

  // audio_object_type = profile_ObjectType = profileIndex + 1
  const audioObjectType = profileIndex + 1; // 1=MAIN, 2=LC, 3=SSR, 4=LTP

  // Pack into 5 bytes:
  // Byte 0: audioObjectType[4:0] at bits 7-3, sfi[3] at bit 2-0 (top 3 bits)
  // Byte 1: sfi[0] at bit 7, channelConfig[3:0] at bits 6-3, flags at bits 2-0
  // Bytes 2-4: 0x00
  //
  // Bit positions (MSB first):
  //  [39:35] audio_object_type (5 bits)
  //  [34:31] sampling_frequency_index (4 bits)
  //  [30:27] channel_configuration (4 bits)
  //  [26]    frame_length_flag = 0
  //  [25]    depends_on_core_coder = 0
  //  [24]    extension_flag = 0
  //  [23:0]  = 0

  const out = new Uint8Array(5);
  // Byte 0: aot[4:0] | sfi[3]
  out[0] = ((audioObjectType & 0x1f) << 3) | ((h.sampleRateIndex >> 1) & 0x7);
  // Byte 1: sfi[0] | channelConfig[3:0] | frame_length_flag(0) | depends_on_core_coder(0) | extension_flag(0)
  out[1] = ((h.sampleRateIndex & 0x1) << 7) | ((h.channelConfiguration & 0xf) << 3) | 0x00; // frame_length_flag=0, depends_on_core_coder=0, extension_flag=0
  // Bytes 2-4: 0x00 (already zero-initialised)
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profileToIndex(profile: AdtsHeader['profile']): number {
  switch (profile) {
    case 'MAIN':
      return 0;
    case 'LC':
      return 1;
    case 'SSR':
      return 2;
    case 'LTP':
      return 3;
    default: {
      // Exhaustive check — TypeScript union should prevent reaching here.
      const _never: never = profile;
      return -1;
    }
  }
}
