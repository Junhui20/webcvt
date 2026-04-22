/**
 * Cues element (ID 0x1C53BB6B) decode and encode for Matroska.
 *
 * CuePoint entries carry CueTime + CueTrackPositions (CueTrack, CueClusterPosition).
 * CueClusterPosition is segment-relative; we translate to absolute file offset.
 * CueRelativePosition and CueDuration are read but ignored (deferred per design note).
 */

import { concatBytes, findChild, parseFlatChildren, readUint, readUintNumber } from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  ID_CUES,
  ID_CUE_CLUSTER_POSITION,
  ID_CUE_DURATION,
  ID_CUE_POINT,
  ID_CUE_RELATIVE_POSITION,
  ID_CUE_TIME,
  ID_CUE_TRACK,
  ID_CUE_TRACK_POSITIONS,
  MAX_CUE_POINTS,
} from '../constants.ts';
import {
  MkvCorruptStreamError,
  MkvMissingElementError,
  MkvTooManyCuePointsError,
} from '../errors.ts';
import { encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvCuePoint {
  /** CueTime in TimecodeScale units. */
  cueTime: bigint;
  /** Track number this cue applies to. */
  trackNumber: number;
  /**
   * Cluster offset with dual semantics depending on context:
   *   - When populated by `parseMkv` (decoder): **absolute file offset** of the target Cluster.
   *     Computed as: Segment.payloadOffset + CueClusterPosition.
   *   - When built by `buildCues` in serializer.ts: **segment-relative offset**, i.e.
   *     the segment-relative byte position of the Cluster in the output stream.
   *     `encodeCues(cues, 0)` is then called with segmentPayloadOffset=0 because these
   *     values are already segment-relative (not absolute), so subtracting 0 is correct.
   */
  clusterFileOffset: number;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function decodeCues(
  bytes: Uint8Array,
  children: EbmlElement[],
  segmentPayloadOffset: number,
  elementCount: { value: number } = { value: 0 },
): MkvCuePoint[] {
  // Sec-M-4: walk CuePoint children one-at-a-time, incrementing a counter as each
  // CuePoint is encountered. This avoids materializing a 100 MB array of EbmlElement
  // objects when an adversarial input contains ~1M CuePoints before the post-check fires.
  let cuePointCount = 0;
  const cues: MkvCuePoint[] = [];

  for (const cuePointElem of children) {
    if (cuePointElem.id !== ID_CUE_POINT) continue;

    cuePointCount++;
    if (cuePointCount > MAX_CUE_POINTS) {
      throw new MkvTooManyCuePointsError(MAX_CUE_POINTS);
    }

    const cueChildren = parseFlatChildren(bytes, cuePointElem, elementCount);

    const cueTimeElem = findChild(cueChildren, ID_CUE_TIME);
    if (!cueTimeElem) throw new MkvMissingElementError('CueTime', 'CuePoint');
    const cueTime = readUint(bytes.subarray(cueTimeElem.payloadOffset, cueTimeElem.nextOffset));

    const trackPosElem = findChild(cueChildren, ID_CUE_TRACK_POSITIONS);
    if (!trackPosElem) throw new MkvMissingElementError('CueTrackPositions', 'CuePoint');
    const trackPosChildren = parseFlatChildren(bytes, trackPosElem, elementCount);

    const cueTrackElem = findChild(trackPosChildren, ID_CUE_TRACK);
    if (!cueTrackElem) throw new MkvMissingElementError('CueTrack', 'CueTrackPositions');
    const trackNumber = readUintNumber(
      bytes.subarray(cueTrackElem.payloadOffset, cueTrackElem.nextOffset),
    );

    const clusterPosElem = findChild(trackPosChildren, ID_CUE_CLUSTER_POSITION);
    if (!clusterPosElem) {
      throw new MkvMissingElementError('CueClusterPosition', 'CueTrackPositions');
    }
    const cueClusterPosition = Number(
      readUint(bytes.subarray(clusterPosElem.payloadOffset, clusterPosElem.nextOffset)),
    );
    const clusterFileOffset = segmentPayloadOffset + cueClusterPosition;

    // Sec-M-2: validate absolute file offset against file bounds.
    if (clusterFileOffset >= bytes.length) {
      throw new MkvCorruptStreamError(
        `CueClusterPosition ${cueClusterPosition} + segmentPayloadOffset ${segmentPayloadOffset} = ${clusterFileOffset} exceeds file length ${bytes.length}`,
      );
    }

    // CueRelativePosition and CueDuration: read but ignored (deferred).

    cues.push({ cueTime, trackNumber, clusterFileOffset });
  }

  return cues;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export function encodeCues(cues: MkvCuePoint[], segmentPayloadOffset: number): Uint8Array {
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
