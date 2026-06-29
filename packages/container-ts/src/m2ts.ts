/**
 * M2TS (BDAV / AVCHD) normalization — ISO/IEC 13818-1 + Blu-ray BDAV.
 *
 * An M2TS stream wraps each 188-byte TS packet with a 4-byte TP_extra_header
 * (a 30-bit arrival timestamp + 2-bit copy-permission indicator), giving a
 * 192-byte packet. Rather than thread a variable packet size through the whole
 * demuxer, we detect the 192-byte layout and strip the prefixes once, producing
 * a standard 188-byte TS stream that the existing parser handles unchanged.
 *
 * Plain 188-byte TS takes precedence: if the stream syncs at the 188 stride we
 * leave it alone. The 4-byte arrival timestamps are dropped (they are playback
 * timing hints, not part of the TS semantics webcvt converts).
 *
 * References: ISO/IEC 13818-1 §2.4.3; Blu-ray BDAV TP_extra_header.
 */

import { M2TS_PACKET_SIZE, TS_PACKET_SIZE, TS_SYNC_BYTE } from './constants.ts';

/** Number of consecutive sync bytes to confirm a packet stride during detection. */
const CONFIRM_PACKETS = 4;

/**
 * Score how well `stride` explains the packet alignment: find the small start
 * offset whose sync byte 0x47 repeats *consecutively* at `stride`, and return
 * the longest such run (capped at CONFIRM_PACKETS) with its start offset.
 *
 * Unlike acquireSync's triple-anchor (which treats out-of-range anchors as a
 * match — fine mid-parse, but it false-locks on the last sync byte of the wrong
 * layout), this requires every checked anchor to be present, so the correct
 * stride always outscores the wrong one.
 */
function scoreStride(input: Uint8Array, stride: number): { start: number; count: number } {
  const maxStart = Math.min(stride, input.length);
  let bestStart = -1;
  let bestCount = 0;
  for (let start = 0; start < maxStart; start++) {
    if (input[start] !== TS_SYNC_BYTE) continue;
    let count = 0;
    for (let k = 0; k < CONFIRM_PACKETS; k++) {
      const p = start + k * stride;
      if (p >= input.length) break; // ran out of data — count what we confirmed
      if (input[p] !== TS_SYNC_BYTE) break; // run ends here — keep the confirmed length
      count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
    if (bestCount === CONFIRM_PACKETS) break; // fully confirmed — stop early
  }
  return { start: bestStart, count: bestCount };
}

/**
 * If `input` is an M2TS stream (192-byte packets) and not a plain 188-byte TS,
 * return a new buffer with the TP_extra_header prefixes stripped (a standard
 * 188-byte TS stream). Otherwise return null and let the caller parse `input`
 * directly.
 */
export function maybeNormalizeM2ts(input: Uint8Array): Uint8Array | null {
  const ts = scoreStride(input, TS_PACKET_SIZE);
  const m2ts = scoreStride(input, M2TS_PACKET_SIZE);

  // Normalize only when the 192-byte layout explains the alignment strictly
  // better than the 188-byte layout (≥2 confirmed packets). Plain TS always
  // wins its own stride, and ambiguous/short/non-TS input falls through to the
  // standard parser's acquireSync (which raises the proper TsNoSyncByteError).
  if (m2ts.count >= 2 && m2ts.count > ts.count) {
    return stripM2tsPrefixes(input, m2ts.start);
  }
  return null;
}

/**
 * Copy each packet's 188 TS bytes starting at the first sync byte, dropping the
 * 4-byte prefix that precedes every subsequent packet.
 */
function stripM2tsPrefixes(input: Uint8Array, start: number): Uint8Array {
  // Count full TS packets (the trailing prefix of the last packet may be absent).
  let count = 0;
  for (let p = start; p + TS_PACKET_SIZE <= input.length; p += M2TS_PACKET_SIZE) {
    count++;
  }

  const out = new Uint8Array(count * TS_PACKET_SIZE);
  let dst = 0;
  for (let p = start; p + TS_PACKET_SIZE <= input.length; p += M2TS_PACKET_SIZE) {
    out.set(input.subarray(p, p + TS_PACKET_SIZE), dst);
    dst += TS_PACKET_SIZE;
  }
  return out;
}
