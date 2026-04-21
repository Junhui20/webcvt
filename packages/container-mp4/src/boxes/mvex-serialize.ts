/**
 * mvex / mehd / trex box serializers — ISO/IEC 14496-12 §8.8.1–§8.8.3.
 *
 * Clean-room: ISO/IEC 14496-12:2022 only. No ffmpeg, MP4Box, Bento4, mp4parser
 * consulted.
 *
 * Wire formats (serialization side):
 *
 *   mvex: [size:u32][type:'mvex']  (plain container — NOT a FullBox)
 *         children: mehd? then trex*
 *
 *   mehd: [size:u32][type:'mehd'][version:u8][flags:u24=0]
 *           v0: [fragment_duration:u32]  → total box = 16 bytes
 *           v1: [fragment_duration:u64]  → total box = 20 bytes
 *         DO NOT downgrade v1 to v0 even when value fits in 32 bits (Trap 6 —
 *         a 4-byte size change would corrupt all moof data offsets via the
 *         moov-size-change guard).
 *
 *   trex: [size:u32][type:'trex'][version:u8=0][flags:u24=0]
 *         [track_ID:u32]
 *         [default_sample_description_index:u32]
 *         [default_sample_duration:u32]
 *         [default_sample_size:u32]
 *         [default_sample_flags:u32]
 *         Fixed total: 32 bytes (8-byte box header + 24-byte payload).
 */

import { writeBoxHeader } from '../box-header.ts';
import type { Mp4Mehd, Mp4TrackExtends } from './mvex.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total size of a trex box: 8 (header) + 4 (version+flags) + 5×4 (fields) = 32 bytes. */
const TREX_BOX_SIZE = 32;

/** Total size of a v0 mehd box: 8 (header) + 4 (version+flags) + 4 (u32 duration) = 16 bytes. */
const MEHD_V0_BOX_SIZE = 16;

/** Total size of a v1 mehd box: 8 (header) + 4 (version+flags) + 8 (u64 duration) = 20 bytes. */
const MEHD_V1_BOX_SIZE = 20;

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Build the mvex container box (plain container, NOT a FullBox).
 *
 * Child order per ISO 14496-12 §8.8.1: mehd (optional) then trex*.
 * trex boxes are emitted in the order supplied (parseMvex walkBoxes order),
 * which is NOT necessarily the same as trak order.
 *
 * @param mehd          Optional parsed mehd — null when absent.
 * @param trackExtends  Parsed trex entries in their original parsed order.
 */
export function buildMvexBox(
  mehd: Mp4Mehd | null,
  trackExtends: readonly Mp4TrackExtends[],
): Uint8Array {
  const children: Uint8Array[] = [];

  if (mehd !== null) {
    children.push(buildMehdBox(mehd));
  }

  for (const trex of trackExtends) {
    children.push(buildTrexBox(trex));
  }

  const payloadSize = children.reduce((s, c) => s + c.length, 0);
  const boxSize = 8 + payloadSize;
  const out = new Uint8Array(boxSize);
  writeBoxHeader(out, 0, boxSize, 'mvex');

  let off = 8;
  for (const child of children) {
    out.set(child, off);
    off += child.length;
  }

  return out;
}

/**
 * Build a mehd FullBox.
 *
 * Preserves the original version byte from the parsed Mp4Mehd.
 * A v1 (64-bit) mehd is NEVER downgraded to v0 even when fragment_duration
 * fits in 32 bits — downgrading changes box size (20 → 16) and causes the
 * moov-size-change guard to reject the output (Trap 6).
 *
 * @param mehd  Parsed mehd — must carry original version and fragmentDuration.
 */
export function buildMehdBox(mehd: Mp4Mehd): Uint8Array {
  if (mehd.version === 1) {
    // v1: 8-byte header + 4-byte version+flags + 8-byte u64 = 20 bytes total.
    const out = new Uint8Array(MEHD_V1_BOX_SIZE);
    const view = new DataView(out.buffer);
    view.setUint32(0, MEHD_V1_BOX_SIZE, false); // box size
    out[4] = 0x6d;
    out[5] = 0x65;
    out[6] = 0x68;
    out[7] = 0x64; // 'mehd'
    out[8] = 0x01; // version = 1
    // flags[9..11] = 0x000000 (already zero)
    // fragment_duration u64 big-endian at bytes 12–19
    const dur = mehd.fragmentDuration;
    const hi = Math.floor(dur / 0x100000000);
    const lo = dur >>> 0;
    view.setUint32(12, hi, false);
    view.setUint32(16, lo, false);
    return out;
  }

  // v0: 8-byte header + 4-byte version+flags + 4-byte u32 = 16 bytes total.
  const out = new Uint8Array(MEHD_V0_BOX_SIZE);
  const view = new DataView(out.buffer);
  view.setUint32(0, MEHD_V0_BOX_SIZE, false); // box size
  out[4] = 0x6d;
  out[5] = 0x65;
  out[6] = 0x68;
  out[7] = 0x64; // 'mehd'
  // out[8] = 0x00 (version = 0, already zero)
  // flags[9..11] = 0x000000 (already zero)
  // fragment_duration u32 big-endian at bytes 12–15
  view.setUint32(12, mehd.fragmentDuration >>> 0, false);
  return out;
}

/**
 * Build a trex FullBox.
 *
 * Fixed size: 32 bytes total (8-byte box header + 4-byte version+flags +
 * 5×4-byte fields = 32 bytes).
 *
 * @param trex  Parsed track extension defaults.
 */
export function buildTrexBox(trex: Mp4TrackExtends): Uint8Array {
  const out = new Uint8Array(TREX_BOX_SIZE);
  const view = new DataView(out.buffer);
  view.setUint32(0, TREX_BOX_SIZE, false); // box size = 32
  out[4] = 0x74;
  out[5] = 0x72;
  out[6] = 0x65;
  out[7] = 0x78; // 'trex'
  // out[8] = 0x00 (version = 0, already zero)
  // flags[9..11] = 0x000000 (already zero)
  // Fields start at byte 12 (after 8-byte header + 4-byte version+flags).
  view.setUint32(12, trex.trackId, false);
  view.setUint32(16, trex.defaultSampleDescriptionIndex, false);
  view.setUint32(20, trex.defaultSampleDuration, false);
  view.setUint32(24, trex.defaultSampleSize, false);
  view.setUint32(28, trex.defaultSampleFlags, false);
  return out;
}
