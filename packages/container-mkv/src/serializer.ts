/**
 * Matroska muxer — serialize an MkvFile back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * Two-pass layout:
 *   Pass 1: serialise Info, Tracks, each Cluster (recording segment-relative offsets).
 *           Choose fixed SeekHead budget (SEEK_HEAD_RESERVED_BYTES).
 *           Build Cues from cluster positions and keyframe timecodes.
 *   Pass 2: emit in canonical order: EBML header → Segment (8-byte size VINT) →
 *           SeekHead (padded) → Info → Tracks → Clusters → Cues.
 *
 * Round-trip property:
 *   parse → serialize → re-parse produces a structurally equivalent MkvFile.
 *   Output is NOT byte-identical for files with Xiph-laced SimpleBlocks (those
 *   are emitted as separate unlaced SimpleBlocks on the write path) or any file
 *   whose original layout differed from our canonical write order.
 *
 * Segment.size always uses an 8-byte VINT for back-patching headroom (Trap §15).
 * SeekHead is padded to SEEK_HEAD_RESERVED_BYTES with a Void element (Trap §16).
 */

import { concatBytes, writeVintId, writeVintSize } from '@catlabtech/webcvt-ebml';
import {
  ID_CUES,
  ID_INFO,
  ID_SEGMENT,
  ID_TRACKS,
  SEEK_HEAD_RESERVED_BYTES,
  SEGMENT_SIZE_VINT_WIDTH,
} from './constants.ts';
import { encodeCluster } from './elements/cluster.ts';
import type { MkvCluster } from './elements/cluster.ts';
import { encodeCues } from './elements/cues.ts';
import type { MkvCuePoint } from './elements/cues.ts';
import { encodeEbmlHeader } from './elements/header.ts';
import { encodeSeekHead, idToBytes } from './elements/seek-head.ts';
import { encodeInfo } from './elements/segment-info.ts';
import { encodeTracks } from './elements/tracks.ts';
import type { MkvFile } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize an MkvFile back to bytes.
 *
 * Round-trip guarantee: semantic equivalence (same tracks, codecs, timecodes,
 * frame data). NOT byte-identical for laced inputs or files with non-canonical
 * layout. Callers needing byte-identical preservation must retain the original
 * input bytes.
 */
export function serializeMkv(file: MkvFile): Uint8Array {
  const ebmlBytes = encodeEbmlHeader(file.ebmlHeader);

  const infoBytes = encodeInfo(file.info);
  const tracksBytes = encodeTracks(file.tracks);

  const segmentIdBytes = writeVintId(ID_SEGMENT);
  const segmentSizePlaceholder = new Uint8Array(SEGMENT_SIZE_VINT_WIDTH);

  // Compute segment-relative offsets.
  let segRelOffset = 0;

  const seekHeadRelOffset = segRelOffset;
  segRelOffset += SEEK_HEAD_RESERVED_BYTES;

  const infoRelOffset = segRelOffset;
  segRelOffset += infoBytes.length;

  const tracksRelOffset = segRelOffset;
  segRelOffset += tracksBytes.length;

  const clusterBytes: Uint8Array[] = [];
  const clusterRelOffsets: number[] = [];

  for (const cluster of file.clusters) {
    clusterRelOffsets.push(segRelOffset);
    const bytes = encodeCluster(cluster, file.info.timecodeScale);
    clusterBytes.push(bytes);
    segRelOffset += bytes.length;
  }

  // Build Cues from clusters.
  const cues = buildCues(file, clusterRelOffsets);
  // Pass segmentPayloadOffset=0 here because buildCues already stores segment-relative
  // offsets in clusterFileOffset (not absolute file offsets). encodeCues subtracts
  // segmentPayloadOffset to recover the segment-relative CueClusterPosition value, so
  // subtracting 0 is the correct identity transform. See MkvCuePoint.clusterFileOffset JSDoc.
  const cuesBytes = cues.length > 0 ? encodeCues(cues, 0) : new Uint8Array(0);

  const cuesRelOffset = segRelOffset;
  segRelOffset += cuesBytes.length;

  const totalSegmentPayloadSize = segRelOffset;

  const segSizeBytes = writeVintSize(BigInt(totalSegmentPayloadSize), SEGMENT_SIZE_VINT_WIDTH);

  // Build SeekHead entries (segment-relative positions).
  const seekEntries = [
    { seekId: idToBytes(ID_INFO), seekPosition: infoRelOffset },
    { seekId: idToBytes(ID_TRACKS), seekPosition: tracksRelOffset },
  ];
  if (cuesBytes.length > 0) {
    seekEntries.push({ seekId: idToBytes(ID_CUES), seekPosition: cuesRelOffset });
  }

  const seekHeadBytes = encodeSeekHead(seekEntries);

  // Assemble final output.
  const parts: Uint8Array[] = [
    ebmlBytes,
    segmentIdBytes,
    segSizeBytes,
    seekHeadBytes,
    infoBytes,
    tracksBytes,
    ...clusterBytes,
    cuesBytes,
  ];

  return concatBytes(parts);
}

// ---------------------------------------------------------------------------
// Cues builder
// ---------------------------------------------------------------------------

/**
 * Build CuePoint list from the parsed clusters.
 * One CuePoint per video-track keyframe, or per cluster if audio-only.
 */
function buildCues(file: MkvFile, clusterRelOffsets: number[]): MkvCuePoint[] {
  if (file.clusters.length === 0) return [];

  const videoTrack = file.tracks.find((t) => t.trackType === 1);
  const audioTrack = file.tracks.find((t) => t.trackType === 2);

  const cues: MkvCuePoint[] = [];

  for (let i = 0; i < file.clusters.length; i++) {
    const cluster = file.clusters[i];
    const clusterRelOffset = clusterRelOffsets[i];
    if (!cluster || clusterRelOffset === undefined) continue;

    if (videoTrack) {
      for (const block of cluster.blocks) {
        if (block.trackNumber === videoTrack.trackNumber && block.keyframe) {
          const timecodeScale = file.info.timecodeScale;
          const cueTime =
            timecodeScale > 0 ? block.timestampNs / BigInt(timecodeScale) : block.timestampNs;

          cues.push({
            cueTime,
            trackNumber: videoTrack.trackNumber,
            clusterFileOffset: clusterRelOffset,
          });
          break; // Only first keyframe per cluster for Cues.
        }
      }
    } else if (audioTrack) {
      const firstBlock = cluster.blocks.find((b) => b.trackNumber === audioTrack.trackNumber);
      if (firstBlock) {
        const timecodeScale = file.info.timecodeScale;
        const cueTime =
          timecodeScale > 0
            ? firstBlock.timestampNs / BigInt(timecodeScale)
            : firstBlock.timestampNs;
        cues.push({
          cueTime,
          trackNumber: audioTrack.trackNumber,
          clusterFileOffset: clusterRelOffset,
        });
      }
    }
  }

  return cues;
}
