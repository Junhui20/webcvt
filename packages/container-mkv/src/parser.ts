/**
 * Matroska demuxer — parse a Uint8Array into an MkvFile.
 *
 * Algorithm (per design note §Demuxer):
 * 1. Input size guard (200 MiB cap) — FIRST statement, always.
 * 2. Parse EBML header: require ID 0x1A45DFA3, require DocType="matroska".
 *    Reject DocType="webm" with MkvDocTypeNotSupportedError (routes to container-webm).
 * 3. Locate Segment (ID 0x18538067). Reject unknown size. Record segmentPayloadOffset.
 * 4. Two-phase Segment scan:
 *    a. Phase 1 — light walk: record offsets of SeekHead, Info, Tracks, Cluster, Cues.
 *       Skip unknown elements (Chapters, Tags, Attachments, etc.) using declared size.
 *    b. Phase 2 — deep descent: parse Info, Tracks, Cues, then each Cluster.
 * 5. Zero-track guard: non-empty input with 0 tracks → MkvCorruptStreamError.
 *
 * Routing note: detect.ts returns 'webm' FormatDescriptor for any EBML-headed file
 * including .mkv. The actual routing happens here via DocType validation. When
 * DocType is "webm" we throw MkvDocTypeNotSupportedError so the BackendRegistry
 * can try container-webm instead.
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
  MAX_CLUSTER_BYTES,
  MAX_ELEMENTS_PER_FILE,
  MAX_ELEMENT_PAYLOAD_BYTES,
  MAX_INPUT_BYTES,
} from './constants.ts';
import { decodeCluster } from './elements/cluster.ts';
import type { MkvCluster } from './elements/cluster.ts';
import { decodeCues } from './elements/cues.ts';
import type { MkvCuePoint } from './elements/cues.ts';
import { decodeEbmlHeader } from './elements/header.ts';
import type { MkvEbmlHeader } from './elements/header.ts';
import { decodeSeekHead } from './elements/seek-head.ts';
import type { MkvSeekHead } from './elements/seek-head.ts';
import { decodeInfo } from './elements/segment-info.ts';
import type { MkvInfo } from './elements/segment-info.ts';
import { decodeTracks } from './elements/tracks.ts';
import type { MkvTrack } from './elements/tracks.ts';
import {
  MkvCorruptStreamError,
  MkvInputTooLargeError,
  MkvMissingElementError,
  MkvMissingSegmentError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MkvFile {
  ebmlHeader: MkvEbmlHeader;
  /** Absolute file offset of the Segment element's first payload byte. */
  segmentPayloadOffset: number;
  info: MkvInfo;
  tracks: MkvTrack[];
  clusters: MkvCluster[];
  cues?: MkvCuePoint[];
  seekHead?: MkvSeekHead;
  /** Reference to the original input bytes (zero-copy SimpleBlock access). */
  fileBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete Matroska byte stream into an MkvFile.
 *
 * Security cap: input > 200 MiB throws MkvInputTooLargeError as the FIRST
 * statement (per design note §"Security caps" and Sec-H-1 lesson).
 *
 * @throws MkvInputTooLargeError — input > 200 MiB.
 * @throws MkvDocTypeNotSupportedError — DocType != "matroska" (incl. "webm").
 * @throws MkvEbmlVersionError — version != 1.
 * @throws MkvMissingSegmentError — no Segment element.
 * @throws MkvMissingElementError — required element missing.
 * @throws MkvUnsupportedCodecError — unsupported CodecID.
 * @throws MkvMultiTrackNotSupportedError — > 1 video or audio track.
 * @throws MkvCorruptStreamError — non-empty input with 0 tracks.
 * @throws MkvLacingNotSupportedError — fixed-size or EBML lacing.
 */
export function parseMkv(input: Uint8Array): MkvFile {
  // Security cap #1: input size — MUST be the first statement.
  if (input.length > MAX_INPUT_BYTES) {
    throw new MkvInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  if (input.length === 0) {
    throw new MkvCorruptStreamError('empty input');
  }

  const elementCount = { value: 0 };

  // -------------------------------------------------------------------------
  // Step 2: Parse EBML header
  // -------------------------------------------------------------------------
  const ebmlIdVint = readVintId(input, 0);
  if (ebmlIdVint.value !== ID_EBML) {
    throw new MkvMissingElementError('EBML', 'file root');
  }

  const ebmlSizeOffset = ebmlIdVint.width;
  const ebmlSizeVint = readVintSize(input, ebmlSizeOffset);
  if (ebmlSizeVint.value === -1n) {
    throw new EbmlUnknownSizeError(ID_EBML, 0);
  }

  elementCount.value++;

  const ebmlPayloadOffset = ebmlSizeOffset + ebmlSizeVint.width;
  const ebmlNextOffset = ebmlPayloadOffset + Number(ebmlSizeVint.value);

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

  // decodeEbmlHeader validates DocType == "matroska" (Trap §19).
  const ebmlHeader = decodeEbmlHeader(input, ebmlChildren);

  // -------------------------------------------------------------------------
  // Step 3: Locate Segment
  // -------------------------------------------------------------------------
  const segOffset = ebmlNextOffset;
  if (segOffset >= input.length) {
    throw new MkvMissingSegmentError();
  }

  const segIdVint = readVintId(input, segOffset);
  if (segIdVint.value !== ID_SEGMENT) {
    throw new MkvMissingSegmentError();
  }

  const segSizeOffset = segOffset + segIdVint.width;
  const segSizeVint = readVintSize(input, segSizeOffset);

  if (segSizeVint.value === -1n) {
    // Sec-H-1: Unknown-size Segment is out of scope (design note Trap §2).
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

    const idVint = readVintId(input, cursor);
    const sizeOff = cursor + idVint.width;
    const sizeVint = readVintSize(input, sizeOff);
    const payloadOff = sizeOff + sizeVint.width;

    if (sizeVint.value === -1n) {
      // Unknown-size element at segment depth (e.g. live Cluster): stop.
      break;
    }

    const elemSize = Number(sizeVint.value);
    const nextOff = payloadOff + elemSize;

    if (nextOff > segEnd) {
      break; // truncated element at segment end — stop
    }

    elementCount.value++;
    if (elementCount.value > MAX_ELEMENTS_PER_FILE) {
      throw new EbmlTooManyElementsError(MAX_ELEMENTS_PER_FILE);
    }

    const id = idVint.value;

    // Per-element size cap (Cluster has its own cap).
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
    // Void, Chapters, Tags, Attachments, etc.: 'other' — skip (Trap §14)

    segChildRecords.push({ elem, kind });
    cursor = nextOff;
  }

  // -------------------------------------------------------------------------
  // Step 4b: Phase 2 — deep descent
  // -------------------------------------------------------------------------

  // Parse Info.
  const infoRecord = segChildRecords.find((r) => r.kind === 'info');
  if (!infoRecord) throw new MkvMissingElementError('Info', 'Segment');
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
    throw new MkvCorruptStreamError('TimecodeScale is zero');
  }

  // Parse Tracks.
  const tracksRecord = segChildRecords.find((r) => r.kind === 'tracks');
  if (!tracksRecord) throw new MkvMissingElementError('Tracks', 'Segment');
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
  let seekHead: MkvSeekHead | undefined;
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
  let cues: MkvCuePoint[] | undefined;
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
  const clusters: MkvCluster[] = [];

  for (const record of segChildRecords) {
    if (record.kind !== 'cluster') continue;
    // Thread elementCount so inner-Cluster elements count against MAX_ELEMENTS_PER_FILE (Sec-H-1).
    const cluster = decodeCluster(
      input,
      record.elem,
      info.timecodeScale,
      blockCounts,
      elementCount,
    );
    clusters.push(cluster);
  }

  // Zero-track guard.
  if (tracks.length === 0) {
    throw new MkvCorruptStreamError('parsed MKV has zero tracks from non-empty input');
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
