/**
 * Tests for cluster decode/encode (elements/cluster.ts).
 *
 * Covers:
 * - Cluster timecode parsing
 * - Unlaced SimpleBlock decode
 * - Xiph-laced SimpleBlock decode
 * - Absolute timestamp computation
 * - Missing timecode error
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import { MAX_BLOCKS_PER_TRACK } from '../constants.ts';
import {
  WebmCorruptStreamError,
  WebmLacingNotSupportedError,
  WebmMissingTimecodeError,
  WebmTooManyBlocksError,
} from '../errors.ts';
import { decodeCluster, encodeCluster } from './cluster.ts';

// Helper to build raw cluster bytes.
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

function makeElem(id: number, payload: Uint8Array): Uint8Array {
  // Only handle 1-4 byte IDs.
  let idBytes: Uint8Array;
  if (id >= 0x10000000) {
    idBytes = new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  } else if (id >= 0x200000) {
    idBytes = new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  } else if (id >= 0x4000) {
    idBytes = new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  } else if (id >= 0x80) {
    idBytes = new Uint8Array([id & 0xff]);
  } else {
    idBytes = new Uint8Array([id]);
  }
  return concatU8([idBytes, encodeVintSize(payload.length), payload]);
}

function makeUint32Elem(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, value, false);
  return makeElem(id, payload);
}

function buildClusterBytes(options: {
  timecode?: number;
  simpleBlocks?: Uint8Array[];
  omitTimecode?: boolean;
}): { bytes: Uint8Array; elem: EbmlElement } {
  const { timecode = 0, simpleBlocks = [], omitTimecode = false } = options;

  const parts: Uint8Array[] = [];
  if (!omitTimecode) {
    parts.push(makeUint32Elem(0xe7, timecode));
  }
  for (const sb of simpleBlocks) {
    parts.push(makeElem(0xa3, sb));
  }

  const clusterPayload = concatU8(parts);

  // Wrap in Cluster element (ID 0x1F43B675).
  const clusterId = new Uint8Array([0x1f, 0x43, 0xb6, 0x75]);
  const clusterSize = encodeVintSize(clusterPayload.length);

  const fullBytes = concatU8([clusterId, clusterSize, clusterPayload]);

  // The EbmlElement for the cluster points into fullBytes.
  const idWidth = 4;
  const sizeWidth = clusterSize.length;

  const elem: EbmlElement = {
    id: 0x1f43b675,
    size: BigInt(clusterPayload.length),
    payloadOffset: idWidth + sizeWidth,
    nextOffset: idWidth + sizeWidth + clusterPayload.length,
    idWidth,
    sizeWidth,
  };

  return { bytes: fullBytes, elem };
}

describe('decodeCluster', () => {
  it('decodes cluster timecode', () => {
    const { bytes, elem } = buildClusterBytes({ timecode: 1000 });
    const blockCounts = new Map<number, number>();
    const cluster = decodeCluster(bytes, elem, 1_000_000, blockCounts);
    expect(cluster.timecode).toBe(1000n);
  });

  it('throws WebmMissingTimecodeError when Timecode is absent', () => {
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa]);
    const { bytes, elem } = buildClusterBytes({ omitTimecode: true, simpleBlocks: [sb] });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      WebmMissingTimecodeError,
    );
  });

  it('throws WebmMissingTimecodeError when cluster has no timecode even with no blocks', () => {
    const { bytes, elem } = buildClusterBytes({ omitTimecode: true });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      WebmMissingTimecodeError,
    );
  });

  it('decodes unlaced SimpleBlock (lacing == 00)', () => {
    // track=1, delta=0, flags=0x80 (keyframe, no lacing), data=0xAB
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xab]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks).toHaveLength(1);
    const block = cluster.blocks[0];
    expect(block?.trackNumber).toBe(1);
    expect(block?.keyframe).toBe(true);
    expect(block?.frames).toHaveLength(1);
    expect(block?.frames[0]).toEqual(new Uint8Array([0xab]));
  });

  it('computes absolute timestamp correctly', () => {
    // Cluster.timecode = 100, delta = 10, timecodeScale = 1_000_000
    // timestampNs = (100 + 10) * 1_000_000 = 110_000_000
    const deltaBytes = new Uint8Array(2);
    new DataView(deltaBytes.buffer).setInt16(0, 10, false);
    const sb = new Uint8Array([0x81, ...deltaBytes, 0x80, 0xbb]);
    const { bytes, elem } = buildClusterBytes({ timecode: 100, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.timestampNs).toBe(110_000_000n);
  });

  it('computes negative delta correctly (Trap §5)', () => {
    // delta = -5
    const deltaBytes = new Uint8Array(2);
    new DataView(deltaBytes.buffer).setInt16(0, -5, false);
    const sb = new Uint8Array([0x81, ...deltaBytes, 0x80, 0xcc]);
    const { bytes, elem } = buildClusterBytes({ timecode: 100, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    // (100 + (-5)) * 1_000_000 = 95_000_000
    expect(cluster.blocks[0]?.timestampNs).toBe(95_000_000n);
  });

  it('rejects fixed-size lacing (lacing == 10) with WebmLacingNotSupportedError', () => {
    // flags = keyframe(1) | lacing(10 in bits 2:1) = 0x80 | 0x04 = 0x84
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x80 | (0b10 << 1), 0x01, 0xaa, 0xbb]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      WebmLacingNotSupportedError,
    );
  });

  it('rejects EBML lacing (lacing == 11) with WebmLacingNotSupportedError', () => {
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x80 | (0b11 << 1), 0x01, 0xaa, 0xbb]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      WebmLacingNotSupportedError,
    );
  });

  it('decodes Xiph-laced SimpleBlock with 3 frames', () => {
    // Xiph lacing: lace_count_minus_one=2 (3 frames)
    // frame sizes: 2, 2, remaining(1)
    // flags = keyframe | Xiph lacing (01) → 0x80 | 0x02 = 0x82
    const sb = new Uint8Array([
      0x81, // track 1
      0x00,
      0x00, // delta
      0x82, // flags: keyframe + Xiph lacing
      0x02, // lace_count_minus_one = 2
      0x02, // frame0 size = 2
      0x02, // frame1 size = 2
      0xaa,
      0xbb, // frame0
      0xcc,
      0xdd, // frame1
      0xee, // frame2
    ]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    const block = cluster.blocks[0];
    expect(block?.frames).toHaveLength(3);
    expect(block?.frames[0]).toEqual(new Uint8Array([0xaa, 0xbb]));
    expect(block?.frames[1]).toEqual(new Uint8Array([0xcc, 0xdd]));
    expect(block?.frames[2]).toEqual(new Uint8Array([0xee]));
  });

  it('decodes invisible flag', () => {
    // flags = 0x08 (invisible bit)
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x08, 0xaa]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.invisible).toBe(true);
  });

  it('decodes discardable flag', () => {
    // flags = 0x01 (discardable bit)
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x01, 0xaa]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.discardable).toBe(true);
  });

  it('throws WebmTooManyBlocksError when per-track block count exceeds MAX_BLOCKS_PER_TRACK', () => {
    // Set block count just at the limit.
    const sb = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xab]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    const blockCounts = new Map<number, number>([[1, MAX_BLOCKS_PER_TRACK]]);
    expect(() => decodeCluster(bytes, elem, 1_000_000, blockCounts)).toThrow(
      WebmTooManyBlocksError,
    );
  });

  it('stops parsing cluster when element has unknown size (sizeVint=-1 break)', () => {
    // Build cluster with a manual unknown-size element (all-ones size VINT = 0xFF) before timecode.
    // 0xFF is a 1-byte unknown-size VINT.
    // Cluster: timecodeElem then a junk element with unknown size (0xFF).
    const timecodePayload = new Uint8Array(4);
    new DataView(timecodePayload.buffer).setUint32(0, 0, false);
    const timecodeElem = makeUint32Elem(0xe7, 0);

    // Element with unknown-size: ID=0xA3 (SimpleBlock), size=0xFF (unknown-size 1-byte VINT).
    const unknownSizeElem = new Uint8Array([0xa3, 0xff]);

    const clusterPayload = concatU8([timecodeElem, unknownSizeElem]);
    const clusterId = new Uint8Array([0x1f, 0x43, 0xb6, 0x75]);
    const clusterSizeBytes = encodeVintSize(clusterPayload.length);
    const fullBytes = concatU8([clusterId, clusterSizeBytes, clusterPayload]);

    const elem: EbmlElement = {
      id: 0x1f43b675,
      size: BigInt(clusterPayload.length),
      payloadOffset: 4 + clusterSizeBytes.length,
      nextOffset: 4 + clusterSizeBytes.length + clusterPayload.length,
      idWidth: 4,
      sizeWidth: clusterSizeBytes.length,
    };

    // Should parse without throwing — the unknown-size element breaks the loop but timecode is found.
    const cluster = decodeCluster(fullBytes, elem, 1_000_000, new Map());
    expect(cluster.timecode).toBe(0n);
    expect(cluster.blocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sec-H-3 regression: decodeXiphLacing must throw on malformed lace tables
// ---------------------------------------------------------------------------

describe('decodeCluster — Sec-H-3 Xiph lacing malformed table rejection', () => {
  it('throws WebmCorruptStreamError when lace size table runs out before closing (payload too short)', () => {
    // Xiph lacing with lace_count_minus_one = 3 (4 frames) but payload only has
    // 5 bytes after flags, which runs out before the 3-entry size table closes.
    //
    // Layout: track(1) | delta(2) | flags(1) | lace_count_minus_one(1) | size_table...
    // flags = 0x82 = keyframe + Xiph lacing (01)
    // lace_count_minus_one = 3 → need 3 size entries
    // We provide only 2 bytes of size table (both 0x04), then the payload ends.
    // The 3rd size entry cannot be read → throws.
    const sb = new Uint8Array([
      0x81, // track 1
      0x00,
      0x00, // delta = 0
      0x82, // flags: keyframe + Xiph lacing
      0x03, // lace_count_minus_one = 3 (4 frames)
      0x04, // frame0 size = 4
      0x04, // frame1 size = 4
      // frame2 size entry is missing — payload ends here
      // so we add some payload data but NOT enough for a 3rd size byte to terminate
      // Actually with only these bytes, cursor >= payloadEnd during 3rd iteration → throws
    ]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(WebmCorruptStreamError);
  });

  it('throws WebmCorruptStreamError when lace sizes sum exceeds remaining payload', () => {
    // Xiph lacing with lace_count_minus_one = 1 (2 frames)
    // Declare frame0 size = 200, but total payload after size table is only ~5 bytes.
    // lastFrameSize = payloadEnd - cursor - 200 < 0 → throws.
    //
    // SimpleBlock payload: track(1) | delta(2) | flags(1) | count(1) | size(1=200 requires 255 chain)
    // For size 200: first byte < 255 terminates → single byte 200 = 0xC8.
    // But wait: Xiph size encoding: size = sum of bytes until non-255 byte.
    // For size 200: just one byte 0xC8 (no 255 prefix needed since 200 < 255).
    // Payload after flags byte: count=0x01 | size_byte=0xC8 | then 3 actual data bytes
    // → frame0 wants 200 bytes but only 3 remain → lastFrameSize = 3 - 200 < 0 → throw.
    const sb = new Uint8Array([
      0x81, // track 1
      0x00,
      0x00, // delta = 0
      0x82, // flags: keyframe + Xiph lacing (01)
      0x01, // lace_count_minus_one = 1 (2 frames)
      0xc8, // frame0 size = 200 (0xC8 < 255 → terminates)
      // Only 3 bytes of actual data follow — far less than 200
      0xaa,
      0xbb,
      0xcc,
    ]);
    const { bytes, elem } = buildClusterBytes({ timecode: 0, simpleBlocks: [sb] });
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(WebmCorruptStreamError);
  });
});

describe('encodeCluster', () => {
  it('encodes a cluster and it starts with Cluster ID', () => {
    const cluster = {
      fileOffset: 0,
      timecode: 0n,
      blocks: [],
    };
    const bytes = encodeCluster(cluster, 1_000_000);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x43);
    expect(bytes[2]).toBe(0xb6);
    expect(bytes[3]).toBe(0x75);
  });

  it('encodes a cluster with one SimpleBlock', () => {
    const cluster = {
      fileOffset: 0,
      timecode: 0n,
      blocks: [
        {
          trackNumber: 1,
          timestampNs: 0n,
          keyframe: true,
          invisible: false,
          discardable: false,
          frames: [new Uint8Array([0xab, 0xcd])],
        },
      ],
    };
    const bytes = encodeCluster(cluster, 1_000_000);
    expect(bytes.length).toBeGreaterThan(10);
  });
});
