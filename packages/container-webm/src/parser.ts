/**
 * WebM demuxer — parse a Uint8Array into a WebmFile.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap) — FIRST statement, always.
 * 2. Parse EBML header: require ID 0x1A45DFA3, require DocType="webm".
 * 3. Locate Segment (ID 0x18538067). Record segmentPayloadOffset.
 * 4. Two-phase Segment scan:
 *    a. Phase 1 — light walk: record offsets of SeekHead, Info, Tracks, Cluster, Cues.
 *    b. Phase 2 — deep descent: parse Info, Tracks, Cues, then each Cluster.
 * 5. Zero-track guard: non-empty input with 0 tracks → WebmCorruptStreamError.
 *
 * Security caps enforced (design note §"Security caps"):
 *   MAX_INPUT_BYTES (200 MiB)
 *   MAX_ELEMENT_PAYLOAD_BYTES (64 MiB per non-Cluster/non-Segment element)
 *   MAX_CLUSTER_BYTES (256 MiB per Cluster)
 *   MAX_ELEMENTS_PER_FILE (100,000)
 *   MAX_NEST_DEPTH (8)
 *   MAX_BLOCKS_PER_TRACK (10,000,000)
 *   MAX_CODEC_PRIVATE_BYTES (1 MiB per track, enforced in tracks.ts)
 *   MAX_CUE_POINTS (1,000,000, enforced in cues.ts)
 */

import { findChild, readChildren, readElementHeader } from '@webcvt/ebml';
import type { EbmlElement } from '@webcvt/ebml';
import { readVintId, readVintSize } from '@webcvt/ebml';
import {
  EbmlElementTooLargeError,
  EbmlTooManyElementsError,
  EbmlTruncatedError,
  EbmlUnknownSizeError,
} from '@webcvt/ebml';
import {
  ID_CLUSTER,
  ID_CUES,
  ID_EBML,
  ID_INFO,
  ID_SEEK_HEAD,
  ID_SEGMENT,
  ID_TRACKS,
  ID_VOID,
  MAX_CLUSTER_BYTES,
  MAX_ELEMENTS_PER_FILE,
  MAX_ELEMENT_PAYLOAD_BYTES,
  MAX_INPUT_BYTES,
  MAX_NEST_DEPTH,
} from './constants.ts';
import { decodeCluster } from './elements/cluster.ts';
import type { WebmCluster } from './elements/cluster.ts';
import { decodeCues } from './elements/cues.ts';
import type { WebmCuePoint } from './elements/cues.ts';
import { decodeEbmlHeader } from './elements/header.ts';
import type { WebmEbmlHeader } from './elements/header.ts';
import { decodeSeekHead } from './elements/seek-head.ts';
import type { WebmSeekHead } from './elements/seek-head.ts';
import { decodeInfo } from './elements/segment-info.ts';
import type { WebmInfo } from './elements/segment-info.ts';
import { decodeTracks } from './elements/tracks.ts';
import type { WebmTrack } from './elements/tracks.ts';
import {
  WebmCorruptStreamError,
  WebmInputTooLargeError,
  WebmMissingElementError,
  WebmMissingSegmentError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebmFile {
  ebmlHeader: WebmEbmlHeader;
  /** Absolute file offset of the Segment element's first payload byte. */
  segmentPayloadOffset: number;
  info: WebmInfo;
  tracks: WebmTrack[];
  clusters: WebmCluster[];
  cues?: WebmCuePoint[];
  seekHead?: WebmSeekHead;
  /** Reference to the original input bytes (zero-copy SimpleBlock access). */
  fileBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete WebM byte stream into a WebmFile.
 *
 * Security cap: input > 200 MiB throws WebmInputTooLargeError as the FIRST
 * statement (FLAC C-1 pattern).
 *
 * @throws WebmInputTooLargeError — input > 200 MiB.
 * @throws WebmDocTypeNotSupportedError — DocType != "webm".
 * @throws WebmEbmlVersionError — version != 1.
 * @throws WebmMissingSegmentError — no Segment element.
 * @throws WebmMissingElementError — required element missing.
 * @throws WebmUnsupportedCodecError — unsupported CodecID.
 * @throws WebmMultiTrackNotSupportedError — > 1 video or audio track.
 * @throws WebmCorruptStreamError — non-empty input with 0 tracks.
 * @throws WebmLacingNotSupportedError — fixed-size or EBML lacing.
 */
export function parseWebm(input: Uint8Array): WebmFile {
  // Security cap #1: input size — MUST be the first statement.
  if (input.length > MAX_INPUT_BYTES) {
    throw new WebmInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  if (input.length === 0) {
    throw new WebmCorruptStreamError('empty input');
  }

  const elementCount = { value: 0 };

  // -------------------------------------------------------------------------
  // Step 2: Parse EBML header
  // -------------------------------------------------------------------------
  const ebmlIdVint = readVintId(input, 0);
  if (ebmlIdVint.value !== ID_EBML) {
    throw new WebmMissingElementError('EBML', 'file root');
  }

  const ebmlSizeOffset = ebmlIdVint.width;
  const ebmlSizeVint = readVintSize(input, ebmlSizeOffset);
  if (ebmlSizeVint.value === -1n) {
    throw new EbmlUnknownSizeError(ID_EBML, 0);
  }

  elementCount.value++;

  const ebmlPayloadOffset = ebmlSizeOffset + ebmlSizeVint.width;
  const ebmlNextOffset = ebmlPayloadOffset + Number(ebmlSizeVint.value);

  // Parse EBML header children (flat walk).
  const ebmlChildren = readChildren(
    input,
    ebmlPayloadOffset,
    ebmlNextOffset,
    1,
    elementCount,
    MAX_ELEMENTS_PER_FILE,
    MAX_ELEMENT_PAYLOAD_BYTES,
    ID_CLUSTER,
    ID_SEGMENT,
  );

  const ebmlHeader = decodeEbmlHeader(input, ebmlChildren);

  // -------------------------------------------------------------------------
  // Step 3: Locate Segment
  // -------------------------------------------------------------------------
  const segOffset = ebmlNextOffset;
  if (segOffset >= input.length) {
    throw new WebmMissingSegmentError();
  }

  const segIdVint = readVintId(input, segOffset);
  if (segIdVint.value !== ID_SEGMENT) {
    throw new WebmMissingSegmentError();
  }

  const segSizeOffset = segOffset + segIdVint.width;
  const segSizeVint = readVintSize(input, segSizeOffset);

  if (segSizeVint.value === -1n) {
    // Sec-H-1: Unknown-size Segment is out of scope (design note Trap §2).
    // Live/streaming WebM with infinite Segment size is deferred.
    throw new EbmlUnknownSizeError(ID_SEGMENT, segOffset);
  }
  const segPayloadOffset = segSizeOffset + segSizeVint.width;
  const segEnd = segPayloadOffset + Number(segSizeVint.value);
  if (segEnd > input.length) {
    throw new EbmlTruncatedError(ID_SEGMENT, segSizeVint.value, input.length - segPayloadOffset);
  }

  elementCount.value++;
  const segmentPayloadOffset = segPayloadOffset;

  // -------------------------------------------------------------------------
  // Step 4a: Phase 1 — light walk of Segment's direct children
  // -------------------------------------------------------------------------
  interface SegmentChildRecord {
    elem: EbmlElement;
    kind: 'seekHead' | 'info' | 'tracks' | 'cluster' | 'cues' | 'other';
  }

  const segChildRecords: SegmentChildRecord[] = [];
  let cursor = segmentPayloadOffset;

  while (cursor < segEnd) {
    if (segEnd - cursor < 2) break;

    // Read element header.
    const idVint = readVintId(input, cursor);
    const sizeOff = cursor + idVint.width;
    const sizeVint = readVintSize(input, sizeOff);
    const payloadOff = sizeOff + sizeVint.width;

    if (sizeVint.value === -1n) {
      // Unknown-size Cluster is allowed in some live WebM; skip to end.
      // For first pass, treat as segment end.
      break;
    }

    const elemSize = Number(sizeVint.value);
    const nextOff = payloadOff + elemSize;

    if (nextOff > segEnd) {
      // Truncated element at segment end — stop.
      break;
    }

    elementCount.value++;
    if (elementCount.value > MAX_ELEMENTS_PER_FILE) {
      throw new EbmlTooManyElementsError(MAX_ELEMENTS_PER_FILE);
    }

    const id = idVint.value;

    // Per-element size cap (Cluster has its own cap; Segment already handled).
    if (id !== ID_CLUSTER) {
      if (elemSize > MAX_ELEMENT_PAYLOAD_BYTES) {
        throw new EbmlElementTooLargeError(id, BigInt(elemSize), MAX_ELEMENT_PAYLOAD_BYTES);
      }
    } else {
      if (elemSize > MAX_CLUSTER_BYTES) {
        throw new EbmlElementTooLargeError(id, BigInt(elemSize), MAX_CLUSTER_BYTES);
      }
    }

    const elem: EbmlElement = {
      id,
      size: BigInt(elemSize),
      payloadOffset: payloadOff,
      nextOffset: nextOff,
      idWidth: idVint.width,
      sizeWidth: sizeVint.width,
    };

    let kind: SegmentChildRecord['kind'] = 'other';
    if (id === ID_SEEK_HEAD) kind = 'seekHead';
    else if (id === ID_INFO) kind = 'info';
    else if (id === ID_TRACKS) kind = 'tracks';
    else if (id === ID_CLUSTER) kind = 'cluster';
    else if (id === ID_CUES) kind = 'cues';
    // Void and all others: 'other' — skip

    segChildRecords.push({ elem, kind });
    cursor = nextOff;
  }

  // -------------------------------------------------------------------------
  // Step 4b: Phase 2 — deep descent
  // -------------------------------------------------------------------------

  // Parse Info.
  const infoRecord = segChildRecords.find((r) => r.kind === 'info');
  if (!infoRecord) throw new WebmMissingElementError('Info', 'Segment');
  const infoChildren = readChildren(
    input,
    infoRecord.elem.payloadOffset,
    infoRecord.elem.nextOffset,
    2,
    elementCount,
    MAX_ELEMENTS_PER_FILE,
    MAX_ELEMENT_PAYLOAD_BYTES,
    ID_CLUSTER,
    ID_SEGMENT,
  );
  const info = decodeInfo(input, infoChildren);

  // Validate timecodeScale non-zero (Trap §4).
  if (info.timecodeScale === 0) {
    throw new WebmCorruptStreamError('TimecodeScale is zero');
  }

  // Parse Tracks.
  const tracksRecord = segChildRecords.find((r) => r.kind === 'tracks');
  if (!tracksRecord) throw new WebmMissingElementError('Tracks', 'Segment');
  const tracksChildren = readChildren(
    input,
    tracksRecord.elem.payloadOffset,
    tracksRecord.elem.nextOffset,
    2,
    elementCount,
    MAX_ELEMENTS_PER_FILE,
    MAX_ELEMENT_PAYLOAD_BYTES,
    ID_CLUSTER,
    ID_SEGMENT,
  );
  const tracks = decodeTracks(input, tracksChildren, elementCount);

  // Parse SeekHead (optional).
  const seekHeadRecord = segChildRecords.find((r) => r.kind === 'seekHead');
  let seekHead: WebmSeekHead | undefined;
  if (seekHeadRecord) {
    const seekHeadChildren = readChildren(
      input,
      seekHeadRecord.elem.payloadOffset,
      seekHeadRecord.elem.nextOffset,
      2,
      elementCount,
      MAX_ELEMENTS_PER_FILE,
      MAX_ELEMENT_PAYLOAD_BYTES,
      ID_CLUSTER,
      ID_SEGMENT,
    );
    seekHead = decodeSeekHead(input, seekHeadChildren, elementCount, segmentPayloadOffset);
  }

  // Parse Cues (optional).
  const cuesRecord = segChildRecords.find((r) => r.kind === 'cues');
  let cues: WebmCuePoint[] | undefined;
  if (cuesRecord) {
    const cuesChildren = readChildren(
      input,
      cuesRecord.elem.payloadOffset,
      cuesRecord.elem.nextOffset,
      2,
      elementCount,
      MAX_ELEMENTS_PER_FILE,
      MAX_ELEMENT_PAYLOAD_BYTES,
      ID_CLUSTER,
      ID_SEGMENT,
    );
    cues = decodeCues(input, cuesChildren, segmentPayloadOffset, elementCount);
  }

  // Parse Clusters.
  const blockCounts = new Map<number, number>();
  const clusters: WebmCluster[] = [];

  for (const record of segChildRecords) {
    if (record.kind !== 'cluster') continue;
    const cluster = decodeCluster(input, record.elem, info.timecodeScale, blockCounts);
    clusters.push(cluster);
  }

  // Zero-track guard (FLAC M-1 / MP4 pattern).
  if (tracks.length === 0) {
    throw new WebmCorruptStreamError('parsed WebM has zero tracks from non-empty input');
  }

  return {
    ebmlHeader,
    segmentPayloadOffset,
    info,
    tracks,
    clusters,
    cues,
    seekHead,
    fileBytes: input,
  };
}
