/**
 * Tests for cues decode/encode (elements/cues.ts).
 *
 * Covers design note test case:
 * - "parses Cues block and resolves CueClusterPosition to absolute file offset"
 */

import type { EbmlElement } from '@webcvt/ebml';
import { describe, expect, it } from 'vitest';
import { MAX_CUE_POINTS } from '../constants.ts';
import {
  WebmCorruptStreamError,
  WebmMissingElementError,
  WebmTooManyCuePointsError,
} from '../errors.ts';
import { decodeCues, encodeCues } from './cues.ts';

function concatU8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function encodeVintSize(size: number): Uint8Array {
  if (size < 127) return new Uint8Array([0x80 | size]);
  return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
}

function makeElemBytes(id: number, payload: Uint8Array): Uint8Array {
  let idBytes: Uint8Array;
  if (id >= 0x10000000) {
    idBytes = new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  } else if (id >= 0x200000) {
    idBytes = new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  } else if (id >= 0x4000) {
    idBytes = new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  } else {
    idBytes = new Uint8Array([id & 0xff]);
  }
  return concatU8([idBytes, encodeVintSize(payload.length), payload]);
}

function makeUintPayload(value: number, width = 4): Uint8Array {
  const out = new Uint8Array(width);
  new DataView(out.buffer).setUint32(width - 4, value, false);
  return out;
}

/**
 * Build a Cues element with one CuePoint.
 */
function buildCuesElement(
  cueTime: number,
  cueTrack: number,
  clusterPosition: number,
): {
  bytes: Uint8Array;
  children: EbmlElement[];
} {
  // CueTime element (ID 0xB3, 1 byte ID).
  const cueTimeElem = makeElemBytes(0xb3, makeUintPayload(cueTime));

  // CueTrack element (ID 0xF7, 1 byte ID).
  const cueTrackElem = makeElemBytes(0xf7, makeUintPayload(cueTrack));

  // CueClusterPosition element (ID 0xF1, 1 byte ID).
  const clusterPosElem = makeElemBytes(0xf1, makeUintPayload(clusterPosition));

  // CueTrackPositions (ID 0xB7).
  const trackPosPayload = concatU8([cueTrackElem, clusterPosElem]);
  const trackPosElem = makeElemBytes(0xb7, trackPosPayload);

  // CuePoint (ID 0xBB).
  const cuePointPayload = concatU8([cueTimeElem, trackPosElem]);
  const cuePointElem = makeElemBytes(0xbb, cuePointPayload);

  // Cues master (ID 0x1C53BB6B, 4 bytes).
  const cuesId = new Uint8Array([0x1c, 0x53, 0xbb, 0x6b]);
  const cuesSize = encodeVintSize(cuePointElem.length);
  const fullBytes = concatU8([cuesId, cuesSize, cuePointElem]);

  // Build children array relative to fullBytes.
  const cuesPayloadOffset = 4 + cuesSize.length;

  // CuePoint element.
  const cuePointPayloadOffset = cuesPayloadOffset + 1 + 1; // 0xBB (1 byte ID) + size (1 byte)
  const cuePointChild: EbmlElement = {
    id: 0xbb,
    size: BigInt(cuePointPayload.length),
    payloadOffset: cuePointPayloadOffset,
    nextOffset: cuePointPayloadOffset + cuePointPayload.length,
    idWidth: 1,
    sizeWidth: 1,
  };

  return { bytes: fullBytes, children: [cuePointChild] };
}

describe('decodeCues', () => {
  it('decodes a single CuePoint and resolves absolute file offset', () => {
    const segmentPayloadOffset = 100; // segment starts at byte 100
    const clusterPosition = 50; // cluster is 50 bytes into segment payload

    const { bytes, children } = buildCuesElement(0, 1, clusterPosition);
    // Sec-M-2: absolute offset = 100 + 50 = 150. Buffer must be > 150 bytes.
    const extendedBuffer = new Uint8Array(200);
    extendedBuffer.set(bytes, 0);
    const cues = decodeCues(extendedBuffer, children, segmentPayloadOffset);

    expect(cues).toHaveLength(1);
    const cue = cues[0];
    expect(cue?.cueTime).toBe(0n);
    expect(cue?.trackNumber).toBe(1);
    // Absolute offset = segmentPayloadOffset + CueClusterPosition = 100 + 50 = 150
    expect(cue?.clusterFileOffset).toBe(150);
  });

  it('decodes CueTime correctly', () => {
    const { bytes, children } = buildCuesElement(1000, 1, 200);
    // Sec-M-2: absolute offset = 0 + 200 = 200. Buffer must be > 200 bytes.
    const extendedBuffer = new Uint8Array(300);
    extendedBuffer.set(bytes, 0);
    const cues = decodeCues(extendedBuffer, children, 0);
    expect(cues[0]?.cueTime).toBe(1000n);
  });

  it('returns empty array for no CuePoint children', () => {
    const cues = decodeCues(new Uint8Array(0), [], 0);
    expect(cues).toHaveLength(0);
  });

  it('throws WebmTooManyCuePointsError when children exceed MAX_CUE_POINTS', () => {
    // Build a fake children array with MAX_CUE_POINTS + 1 elements.
    const fakeCuePointChildren: EbmlElement[] = Array.from(
      { length: MAX_CUE_POINTS + 1 },
      (_, i) => ({
        id: 0xbb,
        size: 0n,
        payloadOffset: i,
        nextOffset: i,
        idWidth: 1,
        sizeWidth: 1,
      }),
    );
    expect(() => decodeCues(new Uint8Array(0), fakeCuePointChildren, 0)).toThrow(
      WebmTooManyCuePointsError,
    );
  });

  it('throws WebmMissingElementError when CueTime is absent from CuePoint', () => {
    // Build a CuePoint element with no CueTime child (only CueTrackPositions).
    const trackPosPayload = concatU8([
      makeElemBytes(0xf7, makeUintPayload(1)), // CueTrack
      makeElemBytes(0xf1, makeUintPayload(50)), // CueClusterPosition
    ]);
    const trackPosElem = makeElemBytes(0xb7, trackPosPayload);
    // CuePoint with only CueTrackPositions (missing CueTime).
    const cuePointPayload = trackPosElem;
    const cuePointElem = makeElemBytes(0xbb, cuePointPayload);
    // Cues master.
    const cuesId = new Uint8Array([0x1c, 0x53, 0xbb, 0x6b]);
    const cuesSize = encodeVintSize(cuePointElem.length);
    const fullBytes = concatU8([cuesId, cuesSize, cuePointElem]);
    const cuesPayloadOffset = 4 + cuesSize.length;
    const cuePointChild: EbmlElement = {
      id: 0xbb,
      size: BigInt(cuePointPayload.length),
      payloadOffset: cuesPayloadOffset + 1 + 1,
      nextOffset: cuesPayloadOffset + 1 + 1 + cuePointPayload.length,
      idWidth: 1,
      sizeWidth: 1,
    };
    expect(() => decodeCues(fullBytes, [cuePointChild], 0)).toThrow(WebmMissingElementError);
  });

  it('throws WebmMissingElementError when CueClusterPosition is absent from CueTrackPositions', () => {
    // Build a CuePoint with CueTime + CueTrackPositions containing only CueTrack (no CueClusterPosition).
    const cueTimeElem = makeElemBytes(0xb3, makeUintPayload(100));
    // CueTrackPositions has only CueTrack, no CueClusterPosition.
    const trackPosPayload = makeElemBytes(0xf7, makeUintPayload(1)); // Only CueTrack
    const trackPosElem = makeElemBytes(0xb7, trackPosPayload);
    const cuePointPayload = concatU8([cueTimeElem, trackPosElem]);
    const cuePointElem = makeElemBytes(0xbb, cuePointPayload);
    const cuesId = new Uint8Array([0x1c, 0x53, 0xbb, 0x6b]);
    const cuesSize = encodeVintSize(cuePointElem.length);
    const fullBytes = concatU8([cuesId, cuesSize, cuePointElem]);
    const cuesPayloadOffset = 4 + cuesSize.length;
    const cuePointChild: EbmlElement = {
      id: 0xbb,
      size: BigInt(cuePointPayload.length),
      payloadOffset: cuesPayloadOffset + 1 + 1,
      nextOffset: cuesPayloadOffset + 1 + 1 + cuePointPayload.length,
      idWidth: 1,
      sizeWidth: 1,
    };
    expect(() => decodeCues(fullBytes, [cuePointChild], 0)).toThrow(WebmMissingElementError);
  });
});

// ---------------------------------------------------------------------------
// Sec-M-2 regression: CueClusterPosition bounds validation
// ---------------------------------------------------------------------------

describe('decodeCues — Sec-M-2 CueClusterPosition out-of-bounds rejection', () => {
  it('throws WebmCorruptStreamError when CueClusterPosition + segmentPayloadOffset exceeds file length', () => {
    // Build a CuePoint where clusterPosition = 10000, segmentPayloadOffset = 100.
    // absolute offset = 10100, but we pass a file buffer of only 200 bytes.
    const { bytes, children } = buildCuesElement(0, 1, 10000);
    // bytes.length is small (< 200). segmentPayloadOffset = 100 → absolute = 10100 >= bytes.length.
    const smallFileBuffer = bytes; // bytes.length is the actual buffer; offset will exceed it
    expect(() => decodeCues(smallFileBuffer, children, 100)).toThrow(WebmCorruptStreamError);
  });

  it('does not throw when CueClusterPosition resolves to a valid offset within file', () => {
    // clusterPosition = 10, segmentPayloadOffset = 10 → absolute = 20
    // file buffer must be > 20 bytes. The bytes returned from buildCuesElement is large enough.
    const { bytes, children } = buildCuesElement(0, 1, 10);
    // bytes.length is the Cues element bytes, not the full file. Extend to 200 bytes.
    const extendedBuffer = new Uint8Array(200);
    extendedBuffer.set(bytes, 0);
    expect(() => decodeCues(extendedBuffer, children, 10)).not.toThrow();
  });
});

describe('encodeCues', () => {
  it('encodes Cues and the output starts with Cues ID (0x1C53BB6B)', () => {
    const cues = [{ cueTime: 0n, trackNumber: 1, clusterFileOffset: 50 }];
    const bytes = encodeCues(cues, 0);
    expect(bytes[0]).toBe(0x1c);
    expect(bytes[1]).toBe(0x53);
    expect(bytes[2]).toBe(0xbb);
    expect(bytes[3]).toBe(0x6b);
  });

  it('encodes empty cues as Cues master with no children', () => {
    const bytes = encodeCues([], 0);
    expect(bytes.length).toBeGreaterThan(4);
  });
});
