/**
 * Block iterator — convert parsed WebmFile clusters into WebCodecs-compatible chunks.
 *
 * Yields EncodedVideoChunk-compatible objects for video tracks and
 * EncodedAudioChunk-compatible objects for audio tracks.
 *
 * Per design note §WebCodecs integration:
 * - VP8/VP9: type = 'key' | 'delta', timestamp in microseconds.
 * - Vorbis/Opus: type = 'key' (all audio packets post-init), timestamp in microseconds.
 * - timestampUs = block.timestampNs / 1000n (integer division in bigint, then Number).
 */

import type { WebmSimpleBlock } from './elements/cluster.ts';
import type { WebmFile } from './parser.ts';

// ---------------------------------------------------------------------------
// Types matching WebCodecs EncodedVideoChunk / EncodedAudioChunk shape
// ---------------------------------------------------------------------------

export interface VideoChunk {
  data: Uint8Array;
  type: 'key' | 'delta';
  /** Timestamp in microseconds (for WebCodecs EncodedVideoChunk). */
  timestampUs: number;
}

export interface AudioChunk {
  data: Uint8Array;
  /** Timestamp in microseconds (for WebCodecs EncodedAudioChunk). */
  timestampUs: number;
}

// ---------------------------------------------------------------------------
// Video chunk iterator
// ---------------------------------------------------------------------------

/**
 * Iterate over all video frames from the given track across all clusters.
 *
 * Each SimpleBlock may contain multiple frames if Xiph-laced; we yield one
 * VideoChunk per frame.
 *
 * @param file         Parsed WebmFile.
 * @param trackNumber  The video track number to iterate.
 */
export function* iterateVideoChunks(file: WebmFile, trackNumber: number): Generator<VideoChunk> {
  for (const cluster of file.clusters) {
    for (const block of cluster.blocks) {
      if (block.trackNumber !== trackNumber) continue;

      const type: 'key' | 'delta' = block.keyframe ? 'key' : 'delta';
      const timestampUs = Number(block.timestampNs / 1000n);

      for (const frame of block.frames) {
        yield { data: frame, type, timestampUs };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Audio chunk iterator
// ---------------------------------------------------------------------------

/**
 * Iterate over all audio frames from the given track across all clusters.
 *
 * Vorbis and Opus both use type='key' for post-init packets per the design note.
 *
 * @param file         Parsed WebmFile.
 * @param trackNumber  The audio track number to iterate.
 */
export function* iterateAudioChunks(file: WebmFile, trackNumber: number): Generator<AudioChunk> {
  for (const cluster of file.clusters) {
    for (const block of cluster.blocks) {
      if (block.trackNumber !== trackNumber) continue;

      const timestampUs = Number(block.timestampNs / 1000n);

      for (const frame of block.frames) {
        yield { data: frame, timestampUs };
      }
    }
  }
}
