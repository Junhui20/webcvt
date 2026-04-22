/**
 * Tests for SeekHead element decode/encode (seek-head.ts).
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { concatBytes, readChildren } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import {
  ID_SEEK,
  ID_SEEK_HEAD,
  ID_SEEK_ID,
  ID_SEEK_POSITION,
  SEEK_HEAD_RESERVED_BYTES,
} from '../constants.ts';
import { MkvCorruptStreamError } from '../errors.ts';
import { encodeBinaryElement, encodeMasterElement, encodeUintElement } from './header.ts';
import { decodeSeekHead, encodeSeekHead, idToBytes } from './seek-head.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeekEntry(seekId: Uint8Array, position: number): Uint8Array {
  const children = concatBytes([
    encodeBinaryElement(ID_SEEK_ID, seekId),
    encodeUintElement(ID_SEEK_POSITION, BigInt(position)),
  ]);
  return encodeMasterElement(ID_SEEK, children);
}

/**
 * Get payload offset for a 4-byte master element ID.
 */
function getMasterPayloadOffset(bytes: Uint8Array, idWidth: number): number {
  const sizeByte = bytes[idWidth] as number;
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
  return idWidth + sizeWidth;
}

function buildSeekHeadElement(entries: Uint8Array[]): {
  bytes: Uint8Array;
  children: EbmlElement[];
} {
  const payload = concatBytes(entries);
  const seekHead = encodeMasterElement(ID_SEEK_HEAD, payload);
  // ID_SEEK_HEAD = 0x114D9B74 → 4-byte ID
  const payloadStart = getMasterPayloadOffset(seekHead, 4);
  const children = readChildren(
    seekHead,
    payloadStart,
    seekHead.length,
    1,
    { value: 0 },
    1000,
    64 * 1024 * 1024,
    ID_SEEK_HEAD,
    0x18538067,
  );
  return { bytes: seekHead, children };
}

// ---------------------------------------------------------------------------
// decodeSeekHead tests
// ---------------------------------------------------------------------------

describe('decodeSeekHead', () => {
  it('decodes a SeekHead with one entry', () => {
    const infoId = idToBytes(0x1549a966);
    const entry = makeSeekEntry(infoId, 100);
    const { bytes, children } = buildSeekHeadElement([entry]);
    const extendedBytes = new Uint8Array(500);
    extendedBytes.set(bytes, 0);

    const sh = decodeSeekHead(extendedBytes, children, { value: 0 }, 0);
    expect(sh.entries).toHaveLength(1);
    expect(sh.entries[0]?.seekPosition).toBe(100);
    expect(sh.entries[0]?.seekId).toEqual(infoId);
  });

  it('decodes multiple entries', () => {
    const infoId = idToBytes(0x1549a966);
    const tracksId = idToBytes(0x1654ae6b);
    const e1 = makeSeekEntry(infoId, 100);
    const e2 = makeSeekEntry(tracksId, 200);
    const { bytes, children } = buildSeekHeadElement([e1, e2]);
    const extendedBytes = new Uint8Array(500);
    extendedBytes.set(bytes, 0);

    const sh = decodeSeekHead(extendedBytes, children, { value: 0 }, 0);
    expect(sh.entries).toHaveLength(2);
  });

  it('computes absolute offset = segmentPayloadOffset + seekPosition', () => {
    const infoId = idToBytes(0x1549a966);
    const entry = makeSeekEntry(infoId, 200);
    const { bytes, children } = buildSeekHeadElement([entry]);
    const extendedBytes = new Uint8Array(1000);
    extendedBytes.set(bytes, 0);

    // segmentPayloadOffset=100 → absolute = 100+200 = 300 < 1000 → OK
    const sh = decodeSeekHead(extendedBytes, children, { value: 0 }, 100);
    expect(sh.entries[0]?.seekPosition).toBe(200);
  });

  it('throws MkvCorruptStreamError when seekPosition + segmentPayloadOffset >= bytes.length', () => {
    const infoId = idToBytes(0x1549a966);
    const entry = makeSeekEntry(infoId, 50_000);
    const { bytes, children } = buildSeekHeadElement([entry]);
    // bytes is small, so 50_000 >> bytes.length

    expect(() => decodeSeekHead(bytes, children, { value: 0 }, 0)).toThrow(MkvCorruptStreamError);
  });

  it('skips entries missing SeekID or SeekPosition (tolerant)', () => {
    const emptySeek = encodeMasterElement(ID_SEEK, new Uint8Array(0));
    const { bytes, children } = buildSeekHeadElement([emptySeek]);
    const sh = decodeSeekHead(bytes, children, { value: 0 }, 0);
    expect(sh.entries).toHaveLength(0);
  });

  it('returns empty entries for empty SeekHead', () => {
    const { bytes, children } = buildSeekHeadElement([]);
    const sh = decodeSeekHead(bytes, children);
    expect(sh.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// encodeSeekHead tests
// ---------------------------------------------------------------------------

describe('encodeSeekHead', () => {
  it('returns exactly SEEK_HEAD_RESERVED_BYTES bytes', () => {
    const entries = [
      { seekId: idToBytes(0x1549a966), seekPosition: 96 },
      { seekId: idToBytes(0x1654ae6b), seekPosition: 200 },
    ];
    const encoded = encodeSeekHead(entries);
    expect(encoded).toHaveLength(SEEK_HEAD_RESERVED_BYTES);
  });

  it('starts with SeekHead element ID (0x114D9B74)', () => {
    const encoded = encodeSeekHead([]);
    expect(encoded[0]).toBe(0x11);
    expect(encoded[1]).toBe(0x4d);
    expect(encoded[2]).toBe(0x9b);
    expect(encoded[3]).toBe(0x74);
  });

  it('pads with Void element (0xEC) when content is smaller than reserved', () => {
    const entries = [{ seekId: idToBytes(0x1549a966), seekPosition: 100 }];
    const encoded = encodeSeekHead(entries);
    let hasVoid = false;
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === 0xec) {
        hasVoid = true;
        break;
      }
    }
    expect(hasVoid).toBe(true);
  });

  it('encodes entries and can be decoded back', () => {
    const infoId = idToBytes(0x1549a966);
    const entries = [{ seekId: infoId, seekPosition: 96 }];
    const encoded = encodeSeekHead(entries);

    // Parse the first SeekHead element (first 96 bytes)
    const payloadStart = getMasterPayloadOffset(encoded, 4);
    const children = readChildren(
      encoded,
      payloadStart,
      encoded.length,
      1,
      { value: 0 },
      1000,
      64 * 1024 * 1024,
      ID_SEEK_HEAD,
      0x18538067,
    );

    const extendedBytes = new Uint8Array(500);
    extendedBytes.set(encoded, 0);

    const sh = decodeSeekHead(extendedBytes, children, { value: 0 }, 0);
    expect(sh.entries.length).toBeGreaterThan(0);
    expect(sh.entries[0]?.seekPosition).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// idToBytes tests
// ---------------------------------------------------------------------------

describe('idToBytes', () => {
  it('encodes 1-byte ID (0x86)', () => {
    expect(idToBytes(0x86)).toEqual(new Uint8Array([0x86]));
  });

  it('encodes 4-byte ID (0x1549A966)', () => {
    const result = idToBytes(0x1549a966);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(0x15);
  });

  it('encodes 2-byte ID (0x4286)', () => {
    const result = idToBytes(0x4286);
    expect(result).toHaveLength(2);
  });
});
