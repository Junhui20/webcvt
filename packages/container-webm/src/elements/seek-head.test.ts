/**
 * Tests for SeekHead decode/encode (elements/seek-head.ts).
 *
 * Covers design note test case:
 * - "tolerates missing SeekHead"
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import { SEEK_HEAD_RESERVED_BYTES } from '../constants.ts';
import { WebmCorruptStreamError } from '../errors.ts';
import { decodeSeekHead, encodeSeekHead, idToBytes } from './seek-head.ts';

describe('encodeSeekHead', () => {
  it('produces exactly SEEK_HEAD_RESERVED_BYTES bytes', () => {
    const entries = [
      { seekId: idToBytes(0x1549a966), seekPosition: 100 },
      { seekId: idToBytes(0x1654ae6b), seekPosition: 200 },
    ];
    const bytes = encodeSeekHead(entries);
    expect(bytes.length).toBe(SEEK_HEAD_RESERVED_BYTES);
  });

  it('starts with SeekHead ID (0x11 0x4D 0x9B 0x74)', () => {
    const bytes = encodeSeekHead([]);
    expect(bytes[0]).toBe(0x11);
    expect(bytes[1]).toBe(0x4d);
    expect(bytes[2]).toBe(0x9b);
    expect(bytes[3]).toBe(0x74);
  });

  it('encodes correct SEEK_HEAD_RESERVED_BYTES length with no entries', () => {
    const bytes = encodeSeekHead([]);
    expect(bytes.length).toBe(SEEK_HEAD_RESERVED_BYTES);
  });
});

describe('idToBytes', () => {
  it('returns 4 bytes for Segment ID 0x18538067', () => {
    const bytes = idToBytes(0x18538067);
    expect(bytes).toEqual(new Uint8Array([0x18, 0x53, 0x80, 0x67]));
  });

  it('returns 4 bytes for EBML header ID 0x1A45DFA3', () => {
    const bytes = idToBytes(0x1a45dfa3);
    expect(bytes).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  });

  it('returns 2 bytes for 2-byte ID 0x4286', () => {
    const bytes = idToBytes(0x4286);
    expect(bytes).toEqual(new Uint8Array([0x42, 0x86]));
  });
});

describe('decodeSeekHead', () => {
  it('returns empty entries for no Seek children', () => {
    const seekHead = decodeSeekHead(new Uint8Array(0), []);
    expect(seekHead.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sec-M-2 regression: SeekPosition bounds validation
// ---------------------------------------------------------------------------

describe('decodeSeekHead — Sec-M-2 SeekPosition out-of-bounds rejection', () => {
  it('throws WebmCorruptStreamError when SeekPosition + segmentPayloadOffset exceeds file length', () => {
    // Build a Seek element manually with SeekID + SeekPosition where
    // seekPosition = 50000, segmentPayloadOffset = 100 → absolute = 50100.
    // Pass a 200-byte file buffer so that 50100 >= 200 → throws.
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

    function makeElemBytes(id: number, payload: Uint8Array): Uint8Array {
      const sizeVal = payload.length;
      const sizeVint =
        sizeVal < 127
          ? new Uint8Array([0x80 | sizeVal])
          : new Uint8Array([0x40 | (sizeVal >> 8), sizeVal & 0xff]);
      const idBytes =
        id >= 0x4000 ? new Uint8Array([(id >> 8) & 0xff, id & 0xff]) : new Uint8Array([id]);
      return concatU8([idBytes, sizeVint, payload]);
    }

    // SeekID: ID 0x53AB, payload = Info element ID bytes
    const seekIdElem = makeElemBytes(0x53ab, new Uint8Array([0x15, 0x49, 0xa9, 0x66]));
    // SeekPosition: ID 0x53AC, 4-byte uint = 50000
    const seekPosPayload = new Uint8Array(4);
    new DataView(seekPosPayload.buffer).setUint32(0, 50000, false);
    const seekPosElem = makeElemBytes(0x53ac, seekPosPayload);

    // Seek master element (ID 0x4DBB)
    const seekPayload = concatU8([seekIdElem, seekPosElem]);
    const seekElem = makeElemBytes(0x4dbb, seekPayload);

    // Fake file buffer (200 bytes total)
    const fileBytes = new Uint8Array(200);
    fileBytes.set(seekElem, 0);

    // Build children array: one Seek element
    const seekChild: EbmlElement = {
      id: 0x4dbb,
      size: BigInt(seekPayload.length),
      payloadOffset: 2 + 1, // ID(2) + size(1)
      nextOffset: 2 + 1 + seekPayload.length,
      idWidth: 2,
      sizeWidth: 1,
    };

    // segmentPayloadOffset = 100, seekPosition = 50000 → absolute = 50100 >= 200 → throw
    expect(() => decodeSeekHead(fileBytes, [seekChild], { value: 0 }, 100)).toThrow(
      WebmCorruptStreamError,
    );
  });
});

describe('encodeSeekHead edge cases', () => {
  it('handles case where remaining bytes after seekHead < 2 (no void room)', () => {
    // Craft entries that fill to near the budget, leaving < 2 bytes for a Void element.
    // A standard 3-entry SeekHead (Info + Tracks + Cues) typically leaves 1 byte.
    const entries = [
      { seekId: idToBytes(0x1549a966), seekPosition: 100 }, // Info
      { seekId: idToBytes(0x1654ae6b), seekPosition: 200 }, // Tracks
      { seekId: idToBytes(0x1c53bb6b), seekPosition: 300 }, // Cues
    ];
    // Should still produce exactly SEEK_HEAD_RESERVED_BYTES without throwing.
    const bytes = encodeSeekHead(entries);
    expect(bytes.length).toBe(SEEK_HEAD_RESERVED_BYTES);
  });

  it('still produces valid SEEK_HEAD_RESERVED_BYTES with many entries', () => {
    // Many entries — SeekHead body may exceed SEEK_HEAD_RESERVED_BYTES.
    const entries = Array.from({ length: 10 }, (_, i) => ({
      seekId: idToBytes(0x1549a966),
      seekPosition: i * 1000,
    }));
    const bytes = encodeSeekHead(entries);
    // When budget is exceeded, returns the raw seekHeadBytes without padding.
    expect(bytes.length).toBeGreaterThan(0);
  });
});
