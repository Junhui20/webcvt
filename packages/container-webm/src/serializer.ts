/**
 * WebM muxer — serialize a WebmFile back to a Uint8Array.
 *
 * Algorithm (per design note §Muxer):
 * Two-pass layout:
 *    a. Pass 1: serialise Info, Tracks, each Cluster (recording segment-relative offsets).
 *       Choose fixed SeekHead budget (SEEK_HEAD_RESERVED_BYTES).
 *       Build Cues from cluster positions and keyframe timecodes.
 *    b. Pass 2: emit in canonical order: EBML header → Segment (8-byte size VINT) →
 *       SeekHead (padded) → Info → Tracks → Clusters → Cues.
 *
 * Segment.size always uses an 8-byte VINT for back-patching headroom (Trap §15).
 * SeekHead is padded to SEEK_HEAD_RESERVED_BYTES with a Void element (Trap §16).
 * No byte-identical fast path is provided (see serializeWebm JSDoc for details).
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
import type { WebmCluster } from './elements/cluster.ts';
import { encodeCues } from './elements/cues.ts';
import type { WebmCuePoint } from './elements/cues.ts';
import { encodeEbmlHeader } from './elements/header.ts';
import type { WebmEbmlHeader } from './elements/header.ts';
import { encodeSeekHead, idToBytes } from './elements/seek-head.ts';
import { encodeInfo } from './elements/segment-info.ts';
import { encodeTracks } from './elements/tracks.ts';
import type { WebmFile } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a WebmFile back to bytes.
 *
 * Round-trip property: parse → serialize → re-parse produces a
 * structurally equivalent WebmFile (same tracks, codecs, timecodes,
 * frame data). Output is NOT byte-identical to the source for any
 * file that contained Xiph-laced SimpleBlocks (those are emitted as
 * separate unlaced SimpleBlocks per Q-M-2 documented behaviour) or
 * any file whose original layout differed from our canonical
 * write order (SeekHead → Info → Tracks → Cluster* → Cues).
 *
 * Callers needing byte-identical preservation must hold onto the
 * original input bytes; we do not provide a no-op pass-through fast
 * path in first pass.
 */
export function serializeWebm(file: WebmFile): Uint8Array {
  // Encode EBML header.
  const ebmlBytes = encodeEbmlHeader(file.ebmlHeader);

  // Encode segment body parts.
  const infoBytes = encodeInfo(file.info);
  const tracksBytes = encodeTracks(file.tracks);

  // Encode each cluster and record their segment-relative offsets.
  // Segment payload layout:
  //   [seekHead: SEEK_HEAD_RESERVED_BYTES]
  //   [info]
  //   [tracks]
  //   [cluster0] [cluster1] ...
  //   [cues]
  //
  // Segment payload starts right after the Segment element header (ID + 8-byte size VINT).
  // We compute segment-relative offsets for each element.

  const segmentIdBytes = writeVintId(ID_SEGMENT);
  // Segment.size always uses 8-byte VINT per Trap §15.
  const segmentSizePlaceholder = new Uint8Array(SEGMENT_SIZE_VINT_WIDTH);

  // Compute segment-relative offset for each element.
  // Offset 0 in segment payload = immediately after [segId + segSize].
  let segRelOffset = 0;

  // SeekHead occupies a fixed budget.
  const seekHeadRelOffset = segRelOffset;
  segRelOffset += SEEK_HEAD_RESERVED_BYTES;

  // Info.
  const infoRelOffset = segRelOffset;
  segRelOffset += infoBytes.length;

  // Tracks.
  const tracksRelOffset = segRelOffset;
  segRelOffset += tracksBytes.length;

  // Clusters.
  const clusterBytes: Uint8Array[] = [];
  const clusterRelOffsets: number[] = [];

  for (const cluster of file.clusters) {
    clusterRelOffsets.push(segRelOffset);
    const bytes = encodeCluster(cluster, file.info.timecodeScale);
    clusterBytes.push(bytes);
    segRelOffset += bytes.length;
  }

  // Build Cues from clusters (one CuePoint per keyframe of video track, or per cluster).
  const cues = buildCues(file, clusterRelOffsets);
  const cuesBytes = cues.length > 0 ? encodeCues(cues, 0) : new Uint8Array(0);

  const cuesRelOffset = segRelOffset;
  segRelOffset += cuesBytes.length;

  const totalSegmentPayloadSize = segRelOffset;

  // Encode the 8-byte Segment size VINT.
  const segSizeBytes = writeVintSize(BigInt(totalSegmentPayloadSize), SEGMENT_SIZE_VINT_WIDTH);

  // Compute absolute file offsets for SeekHead entries.
  const ebmlLen = ebmlBytes.length;
  const segHeaderLen = segmentIdBytes.length + segSizeBytes.length;
  const segPayloadAbsStart = ebmlLen + segHeaderLen;

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
function buildCues(file: WebmFile, clusterRelOffsets: number[]): WebmCuePoint[] {
  if (file.clusters.length === 0) return [];

  const videoTrack = file.tracks.find((t) => t.trackType === 1);
  const audioTrack = file.tracks.find((t) => t.trackType === 2);

  const cues: WebmCuePoint[] = [];

  for (let i = 0; i < file.clusters.length; i++) {
    const cluster = file.clusters[i];
    const clusterRelOffset = clusterRelOffsets[i];
    if (!cluster || clusterRelOffset === undefined) continue;

    if (videoTrack) {
      // Add a CuePoint for each keyframe of the video track.
      for (const block of cluster.blocks) {
        if (block.trackNumber === videoTrack.trackNumber && block.keyframe) {
          const timecodeScale = file.info.timecodeScale;
          const cueTime =
            timecodeScale > 0 ? block.timestampNs / BigInt(timecodeScale) : block.timestampNs;

          // Compute absolute file offset = ebml header + segment header + segment-relative.
          // For Cues, we pass 0 as segmentPayloadOffset and use raw segment-relative offsets.
          cues.push({
            cueTime,
            trackNumber: videoTrack.trackNumber,
            // clusterFileOffset will be used as segment-relative in encodeCues
            // since segmentPayloadOffset = 0 in our call.
            clusterFileOffset: clusterRelOffset,
          });
          break; // Only first keyframe per cluster for Cues.
        }
      }
    } else if (audioTrack) {
      // Audio-only: one CuePoint per cluster.
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
