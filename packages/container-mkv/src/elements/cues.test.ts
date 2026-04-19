/**
 * Tests for Cues element decode/encode (cues.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  ID_CUES,
  ID_CUE_CLUSTER_POSITION,
  ID_CUE_POINT,
  ID_CUE_TIME,
  ID_CUE_TRACK,
  ID_CUE_TRACK_POSITIONS,
  MAX_CUE_POINTS,
} from '../constants.ts';
import type { EbmlElement } from '../ebml-element.ts';
import { readChildren } from '../ebml-element.ts';
import { concatBytes } from '../ebml-types.ts';
import {
  MkvCorruptStreamError,
  MkvMissingElementError,
  MkvTooManyCuePointsError,
} from '../errors.ts';
import { decodeCues, encodeCues } from './cues.ts';
import { encodeMasterElement, encodeUintElement } from './header.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUintElem(id: number, value: bigint): Uint8Array {
  return encodeUintElement(id, value);
}

function buildCuePoint(cueTime: bigint, trackNumber: number, clusterPosition: bigint): Uint8Array {
  const trackPositions = concatBytes([
    makeUintElem(ID_CUE_TRACK, BigInt(trackNumber)),
    makeUintElem(ID_CUE_CLUSTER_POSITION, clusterPosition),
  ]);
  const trackPosElem = encodeMasterElement(ID_CUE_TRACK_POSITIONS, trackPositions);
  const cuePointChildren = concatBytes([makeUintElem(ID_CUE_TIME, cueTime), trackPosElem]);
  return encodeMasterElement(ID_CUE_POINT, cuePointChildren);
}

/**
 * Get payload start offset for a master element (after ID VINT + size VINT).
 * Works for 4-byte IDs (leading 0x1x pattern).
 */
function getMasterPayloadOffset(bytes: Uint8Array, elemIdWidth: number): number {
  const sizeByte = bytes[elemIdWidth] as number;
  let sizeWidth = 1;
  if ((sizeByte & 0x80) !== 0) {
    sizeWidth = 1;
  } else if ((sizeByte & 0x40) !== 0) {
    sizeWidth = 2;
  } else if ((sizeByte & 0x20) !== 0) {
    sizeWidth = 3;
  } else if ((sizeByte & 0x10) !== 0) {
    sizeWidth = 4;
  }
  return elemIdWidth + sizeWidth;
}

function buildCuesElement(cuePoints: Uint8Array[]): { bytes: Uint8Array; children: EbmlElement[] } {
  const payload = concatBytes(cuePoints);
  const cuesElem = encodeMasterElement(ID_CUES, payload);
  // ID_CUES = 0x1C53BB6B → 4-byte ID
  const payloadStart = getMasterPayloadOffset(cuesElem, 4);
  const children = readChildren(
    cuesElem,
    payloadStart,
    cuesElem.length,
    1,
    { value: 0 },
    10000,
    64 * 1024 * 1024,
    ID_CUES,
    0x18538067,
  );
  return { bytes: cuesElem, children };
}

// ---------------------------------------------------------------------------
// decodeCues tests
// ---------------------------------------------------------------------------

describe('decodeCues', () => {
  it('decodes a single cue point', () => {
    const cp = buildCuePoint(100n, 1, 200n);
    const { bytes, children } = buildCuesElement([cp]);
    // Extend so clusterFileOffset (0+200=200) < bytes.length
    const extendedBytes = new Uint8Array(300);
    extendedBytes.set(bytes, 0);

    const cues = decodeCues(extendedBytes, children, 0);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.cueTime).toBe(100n);
    expect(cues[0]?.trackNumber).toBe(1);
    expect(cues[0]?.clusterFileOffset).toBe(200);
  });

  it('computes clusterFileOffset = segmentPayloadOffset + cueClusterPosition', () => {
    const cp = buildCuePoint(50n, 1, 100n);
    const { bytes, children } = buildCuesElement([cp]);
    const extendedBytes = new Uint8Array(1000);
    extendedBytes.set(bytes, 0);

    const cues = decodeCues(extendedBytes, children, 500);
    expect(cues[0]?.clusterFileOffset).toBe(600); // 500 + 100
  });

  it('decodes multiple cue points', () => {
    const cp1 = buildCuePoint(0n, 1, 50n);
    const cp2 = buildCuePoint(100n, 1, 150n);
    const cp3 = buildCuePoint(200n, 1, 250n);
    const { bytes, children } = buildCuesElement([cp1, cp2, cp3]);
    const extendedBytes = new Uint8Array(500);
    extendedBytes.set(bytes, 0);

    const cues = decodeCues(extendedBytes, children, 0);
    expect(cues).toHaveLength(3);
    expect(cues[0]?.cueTime).toBe(0n);
    expect(cues[1]?.cueTime).toBe(100n);
    expect(cues[2]?.cueTime).toBe(200n);
  });

  it('throws MkvCorruptStreamError when clusterFileOffset >= bytes.length', () => {
    // position=100_000 + segmentOffset=0 → 100000, but bytes.length is small
    const cp = buildCuePoint(0n, 1, 100_000n);
    const { bytes, children } = buildCuesElement([cp]);
    expect(() => decodeCues(bytes, children, 0)).toThrow(MkvCorruptStreamError);
  });

  it('throws MkvMissingElementError when CueTime is absent', () => {
    const trackPositions = concatBytes([
      makeUintElem(ID_CUE_TRACK, 1n),
      makeUintElem(ID_CUE_CLUSTER_POSITION, 50n),
    ]);
    const trackPosElem = encodeMasterElement(ID_CUE_TRACK_POSITIONS, trackPositions);
    const incomplete = encodeMasterElement(ID_CUE_POINT, trackPosElem); // no CueTime
    const { bytes, children } = buildCuesElement([incomplete]);
    const extendedBytes = new Uint8Array(200);
    extendedBytes.set(bytes, 0);

    expect(() => decodeCues(extendedBytes, children, 0)).toThrow(MkvMissingElementError);
  });

  it('throws MkvMissingElementError when CueTrackPositions is absent', () => {
    const incomplete = encodeMasterElement(ID_CUE_POINT, makeUintElem(ID_CUE_TIME, 100n));
    const { bytes, children } = buildCuesElement([incomplete]);
    const extendedBytes = new Uint8Array(200);
    extendedBytes.set(bytes, 0);

    expect(() => decodeCues(extendedBytes, children, 0)).toThrow(MkvMissingElementError);
  });

  it('returns empty array when no CuePoints present', () => {
    const { bytes, children } = buildCuesElement([]);
    const cues = decodeCues(bytes, children, 0);
    expect(cues).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Sec-M-4: streaming CuePoint count check (no pre-materialization)
  // ---------------------------------------------------------------------------

  it('Sec-M-4: streaming walk increments count only for CuePoint-id elements', () => {
    // Regression test for Sec-M-4: decodeCues now walks children one-at-a-time and
    // checks cuePointCount BEFORE calling parseFlatChildren (streaming), instead of
    // calling findChildren() which would materialise the full filtered sub-array first.
    //
    // Verification approach: confirm that:
    //   (a) Non-CuePoint elements (Void etc.) don't increment the cuePointCount.
    //   (b) The cuePointCount check fires before parseFlatChildren for CuePoint elements.
    //
    // We verify (a) by inserting a Void (0xEC) element before one CuePoint element and
    // confirming the CuePoint is still processed (count=1, within limit → reaches
    // parseFlatChildren → MkvMissingElementError from empty payload).
    //
    // We verify (b) by confirming count=1 is within limit (not MkvTooManyCuePointsError).
    const fakeBytes = new Uint8Array(1);
    const children: EbmlElement[] = [
      // Void element — should be skipped, not incrementing cuePointCount
      { id: 0xec, size: 0n, payloadOffset: 0, nextOffset: 0, idWidth: 1, sizeWidth: 1 },
      // One real CuePoint id with empty payload — count=1 ≤ MAX_CUE_POINTS
      { id: ID_CUE_POINT, size: 0n, payloadOffset: 0, nextOffset: 0, idWidth: 1, sizeWidth: 1 },
    ];
    // Expect MkvMissingElementError (not MkvTooManyCuePointsError), proving count=1 < limit
    expect(() => decodeCues(fakeBytes, children, 0)).toThrow(MkvMissingElementError);
    expect(() => decodeCues(fakeBytes, children, 0)).not.toThrow(MkvTooManyCuePointsError);
  });

  it('Sec-M-4: non-CuePoint children are skipped in the streaming walk', () => {
    // Mix of CuePoint and a non-CuePoint element (e.g. Void); only CuePoints are counted.
    const cp = buildCuePoint(100n, 1, 200n);
    const { bytes, children } = buildCuesElement([cp]);
    const extendedBytes = new Uint8Array(300);
    extendedBytes.set(bytes, 0);

    // Insert a fake non-CuePoint element at the front of children.
    const mixedChildren: EbmlElement[] = [
      { id: 0xec, size: 0n, payloadOffset: 0, nextOffset: 0, idWidth: 1, sizeWidth: 1 }, // Void
      ...children,
    ];

    const cues = decodeCues(extendedBytes, mixedChildren, 0);
    expect(cues).toHaveLength(1); // only the actual CuePoint decoded
    expect(cues[0]?.cueTime).toBe(100n);
  });
});

// ---------------------------------------------------------------------------
// encodeCues tests
// ---------------------------------------------------------------------------

describe('encodeCues', () => {
  it('encodes a list of cue points and wraps in Cues element', () => {
    const cues = [
      { cueTime: 0n, trackNumber: 1, clusterFileOffset: 200 },
      { cueTime: 100n, trackNumber: 1, clusterFileOffset: 500 },
    ];
    const encoded = encodeCues(cues, 100);
    expect(encoded).toBeInstanceOf(Uint8Array);
    // Starts with ID_CUES (0x1C 0x53 0xBB 0x6B)
    expect(encoded[0]).toBe(0x1c);
    expect(encoded[1]).toBe(0x53);
    expect(encoded[2]).toBe(0xbb);
    expect(encoded[3]).toBe(0x6b);
  });

  it('round-trip: encode → decode gives same cue points', () => {
    const cues = [
      { cueTime: 50n, trackNumber: 1, clusterFileOffset: 300 },
      { cueTime: 150n, trackNumber: 1, clusterFileOffset: 600 },
    ];
    const segmentPayloadOffset = 100;
    const encoded = encodeCues(cues, segmentPayloadOffset);

    const payloadStart = getMasterPayloadOffset(encoded, 4);
    const children = readChildren(
      encoded,
      payloadStart,
      encoded.length,
      1,
      { value: 0 },
      1000,
      64 * 1024 * 1024,
      ID_CUES,
      0x18538067,
    );

    const extendedBytes = new Uint8Array(1000);
    extendedBytes.set(encoded, 0);

    const decoded = decodeCues(extendedBytes, children, segmentPayloadOffset);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.cueTime).toBe(50n);
    expect(decoded[0]?.clusterFileOffset).toBe(300);
    expect(decoded[1]?.cueTime).toBe(150n);
    expect(decoded[1]?.clusterFileOffset).toBe(600);
  });

  it('encodes empty cues list as Cues element with no CuePoints', () => {
    const encoded = encodeCues([], 0);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });
});
