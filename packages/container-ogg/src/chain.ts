/**
 * Chained stream iteration for Ogg files.
 *
 * Ogg chaining (design note Trap §4b):
 *   One logical stream ends with EOS, and another begins with BOS later
 *   in the same physical file. This is common with concatenated Opus podcasts
 *   or recordings. State MUST reset between streams; downstream codec must
 *   reinitialize on each new logical stream.
 *
 * The parseOgg() function already handles chained streams internally by
 * processing sequential BOS/EOS boundaries. This module exposes helpers
 * for consumers who need to iterate streams produced by parseOgg().
 *
 * Multiplexed streams (concurrent serial numbers interleaved) are rejected
 * by parseOgg() before they reach this layer.
 */

import type { OggFile, OggLogicalStream } from './parser.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callback invoked for each logical stream in a chained Ogg file.
 *
 * Returning `false` from the callback stops iteration (like `Array.some`
 * but with a clearer "stop" semantic).
 */
export type StreamVisitor = (stream: OggLogicalStream, index: number) => boolean | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Iterate all logical streams in an OggFile in order.
 *
 * For a non-chained file this is equivalent to `file.streams.forEach()`.
 * For a chained file (multiple sequential streams), each stream is visited
 * in the order it appeared in the physical file.
 *
 * @param file  Parsed OggFile from parseOgg().
 * @param visit Called once per stream. Return `false` to stop early.
 */
export function iterateStreams(file: OggFile, visit: StreamVisitor): void {
  for (let i = 0; i < file.streams.length; i++) {
    const stream = file.streams[i];
    if (stream === undefined) continue;
    const result = visit(stream, i);
    if (result === false) break;
  }
}

/**
 * Return the first logical stream, or undefined if the file has no streams.
 *
 * Convenience wrapper for the common single-stream case.
 */
export function firstStream(file: OggFile): OggLogicalStream | undefined {
  return file.streams[0];
}

/**
 * Return all streams that match a given codec.
 */
export function streamsByCodec(
  file: OggFile,
  codec: OggLogicalStream['codec'],
): OggLogicalStream[] {
  return file.streams.filter((s) => s.codec === codec);
}

/**
 * Concatenate all audio packets across chained streams in playback order.
 *
 * This flattens `stream.packets` from each stream in sequence. Useful for
 * simple linear decode of a chained file without caring about stream
 * boundaries.
 *
 * Note: granule_position semantics (and pre_skip) differ per codec; callers
 * must handle per-stream codec metadata when decoding.
 */
export function allPacketsInOrder(file: OggFile): Array<{
  streamIndex: number;
  packetIndex: number;
  data: Uint8Array;
  granulePosition: bigint;
  serialNumber: number;
}> {
  const result: ReturnType<typeof allPacketsInOrder> = [];
  for (let si = 0; si < file.streams.length; si++) {
    const stream = file.streams[si];
    if (stream === undefined) continue;
    for (let pi = 0; pi < stream.packets.length; pi++) {
      const pkt = stream.packets[pi];
      if (pkt === undefined) continue;
      result.push({
        streamIndex: si,
        packetIndex: pi,
        data: pkt.data,
        granulePosition: pkt.granulePosition,
        serialNumber: pkt.serialNumber,
      });
    }
  }
  return result;
}
