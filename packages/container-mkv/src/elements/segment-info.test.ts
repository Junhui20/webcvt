/**
 * Tests for Segment Info element decode/encode (segment-info.ts).
 */

import type { EbmlElement } from '@webcvt/ebml';
import {
  concatBytes,
  writeFloat64,
  writeUint,
  writeUtf8,
  writeVintId,
  writeVintSize,
} from '@webcvt/ebml';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMECODE_SCALE,
  ID_DATE_UTC,
  ID_DURATION,
  ID_MUXING_APP,
  ID_SEGMENT_UID,
  ID_TIMECODE_SCALE,
  ID_TITLE,
  ID_WRITING_APP,
} from '../constants.ts';
import {
  encodeBinaryElement,
  encodeMasterElement,
  encodeUintElement,
  encodeUtf8Element,
} from './header.ts';
import { WEBCVT_MKV_APP_STRING, decodeInfo, encodeInfo } from './segment-info.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFloat64Elem(id: number, value: number): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeFloat64(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

function makeUtf8Elem(id: number, value: string): Uint8Array {
  return encodeUtf8Element(id, value);
}

function makeUintElem(id: number, value: bigint): Uint8Array {
  return encodeUintElement(id, value);
}

function makeBinElem(id: number, payload: Uint8Array): Uint8Array {
  return encodeBinaryElement(id, payload);
}

/**
 * Build a fake segment payload with Info element children and return them as EbmlElement[].
 */
function buildInfoChildren(fields: Uint8Array[]): { bytes: Uint8Array; children: EbmlElement[] } {
  const childrenPayload = concatBytes(fields);
  const ID_INFO = 0x1549a966;
  const infoBytes = encodeMasterElement(ID_INFO, childrenPayload);

  // Parse out the children manually using readChildren.
  // For simplicity we just parse by offset walking.
  const children: EbmlElement[] = [];
  let cursor = 0;
  while (cursor < childrenPayload.length) {
    if (childrenPayload.length - cursor < 2) break;
    const idByte = childrenPayload[cursor] as number;
    let idWidth = 1;
    let id = idByte;
    if ((idByte & 0xf0) === 0x10) {
      idWidth = 4;
      id =
        (idByte << 24) |
        ((childrenPayload[cursor + 1] as number) << 16) |
        ((childrenPayload[cursor + 2] as number) << 8) |
        (childrenPayload[cursor + 3] as number);
    } else if ((idByte & 0xe0) === 0x20) {
      idWidth = 3;
      id =
        (idByte << 16) |
        ((childrenPayload[cursor + 1] as number) << 8) |
        (childrenPayload[cursor + 2] as number);
    } else if ((idByte & 0xc0) === 0x40) {
      idWidth = 2;
      id = (idByte << 8) | (childrenPayload[cursor + 1] as number);
    }

    const sizeOffset = cursor + idWidth;
    const sizeByte = childrenPayload[sizeOffset] as number;
    let sizeWidth = 1;
    let size = sizeByte & ~0x80;
    if ((sizeByte & 0x80) === 0) {
      // Multi-byte size handling simplified (just skip for test purposes)
      if ((sizeByte & 0x40) !== 0) {
        sizeWidth = 2;
        size = ((sizeByte & ~0x40) << 8) | (childrenPayload[sizeOffset + 1] as number);
      }
    }

    const payloadOffset = sizeOffset + sizeWidth;
    const nextOffset = payloadOffset + size;

    children.push({ id, size: BigInt(size), payloadOffset, nextOffset, idWidth, sizeWidth });
    cursor = nextOffset;
  }

  return { bytes: childrenPayload, children };
}

// ---------------------------------------------------------------------------
// decodeInfo tests
// ---------------------------------------------------------------------------

describe('decodeInfo', () => {
  it('defaults timecodeScale to 1_000_000 when absent (Trap §4)', () => {
    const fields = [makeUtf8Elem(ID_MUXING_APP, 'test'), makeUtf8Elem(ID_WRITING_APP, 'test')];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.timecodeScale).toBe(DEFAULT_TIMECODE_SCALE);
  });

  it('reads timecodeScale from element', () => {
    const fields = [
      makeUintElem(ID_TIMECODE_SCALE, 500_000n),
      makeUtf8Elem(ID_MUXING_APP, 'test'),
      makeUtf8Elem(ID_WRITING_APP, 'test'),
    ];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.timecodeScale).toBe(500_000);
  });

  it('reads duration as float', () => {
    const fields = [
      makeUintElem(ID_TIMECODE_SCALE, 1_000_000n),
      makeFloat64Elem(ID_DURATION, 1234.5),
      makeUtf8Elem(ID_MUXING_APP, 'test'),
      makeUtf8Elem(ID_WRITING_APP, 'test'),
    ];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.duration).toBeCloseTo(1234.5, 2);
  });

  it('duration is undefined when absent', () => {
    const fields = [makeUtf8Elem(ID_MUXING_APP, 'test'), makeUtf8Elem(ID_WRITING_APP, 'test')];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.duration).toBeUndefined();
  });

  it('reads muxingApp and writingApp', () => {
    const fields = [makeUtf8Elem(ID_MUXING_APP, 'MyMuxer'), makeUtf8Elem(ID_WRITING_APP, 'MyApp')];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.muxingApp).toBe('MyMuxer');
    expect(info.writingApp).toBe('MyApp');
  });

  it('reads segmentUid when present (16 bytes)', () => {
    const uid = new Uint8Array(16).fill(0xab);
    const fields = [
      makeUtf8Elem(ID_MUXING_APP, 'test'),
      makeUtf8Elem(ID_WRITING_APP, 'test'),
      makeBinElem(ID_SEGMENT_UID, uid),
    ];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.segmentUid).toEqual(uid);
  });

  it('segmentUid is undefined when absent', () => {
    const fields = [makeUtf8Elem(ID_MUXING_APP, 'test'), makeUtf8Elem(ID_WRITING_APP, 'test')];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.segmentUid).toBeUndefined();
  });

  it('reads title when present', () => {
    const fields = [
      makeUtf8Elem(ID_MUXING_APP, 'test'),
      makeUtf8Elem(ID_WRITING_APP, 'test'),
      makeUtf8Elem(ID_TITLE, 'My Video Title'),
    ];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.title).toBe('My Video Title');
  });

  it('title is undefined when absent', () => {
    const fields = [makeUtf8Elem(ID_MUXING_APP, 'test'), makeUtf8Elem(ID_WRITING_APP, 'test')];
    const { bytes, children } = buildInfoChildren(fields);
    const info = decodeInfo(bytes, children);
    expect(info.title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// encodeInfo tests
// ---------------------------------------------------------------------------

describe('encodeInfo', () => {
  it('encodes timecodeScale', () => {
    const info = {
      timecodeScale: 1_000_000,
      muxingApp: WEBCVT_MKV_APP_STRING,
      writingApp: WEBCVT_MKV_APP_STRING,
    };
    const encoded = encodeInfo(info);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('uses WEBCVT_MKV_APP_STRING for muxingApp/writingApp when empty', () => {
    const info = { timecodeScale: 1_000_000, muxingApp: '', writingApp: '' };
    const encoded = encodeInfo(info);
    // Encoded bytes should contain the app string
    const text = new TextDecoder().decode(encoded);
    expect(text).toContain('@webcvt/container-mkv');
  });

  it('encodes duration as float64 when present', () => {
    const info = {
      timecodeScale: 1_000_000,
      duration: 5000.0,
      muxingApp: 'test',
      writingApp: 'test',
    };
    const encoded = encodeInfo(info);
    expect(encoded.length).toBeGreaterThan(20);
  });

  it('omits duration when undefined', () => {
    const infoWithDuration = {
      timecodeScale: 1_000_000,
      duration: 1234.0,
      muxingApp: 'test',
      writingApp: 'test',
    };
    const infoWithout = { timecodeScale: 1_000_000, muxingApp: 'test', writingApp: 'test' };
    const withDuration = encodeInfo(infoWithDuration);
    const withoutDuration = encodeInfo(infoWithout);
    // With duration should be longer (duration adds 10+ bytes)
    expect(withDuration.length).toBeGreaterThan(withoutDuration.length);
  });

  it('includes segmentUid when present (16 bytes)', () => {
    const uid = new Uint8Array(16).fill(0xcc);
    const info = {
      timecodeScale: 1_000_000,
      muxingApp: 'test',
      writingApp: 'test',
      segmentUid: uid,
    };
    const encoded = encodeInfo(info);
    // The encoded bytes should contain the 16 UID bytes somewhere
    let found = false;
    for (let i = 0; i <= encoded.length - 16; i++) {
      if (encoded[i] === 0xcc && encoded.subarray(i, i + 16).every((b) => b === 0xcc)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('includes title when present', () => {
    const info = {
      timecodeScale: 1_000_000,
      muxingApp: 'test',
      writingApp: 'test',
      title: 'My Movie',
    };
    const encoded = encodeInfo(info);
    const text = new TextDecoder().decode(encoded);
    expect(text).toContain('My Movie');
  });

  it('first element of encoded Info is ID_INFO (0x1549A966)', () => {
    const info = { timecodeScale: 1_000_000, muxingApp: 'test', writingApp: 'test' };
    const encoded = encodeInfo(info);
    // 4-byte ID: 0x15 0x49 0xA9 0x66
    expect(encoded[0]).toBe(0x15);
    expect(encoded[1]).toBe(0x49);
    expect(encoded[2]).toBe(0xa9);
    expect(encoded[3]).toBe(0x66);
  });
});
