/**
 * Tests for Cluster/SimpleBlock decode/encode (cluster.ts).
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { concatBytes, writeUint, writeVintId, writeVintSize } from '@catlabtech/webcvt-ebml';
import { EbmlElementTooLargeError, EbmlTooManyElementsError } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import {
  ID_CLUSTER,
  ID_SIMPLE_BLOCK,
  ID_TIMECODE,
  ID_VOID,
  MAX_ELEMENTS_PER_FILE,
  MAX_ELEMENT_PAYLOAD_BYTES,
} from '../constants.ts';
import {
  MkvCorruptStreamError,
  MkvLacingNotSupportedError,
  MkvMissingTimecodeError,
  MkvTooManyBlocksError,
} from '../errors.ts';
import { type MkvSimpleBlock, decodeCluster, encodeCluster } from './cluster.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUintElem(id: number, value: bigint): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeUint(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

/**
 * Build a raw SimpleBlock payload:
 *   trackVint (1 or 2 bytes) + 2-byte signed BE int16 + 1-byte flags + frame data
 */
function buildSimpleBlockPayload(
  trackNumber: number,
  timecodeDelta: number,
  flags: number,
  frameData: Uint8Array,
): Uint8Array {
  const trackVint =
    trackNumber <= 127
      ? writeVintSize(BigInt(trackNumber), 1)
      : writeVintSize(BigInt(trackNumber), 2);

  const deltaBytes = new Uint8Array(2);
  new DataView(deltaBytes.buffer).setInt16(0, timecodeDelta, false);

  return concatBytes([trackVint, deltaBytes, new Uint8Array([flags]), frameData]);
}

function makeSimpleBlockElem(
  trackNumber: number,
  timecodeDelta: number,
  flags: number,
  frameData: Uint8Array,
): Uint8Array {
  const payload = buildSimpleBlockPayload(trackNumber, timecodeDelta, flags, frameData);
  const idBytes = writeVintId(ID_SIMPLE_BLOCK);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

function buildClusterElement(
  timecode: bigint,
  simpleBlocks: Uint8Array[],
): { bytes: Uint8Array; elem: EbmlElement } {
  const children = concatBytes([makeUintElem(ID_TIMECODE, timecode), ...simpleBlocks]);

  const idBytes = writeVintId(ID_CLUSTER);
  const sizeBytes = writeVintSize(BigInt(children.length));
  const bytes = concatBytes([idBytes, sizeBytes, children]);

  const idWidth = 4; // 0x1F43B675 = 4-byte VINT
  const sizeWidth = sizeBytes.length;
  const elem: EbmlElement = {
    id: ID_CLUSTER,
    size: BigInt(children.length),
    payloadOffset: idWidth + sizeWidth,
    nextOffset: bytes.length,
    idWidth,
    sizeWidth,
  };

  return { bytes, elem };
}

// ---------------------------------------------------------------------------
// decodeCluster tests
// ---------------------------------------------------------------------------

describe('decodeCluster', () => {
  it('decodes a cluster with timecode and one unlaced block', () => {
    const frameData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const block = makeSimpleBlockElem(1, 0, 0x80, frameData); // keyframe, no lacing
    const { bytes, elem } = buildClusterElement(100n, [block]);

    const blockCounts = new Map<number, number>();
    const cluster = decodeCluster(bytes, elem, 1_000_000, blockCounts);

    expect(cluster.timecode).toBe(100n);
    expect(cluster.blocks).toHaveLength(1);
    expect(cluster.blocks[0]?.trackNumber).toBe(1);
    expect(cluster.blocks[0]?.keyframe).toBe(true);
    expect(cluster.blocks[0]?.frames[0]).toEqual(frameData);
  });

  it('computes absolute timestamp correctly', () => {
    // Cluster timecode=100, delta=50, timecodeScale=1_000_000 → ts = 150 * 1_000_000 = 150_000_000n
    const block = makeSimpleBlockElem(1, 50, 0x80, new Uint8Array([0x01]));
    const { bytes, elem } = buildClusterElement(100n, [block]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.timestampNs).toBe(150_000_000n);
  });

  it('handles negative timecode delta', () => {
    // delta=-10: cluster=100, result=90 → 90_000_000n
    const block = makeSimpleBlockElem(1, -10, 0x00, new Uint8Array([0x01]));
    const { bytes, elem } = buildClusterElement(100n, [block]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.timestampNs).toBe(90_000_000n);
  });

  it('decodes invisible and discardable flags', () => {
    // flags: invisible=0x08, discardable=0x01
    const block = makeSimpleBlockElem(1, 0, 0x09, new Uint8Array([0x01]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.invisible).toBe(true);
    expect(cluster.blocks[0]?.discardable).toBe(true);
    expect(cluster.blocks[0]?.keyframe).toBe(false);
  });

  it('decodes multiple blocks in one cluster', () => {
    const b1 = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const b2 = makeSimpleBlockElem(2, 0, 0x80, new Uint8Array([0x02]));
    const { bytes, elem } = buildClusterElement(0n, [b1, b2]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks).toHaveLength(2);
    expect(cluster.blocks[0]?.trackNumber).toBe(1);
    expect(cluster.blocks[1]?.trackNumber).toBe(2);
  });

  it('decodes track number > 127 using 2-byte VINT (Trap §24)', () => {
    const block = makeSimpleBlockElem(130, 0, 0x80, new Uint8Array([0xaa]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.trackNumber).toBe(130);
  });

  it('throws MkvMissingTimecodeError when Timecode element is absent', () => {
    // Build a cluster without a Timecode element
    const block = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const blockPayload = block;

    const idBytes = writeVintId(ID_CLUSTER);
    const sizeBytes = writeVintSize(BigInt(blockPayload.length));
    const bytes = concatBytes([idBytes, sizeBytes, blockPayload]);

    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(blockPayload.length),
      payloadOffset: idBytes.length + sizeBytes.length,
      nextOffset: bytes.length,
      idWidth: idBytes.length,
      sizeWidth: sizeBytes.length,
    };

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(MkvMissingTimecodeError);
  });

  it('throws MkvMissingTimecodeError when SimpleBlock appears before Timecode', () => {
    // Block first, timecode second
    const block = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const timecodeElem = makeUintElem(ID_TIMECODE, 100n);
    const payload = concatBytes([block, timecodeElem]);

    const idBytes = writeVintId(ID_CLUSTER);
    const sizeBytes = writeVintSize(BigInt(payload.length));
    const bytes = concatBytes([idBytes, sizeBytes, payload]);

    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(payload.length),
      payloadOffset: idBytes.length + sizeBytes.length,
      nextOffset: bytes.length,
      idWidth: idBytes.length,
      sizeWidth: sizeBytes.length,
    };

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(MkvMissingTimecodeError);
  });

  it('throws MkvLacingNotSupportedError for fixed-size lacing (mode 10)', () => {
    // lacing bits 10 → flags = 0x04 (bits 2:1 = 10)
    const block = makeSimpleBlockElem(1, 0, 0x04, new Uint8Array([0x01, 0x02]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      MkvLacingNotSupportedError,
    );
  });

  it('throws MkvLacingNotSupportedError for EBML lacing (mode 11)', () => {
    // lacing bits 11 → flags = 0x06
    const block = makeSimpleBlockElem(1, 0, 0x06, new Uint8Array([0x01, 0x02]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(
      MkvLacingNotSupportedError,
    );
  });

  it('decodes Xiph-laced block with 2 frames', () => {
    // Xiph lacing: flags bits[2:1] = 01 → flags = 0x82 (keyframe + xiph)
    // Payload: laceCount-1=1 (2 frames), frame0Size=3, frame0=[aa,bb,cc], frame1=[dd,ee]
    const frame0 = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const frame1 = new Uint8Array([0xdd, 0xee]);
    // Xiph lace header: 1 byte for count (N-1=1), then N-1 size bytes
    const xiphPayload = new Uint8Array([1, 3, ...frame0, ...frame1]);

    const trackVint = writeVintSize(1n, 1);
    const deltaBytes = new Uint8Array([0x00, 0x00]);
    const flagsByte = new Uint8Array([0x82]); // keyframe | xiph lacing
    const fullPayload = concatBytes([trackVint, deltaBytes, flagsByte, xiphPayload]);

    const idBytes = writeVintId(ID_SIMPLE_BLOCK);
    const sizeBytes = writeVintSize(BigInt(fullPayload.length));
    const blockElem = concatBytes([idBytes, sizeBytes, fullPayload]);

    const { bytes, elem } = buildClusterElement(0n, [blockElem]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    expect(cluster.blocks[0]?.frames).toHaveLength(2);
    expect(cluster.blocks[0]?.frames[0]).toEqual(frame0);
    expect(cluster.blocks[0]?.frames[1]).toEqual(frame1);
  });

  it('throws MkvCorruptStreamError for malformed Xiph lace (sizes exceed payload)', () => {
    // Xiph lace with claimed frame size larger than actual data
    const trackVint = writeVintSize(1n, 1);
    const deltaBytes = new Uint8Array([0x00, 0x00]);
    const flagsByte = new Uint8Array([0x82]); // keyframe + xiph
    // laceCount-1=1, frame0Size=100 (but no data follows)
    const xiphPayload = new Uint8Array([1, 100]);
    const fullPayload = concatBytes([trackVint, deltaBytes, flagsByte, xiphPayload]);

    const idBytes = writeVintId(ID_SIMPLE_BLOCK);
    const sizeBytes = writeVintSize(BigInt(fullPayload.length));
    const blockElem = concatBytes([idBytes, sizeBytes, fullPayload]);

    const { bytes, elem } = buildClusterElement(0n, [blockElem]);

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map())).toThrow(MkvCorruptStreamError);
  });

  it('throws MkvTooManyBlocksError when block count exceeds per-track cap', () => {
    // Pre-fill blockCounts with MAX_BLOCKS_PER_TRACK for track 1
    const MAX_BLOCKS_PER_TRACK_VALUE = 10_000_000;
    const block = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    const blockCounts = new Map([[1, MAX_BLOCKS_PER_TRACK_VALUE]]);
    expect(() => decodeCluster(bytes, elem, 1_000_000, blockCounts)).toThrow(MkvTooManyBlocksError);
  });

  it('sets fileOffset to start of Cluster element', () => {
    const block = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const { bytes, elem } = buildClusterElement(0n, [block]);

    const cluster = decodeCluster(bytes, elem, 1_000_000, new Map());
    // fileOffset = payloadOffset - idWidth - sizeWidth
    expect(cluster.fileOffset).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Sec-H-1: element count cap is enforced inside Cluster's inner loop
  // ---------------------------------------------------------------------------

  it('Sec-H-1: throws EbmlTooManyElementsError when inner-Cluster element count exceeds cap', () => {
    // Build ~110,000 minimal Void elements (ID=0xEC, size=0x80 → 0 payload bytes).
    // Each Void element is 2 bytes: [0xEC][0x80].
    // 110,000 * 2 = 220,000 bytes of Cluster payload.
    const VOID_ELEM_COUNT = 110_000;
    const voidByte = new Uint8Array([0xec, 0x80]); // ID_VOID=0xEC, size=0 (1-byte VINT 0x80=0)
    const voidPayload = new Uint8Array(VOID_ELEM_COUNT * 2);
    for (let i = 0; i < VOID_ELEM_COUNT; i++) {
      voidPayload[i * 2] = 0xec;
      voidPayload[i * 2 + 1] = 0x80;
    }

    // Prepend the Timecode element so the cluster is otherwise valid.
    const timecodeElem = makeUintElem(ID_TIMECODE, 0n);
    const payload = concatBytes([timecodeElem, voidPayload]);

    const idBytes = writeVintId(ID_CLUSTER);
    const sizeBytes = writeVintSize(BigInt(payload.length));
    const bytes = concatBytes([idBytes, sizeBytes, payload]);

    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(payload.length),
      payloadOffset: idBytes.length + sizeBytes.length,
      nextOffset: bytes.length,
      idWidth: idBytes.length,
      sizeWidth: sizeBytes.length,
    };

    // elementCount already at MAX_ELEMENTS_PER_FILE - 1 so first inner element tips it over.
    const elementCount = { value: MAX_ELEMENTS_PER_FILE - 1 };
    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map(), elementCount)).toThrow(
      EbmlTooManyElementsError,
    );
  });

  it('Sec-H-1: elementCount accumulates across cluster inner loop', () => {
    // 5 elements: Timecode + 4 blocks. With initial count=0, final count should be 5.
    const b1 = makeSimpleBlockElem(1, 0, 0x80, new Uint8Array([0x01]));
    const b2 = makeSimpleBlockElem(1, 1, 0x80, new Uint8Array([0x02]));
    const b3 = makeSimpleBlockElem(1, 2, 0x80, new Uint8Array([0x03]));
    const b4 = makeSimpleBlockElem(1, 3, 0x80, new Uint8Array([0x04]));
    const { bytes, elem } = buildClusterElement(0n, [b1, b2, b3, b4]);

    const elementCount = { value: 0 };
    decodeCluster(bytes, elem, 1_000_000, new Map(), elementCount);
    // 1 Timecode + 4 SimpleBlock elements = 5
    expect(elementCount.value).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // Sec-M-1: per-SimpleBlock element size cap inside Cluster
  // ---------------------------------------------------------------------------

  it('Sec-M-1: throws EbmlElementTooLargeError when SimpleBlock claims size > MAX_ELEMENT_PAYLOAD_BYTES', () => {
    // Construct a fake SimpleBlock element whose declared size is MAX_ELEMENT_PAYLOAD_BYTES + 1,
    // but the cluster nextOffset is set high enough that the bounds check passes.
    // We craft bytes manually: ID_CLUSTER wrapper with one Timecode + one oversized SimpleBlock header.
    const oversizePayloadLen = MAX_ELEMENT_PAYLOAD_BYTES + 1;

    const timecodeElem = makeUintElem(ID_TIMECODE, 0n);

    // SimpleBlock header only (no actual payload — we just need the header to be parseable).
    const sbIdBytes = writeVintId(ID_SIMPLE_BLOCK);
    // Use a 4-byte size VINT (0x10_00_00_00 format) for large size.
    const sbSizeBytes = new Uint8Array(4);
    const bigSize = oversizePayloadLen;
    // 4-byte VINT: leading nibble 0x10 | top 3 bits of size, then 3 more bytes.
    sbSizeBytes[0] = 0x10 | ((bigSize >> 24) & 0x0f);
    sbSizeBytes[1] = (bigSize >> 16) & 0xff;
    sbSizeBytes[2] = (bigSize >> 8) & 0xff;
    sbSizeBytes[3] = bigSize & 0xff;

    const clusterPayload = concatBytes([timecodeElem, sbIdBytes, sbSizeBytes]);

    const idBytes = writeVintId(ID_CLUSTER);
    // Make the cluster large enough that the size-claimed nextOffset is within bounds.
    const clusterSize = clusterPayload.length + oversizePayloadLen;
    const sizeBytes = writeVintSize(BigInt(clusterSize));
    const bytes = new Uint8Array(idBytes.length + sizeBytes.length + clusterSize);
    bytes.set(idBytes, 0);
    bytes.set(sizeBytes, idBytes.length);
    bytes.set(clusterPayload, idBytes.length + sizeBytes.length);

    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(clusterSize),
      payloadOffset: idBytes.length + sizeBytes.length,
      nextOffset: bytes.length,
      idWidth: idBytes.length,
      sizeWidth: sizeBytes.length,
    };

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map(), { value: 0 })).toThrow(
      EbmlElementTooLargeError,
    );
  });

  // ---------------------------------------------------------------------------
  // Sec-M-3: Xiph per-frame size cap
  // ---------------------------------------------------------------------------

  it('Sec-M-3: throws MkvCorruptStreamError when Xiph per-frame accumulated size exceeds cap', () => {
    // Xiph lacing size is encoded as bytes until non-255 terminator.
    // To reach ~16MB+1 we'd need many 0xFF bytes; instead simulate by patching:
    // We write 0xFF bytes to accumulate size past MAX_BLOCK_PAYLOAD_BYTES (16MB).
    // 16MB / 255 ≈ 65,793 bytes of 0xFF needed. Instead, we build a minimal Xiph payload
    // where the size field is large enough that after accumulation it exceeds the cap.
    // Use a more compact approach: fill with 255s for 66,000 iterations.
    // Since we don't want a 66KB test buffer, we instead use the max+1 value by building
    // a synthetic SimpleBlock payload with the Xiph size table that overflows the cap.

    // Build: trackVint(1 byte) + delta(2 bytes) + flags(1 byte, Xiph=0x82)
    //        + laceCount-1=1 (2 frames), then 0xFF*N + terminator to exceed 16MB
    // Since MAX_BLOCK_PAYLOAD_BYTES = 16*1024*1024, we need sum > 16777216.
    // 16777216 / 255 = 65,773 full 0xFF bytes, then one more non-255 to terminate.
    // That's ~65KB which is acceptable for a unit test.
    const BYTE_255_COUNT = Math.ceil((16 * 1024 * 1024) / 255) + 1;
    const trackVint = writeVintSize(1n, 1);
    const deltaBytes = new Uint8Array([0x00, 0x00]);
    const flagsByte = new Uint8Array([0x82]); // keyframe | Xiph lacing

    // Xiph: laceCount-1 = 1 (2 frames)
    const laceCountByte = new Uint8Array([0x01]);
    // Frame 0 size: all 0xFF bytes to accumulate way past the cap, then terminator 0x00
    const xiphSizePart = new Uint8Array(BYTE_255_COUNT + 1);
    xiphSizePart.fill(0xff, 0, BYTE_255_COUNT);
    xiphSizePart[BYTE_255_COUNT] = 0x00; // terminator

    const fullPayload = concatBytes([
      trackVint,
      deltaBytes,
      flagsByte,
      laceCountByte,
      xiphSizePart,
    ]);

    const sbIdBytes = writeVintId(ID_SIMPLE_BLOCK);
    const sbSizeBytes = writeVintSize(BigInt(fullPayload.length));
    const blockElem = concatBytes([sbIdBytes, sbSizeBytes, fullPayload]);

    const { bytes, elem } = buildClusterElement(0n, [blockElem]);

    expect(() => decodeCluster(bytes, elem, 1_000_000, new Map(), { value: 0 })).toThrow(
      MkvCorruptStreamError,
    );
  });
});

// ---------------------------------------------------------------------------
// encodeCluster tests
// ---------------------------------------------------------------------------

describe('encodeCluster', () => {
  it('encodes a cluster with timecode and one block', () => {
    const block: MkvSimpleBlock = {
      trackNumber: 1,
      timestampNs: 100_000_000n,
      keyframe: true,
      invisible: false,
      discardable: false,
      frames: [new Uint8Array([0xde, 0xad])],
    };
    const cluster = { fileOffset: 0, timecode: 100n, blocks: [block] };
    const encoded = encodeCluster(cluster, 1_000_000);
    expect(encoded).toBeInstanceOf(Uint8Array);
    // First 4 bytes = ID_CLUSTER 0x1F43B675
    expect(encoded[0]).toBe(0x1f);
    expect(encoded[1]).toBe(0x43);
    expect(encoded[2]).toBe(0xb6);
    expect(encoded[3]).toBe(0x75);
  });

  it('round-trip: encode → decode produces equivalent cluster', () => {
    const block: MkvSimpleBlock = {
      trackNumber: 1,
      timestampNs: 200_000_000n,
      keyframe: true,
      invisible: false,
      discardable: false,
      frames: [new Uint8Array([0x01, 0x02, 0x03])],
    };
    const originalCluster = { fileOffset: 0, timecode: 200n, blocks: [block] };
    const encoded = encodeCluster(originalCluster, 1_000_000);

    // Re-decode from the encoded bytes
    const idWidth = 4;
    const sizeOff = idWidth;
    let sizeWidth = 1;
    const sizeByte = encoded[sizeOff] as number;
    let size = 0;
    if ((sizeByte & 0x80) !== 0) {
      size = sizeByte & 0x7f;
    } else if ((sizeByte & 0x40) !== 0) {
      size = ((sizeByte & 0x3f) << 8) | (encoded[sizeOff + 1] as number);
      sizeWidth = 2;
    }

    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(size),
      payloadOffset: idWidth + sizeWidth,
      nextOffset: encoded.length,
      idWidth,
      sizeWidth,
    };

    const decoded = decodeCluster(encoded, elem, 1_000_000, new Map());
    expect(decoded.timecode).toBe(200n);
    expect(decoded.blocks).toHaveLength(1);
    expect(decoded.blocks[0]?.trackNumber).toBe(1);
    expect(decoded.blocks[0]?.timestampNs).toBe(200_000_000n);
    expect(decoded.blocks[0]?.frames[0]).toEqual(block.frames[0]);
  });

  it('encodes laced block frames as separate unlaced SimpleBlocks', () => {
    // A block with 2 frames (Xiph-laced input) should be emitted as 2 unlaced blocks
    const block: MkvSimpleBlock = {
      trackNumber: 1,
      timestampNs: 0n,
      keyframe: true,
      invisible: false,
      discardable: false,
      frames: [new Uint8Array([0xaa]), new Uint8Array([0xbb])],
    };
    const cluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const encoded = encodeCluster(cluster, 1_000_000);

    // Re-decode
    const idWidth = 4;
    let sizeWidth = 1;
    const sizeOff = idWidth;
    const sizeByte = encoded[sizeOff] as number;
    let size = 0;
    if ((sizeByte & 0x80) !== 0) {
      size = sizeByte & 0x7f;
    } else if ((sizeByte & 0x40) !== 0) {
      size = ((sizeByte & 0x3f) << 8) | (encoded[sizeOff + 1] as number);
      sizeWidth = 2;
    }
    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(size),
      payloadOffset: idWidth + sizeWidth,
      nextOffset: encoded.length,
      idWidth,
      sizeWidth,
    };

    const decoded = decodeCluster(encoded, elem, 1_000_000, new Map());
    // Two frames → two separate blocks
    expect(decoded.blocks).toHaveLength(2);
  });

  it('encodes track number > 127 as 2-byte VINT (Trap §24)', () => {
    const block: MkvSimpleBlock = {
      trackNumber: 130,
      timestampNs: 0n,
      keyframe: false,
      invisible: false,
      discardable: false,
      frames: [new Uint8Array([0xcc])],
    };
    const cluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const encoded = encodeCluster(cluster, 1_000_000);
    // Decode and verify track number is 130
    const idWidth = 4;
    let sizeWidth = 1;
    const sizeByte = encoded[idWidth] as number;
    let size = sizeByte & 0x7f;
    if ((sizeByte & 0xc0) === 0x40) {
      size = ((sizeByte & 0x3f) << 8) | (encoded[idWidth + 1] as number);
      sizeWidth = 2;
    }
    const elem: EbmlElement = {
      id: ID_CLUSTER,
      size: BigInt(size),
      payloadOffset: idWidth + sizeWidth,
      nextOffset: encoded.length,
      idWidth,
      sizeWidth,
    };
    const decoded = decodeCluster(encoded, elem, 1_000_000, new Map());
    expect(decoded.blocks[0]?.trackNumber).toBe(130);
  });
});
