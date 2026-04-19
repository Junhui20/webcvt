/**
 * Cues element (ID 0x1C53BB6B) decode and encode.
 *
 * CuePoint entries carry CueTime + CueTrackPositions (CueTrack, CueClusterPosition).
 * CueClusterPosition is segment-relative; we translate to absolute file offset.
 */

import {
  ID_CUES,
  ID_CUE_CLUSTER_POSITION,
  ID_CUE_POINT,
  ID_CUE_TIME,
  ID_CUE_TRACK,
  ID_CUE_TRACK_POSITIONS,
  MAX_CUE_POINTS,
} from '../constants.ts';
import { findChild, findChildren, parseFlatChildren } from '../ebml-element.ts';
import type { EbmlElement } from '../ebml-element.ts';
import { concatBytes, readUint, readUintNumber } from '../ebml-types.ts';
import { writeVintId, writeVintSize } from '../ebml-vint.ts';
import {
  WebmCorruptStreamError,
  WebmMissingElementError,
  WebmTooManyCuePointsError,
} from '../errors.ts';
import { encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebmCuePoint {
  /** CueTime in TimecodeScale units. */
  cueTime: bigint;
  /** Track number this cue applies to. */
  trackNumber: number;
  /**
   * Absolute file offset of the target Cluster.
   * Computed from: Segment.payloadOffset + CueClusterPosition.
   */
  clusterFileOffset: number;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode the Cues element from its direct children.
 *
 * @param bytes                 Full file buffer.
 * @param children              Direct children of the Cues master element.
 * @param segmentPayloadOffset  Absolute offset of the first byte of the Segment payload.
 * @param elementCount          Mutable global element counter for cap enforcement (Q-H-2 / Sec-M-1).
 */
export function decodeCues(
  bytes: Uint8Array,
  children: EbmlElement[],
  segmentPayloadOffset: number,
  elementCount: { value: number } = { value: 0 },
): WebmCuePoint[] {
  const cuePointElems = findChildren(children, ID_CUE_POINT);
  if (cuePointElems.length > MAX_CUE_POINTS) {
    throw new WebmTooManyCuePointsError(MAX_CUE_POINTS);
  }

  const cues: WebmCuePoint[] = [];

  for (const cuePointElem of cuePointElems) {
    // Q-H-2 / Sec-M-1: use shared helper that threads elementCount + size caps.
    const cueChildren = parseFlatChildren(bytes, cuePointElem, elementCount);

    const cueTimeElem = findChild(cueChildren, ID_CUE_TIME);
    if (!cueTimeElem) throw new WebmMissingElementError('CueTime', 'CuePoint');
    const cueTime = readUint(bytes.subarray(cueTimeElem.payloadOffset, cueTimeElem.nextOffset));

    const trackPosElem = findChild(cueChildren, ID_CUE_TRACK_POSITIONS);
    if (!trackPosElem) throw new WebmMissingElementError('CueTrackPositions', 'CuePoint');
    const trackPosChildren = parseFlatChildren(bytes, trackPosElem, elementCount);

    const cueTrackElem = findChild(trackPosChildren, ID_CUE_TRACK);
    if (!cueTrackElem) throw new WebmMissingElementError('CueTrack', 'CueTrackPositions');
    const trackNumber = readUintNumber(
      bytes.subarray(cueTrackElem.payloadOffset, cueTrackElem.nextOffset),
    );

    const clusterPosElem = findChild(trackPosChildren, ID_CUE_CLUSTER_POSITION);
    if (!clusterPosElem) {
      throw new WebmMissingElementError('CueClusterPosition', 'CueTrackPositions');
    }
    const cueClusterPosition = Number(
      readUint(bytes.subarray(clusterPosElem.payloadOffset, clusterPosElem.nextOffset)),
    );
    const clusterFileOffset = segmentPayloadOffset + cueClusterPosition;

    // Sec-M-2: validate absolute file offset against file bounds.
    if (clusterFileOffset >= bytes.length) {
      throw new WebmCorruptStreamError(
        `CueClusterPosition ${cueClusterPosition} + segmentPayloadOffset ${segmentPayloadOffset} = ${clusterFileOffset} exceeds file length ${bytes.length}`,
      );
    }

    cues.push({ cueTime, trackNumber, clusterFileOffset });
  }

  return cues;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode the Cues element from an array of WebmCuePoint entries.
 *
 * @param cues                  Cue points to encode.
 * @param segmentPayloadOffset  Used to convert absolute file offsets → segment-relative.
 */
export function encodeCues(cues: WebmCuePoint[], segmentPayloadOffset: number): Uint8Array {
  const cuePointParts = cues.map((cue) => {
    const cueClusterPosition = cue.clusterFileOffset - segmentPayloadOffset;
    const trackPositions = concatBytes([
      encodeUintElement(ID_CUE_TRACK, BigInt(cue.trackNumber)),
      encodeUintElement(ID_CUE_CLUSTER_POSITION, BigInt(cueClusterPosition)),
    ]);
    const trackPosElem = encodeMasterElement(ID_CUE_TRACK_POSITIONS, trackPositions);
    const cuePointChildren = concatBytes([
      encodeUintElement(ID_CUE_TIME, cue.cueTime),
      trackPosElem,
    ]);
    return encodeMasterElement(ID_CUE_POINT, cuePointChildren);
  });

  return encodeMasterElement(ID_CUES, concatBytes(cuePointParts));
}
