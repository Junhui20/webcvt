/**
 * Integration tests for multi-track WebM support.
 *
 * Exercises the full demux/remux pipeline (parser + block-iterator + serializer)
 * for files that carry MULTIPLE video and/or audio tracks:
 * - 2 video + 1 audio decodes to 3 tracks in declaration order
 * - SimpleBlocks route to the correct track by TrackNumber across N tracks
 * - block iterators yield only the requested track
 * - a full multi-track file round-trips via the serializer
 * - duplicate TrackNumber is rejected as a typed error
 */

import { describe, expect, it } from 'vitest';
import { iterateAudioChunks, iterateVideoChunks } from './block-iterator.ts';
import { WebmDuplicateTrackNumberError } from './errors.ts';
import { parseWebm } from './parser.ts';
import { serializeWebm } from './serializer.ts';

// ---------------------------------------------------------------------------
// Synthetic WebM builder helpers (self-contained, mirroring parser.test.ts)
// ---------------------------------------------------------------------------

function concat(arrays: Uint8Array[]): Uint8Array {
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
  if (size < 16383) return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
  return new Uint8Array([0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff]);
}

function encodeVintId(id: number): Uint8Array {
  if (id >= 0x10000000)
    return new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x200000) return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x4000) return new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([id & 0xff]);
}

function makeElement(id: number, payload: Uint8Array): Uint8Array {
  return concat([encodeVintId(id), encodeVintSize(payload.length), payload]);
}

function makeUint(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, value, false);
  return makeElement(id, payload);
}

function makeString(id: number, value: string): Uint8Array {
  return makeElement(id, new TextEncoder().encode(value));
}

function makeFloat32(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setFloat32(0, value, false);
  return makeElement(id, payload);
}

function buildEbmlHeader(): Uint8Array {
  const docTypeBytes = new TextEncoder().encode('webm');
  const payload = concat([
    new Uint8Array([0x42, 0x86, 0x81, 0x01]), // EBMLVersion = 1
    new Uint8Array([0x42, 0xf7, 0x81, 0x01]), // EBMLReadVersion = 1
    new Uint8Array([0x42, 0xf2, 0x81, 0x04]), // EBMLMaxIDLength = 4
    new Uint8Array([0x42, 0xf3, 0x81, 0x08]), // EBMLMaxSizeLength = 8
    concat([
      new Uint8Array([0x42, 0x82]),
      new Uint8Array([0x80 | docTypeBytes.length]),
      docTypeBytes,
    ]),
    new Uint8Array([0x42, 0x87, 0x81, 0x04]), // DocTypeVersion = 4
    new Uint8Array([0x42, 0x85, 0x81, 0x02]), // DocTypeReadVersion = 2
  ]);
  return concat([
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    encodeVintSize(payload.length),
    payload,
  ]);
}

function videoTrackEntry(num: number, uid: number, codecId: 'V_VP8' | 'V_VP9'): Uint8Array {
  return makeElement(
    0xae,
    concat([
      makeUint(0xd7, num),
      makeUint(0x73c5, uid),
      makeUint(0x83, 1),
      makeString(0x86, codecId),
      makeElement(0xe0, concat([makeUint(0xb0, 160), makeUint(0xba, 120)])),
    ]),
  );
}

function audioTrackEntry(num: number, uid: number): Uint8Array {
  return makeElement(
    0xae,
    concat([
      makeUint(0xd7, num),
      makeUint(0x73c5, uid),
      makeUint(0x83, 2),
      makeString(0x86, 'A_OPUS'),
      makeElement(0x63a2, new Uint8Array([0x4f, 0x70, 0x75, 0x73])),
      makeElement(0xe1, concat([makeFloat32(0xb5, 48000), makeUint(0x9f, 2)])),
    ]),
  );
}

function infoElement(): Uint8Array {
  return makeElement(
    0x1549a966,
    concat([makeUint(0x2ad7b1, 1_000_000), makeString(0x4d80, 'test'), makeString(0x5741, 'test')]),
  );
}

function segment(tracksEntries: Uint8Array[], clusterElem?: Uint8Array): Uint8Array {
  const tracksElem = makeElement(0x1654ae6b, concat(tracksEntries));
  const parts = clusterElem
    ? [infoElement(), tracksElem, clusterElem]
    : [infoElement(), tracksElem];
  const segPayload = concat(parts);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  return concat([buildEbmlHeader(), segId, encodeVintSize(segPayload.length), segPayload]);
}

/** Cluster with one unlaced SimpleBlock per track; each frame is a distinct byte. */
function clusterWithBlocks(
  specs: { track: number; data: number; keyframe: boolean }[],
): Uint8Array {
  const blocks = specs.map((s) =>
    makeElement(
      0xa3,
      new Uint8Array([0x80 | s.track, 0x00, 0x00, s.keyframe ? 0x80 : 0x00, s.data]),
    ),
  );
  return makeElement(0x1f43b675, concat([makeUint(0xe7, 0), ...blocks]));
}

/** Build a WebM with 2 video (VP8/VP9) + 1 audio (Opus) track and one block per track. */
function buildThreeTrackWebm(): Uint8Array {
  return segment(
    [videoTrackEntry(1, 1, 'V_VP8'), videoTrackEntry(2, 2, 'V_VP9'), audioTrackEntry(3, 3)],
    clusterWithBlocks([
      { track: 1, data: 0x11, keyframe: true },
      { track: 2, data: 0x22, keyframe: true },
      { track: 3, data: 0x33, keyframe: false },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('multi-track WebM — parse', () => {
  it('decodes 2 video + 1 audio into 3 tracks in declaration order', () => {
    const file = parseWebm(buildThreeTrackWebm());
    expect(file.tracks).toHaveLength(3);
    expect(file.tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3]);
    expect(file.tracks.map((t) => t.trackType)).toEqual([1, 1, 2]);
    expect(file.tracks.map((t) => t.codecId)).toEqual(['V_VP8', 'V_VP9', 'A_OPUS']);
  });

  it('rejects two tracks sharing a TrackNumber with WebmDuplicateTrackNumberError', () => {
    const dup = segment([videoTrackEntry(1, 1, 'V_VP8'), audioTrackEntry(1, 2)]);
    expect(() => parseWebm(dup)).toThrow(WebmDuplicateTrackNumberError);
  });
});

describe('multi-track WebM — block routing', () => {
  it('routes SimpleBlocks to the correct track by TrackNumber across 3 tracks', () => {
    const file = parseWebm(buildThreeTrackWebm());
    const blocks = file.clusters.flatMap((c) => c.blocks);

    const byTrack = (n: number) => blocks.filter((b) => b.trackNumber === n);
    expect(byTrack(1)).toHaveLength(1);
    expect(byTrack(2)).toHaveLength(1);
    expect(byTrack(3)).toHaveLength(1);

    expect(byTrack(1)[0]?.frames[0]).toEqual(new Uint8Array([0x11]));
    expect(byTrack(2)[0]?.frames[0]).toEqual(new Uint8Array([0x22]));
    expect(byTrack(3)[0]?.frames[0]).toEqual(new Uint8Array([0x33]));
  });

  it('block iterators yield only the requested track number', () => {
    const file = parseWebm(buildThreeTrackWebm());

    const v1 = [...iterateVideoChunks(file, 1)];
    const v2 = [...iterateVideoChunks(file, 2)];
    const a3 = [...iterateAudioChunks(file, 3)];

    expect(v1).toHaveLength(1);
    expect(v1[0]?.data).toEqual(new Uint8Array([0x11]));
    expect(v2).toHaveLength(1);
    expect(v2[0]?.data).toEqual(new Uint8Array([0x22]));
    expect(a3).toHaveLength(1);
    expect(a3[0]?.data).toEqual(new Uint8Array([0x33]));

    // A track number that does not exist yields nothing.
    expect([...iterateVideoChunks(file, 99)]).toHaveLength(0);
    expect([...iterateAudioChunks(file, 99)]).toHaveLength(0);
  });
});

describe('multi-track WebM — serializer round-trip', () => {
  it('round-trips 2 video + 1 audio preserving tracks and routing', () => {
    const parsed = parseWebm(buildThreeTrackWebm());
    const reparsed = parseWebm(serializeWebm(parsed));

    expect(reparsed.tracks).toHaveLength(3);
    expect(reparsed.tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3]);
    expect(reparsed.tracks.map((t) => t.trackType)).toEqual([1, 1, 2]);
    expect(reparsed.tracks.map((t) => t.codecId)).toEqual(['V_VP8', 'V_VP9', 'A_OPUS']);

    const blocks = reparsed.clusters.flatMap((c) => c.blocks);
    expect(blocks.find((b) => b.trackNumber === 1)?.frames[0]).toEqual(new Uint8Array([0x11]));
    expect(blocks.find((b) => b.trackNumber === 2)?.frames[0]).toEqual(new Uint8Array([0x22]));
    expect(blocks.find((b) => b.trackNumber === 3)?.frames[0]).toEqual(new Uint8Array([0x33]));
  });
});
