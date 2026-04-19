/**
 * Tests for boxes/esds.ts — MPEG-4 elementary stream descriptor parser.
 *
 * Design note test cases covered:
 *   - "parses esds variable-length descriptor sizes (1-byte and 4-byte forms)"
 *   - "extracts AudioSpecificConfig bytes from DecoderSpecificInfo"
 */

import { describe, expect, it } from 'vitest';
import { Mp4DescriptorTooLargeError, Mp4InvalidBoxError } from '../errors.ts';
import { parseEsdsPayload, serializeEsdsPayload } from './esds.ts';

// ---------------------------------------------------------------------------
// Helpers: build a minimal valid esds payload
// ---------------------------------------------------------------------------

/**
 * Build a minimal esds FullBox payload from scratch.
 * Uses explicit byte construction to test variable-length size decoding.
 */
function buildEsdsPayload(
  objectTypeIndication: number,
  asc: Uint8Array,
  useLargeSize = false,
): Uint8Array {
  // SLConfig: tag=0x06, size=1, predefined=0x02
  const slBlock = buildDescriptor(0x06, new Uint8Array([0x02]), useLargeSize);

  // DecoderSpecificInfo (tag=0x05): payload = ASC bytes
  const dsiBlock = buildDescriptor(0x05, asc, useLargeSize);

  // DecoderConfigDescriptor (tag=0x04): 13 fixed bytes + DSI
  const dcFixed = new Uint8Array(13);
  dcFixed[0] = objectTypeIndication;
  dcFixed[1] = 0x15; // streamType
  const dcPayload = concat([dcFixed, dsiBlock]);
  const dcBlock = buildDescriptor(0x04, dcPayload, useLargeSize);

  // ES_Descriptor (tag=0x03): ES_ID(u16)+flags(u8) + DC + SL
  const esFixed = new Uint8Array([0x00, 0x01, 0x00]); // ES_ID=1, flags=0
  const esPayload = concat([esFixed, dcBlock, slBlock]);
  const esBlock = buildDescriptor(0x03, esPayload, useLargeSize);

  // FullBox prefix (version=0, flags=0)
  return concat([new Uint8Array(4), esBlock]);
}

function buildDescriptor(tagId: number, payload: Uint8Array, useLargeSize: boolean): Uint8Array {
  let sizeBytes: Uint8Array;
  if (useLargeSize) {
    // 4-byte encoding: 0x80 0x80 0x80 N (Trap §6 example format)
    const n = payload.length;
    sizeBytes = new Uint8Array([
      ((n >> 21) & 0x7f) | 0x80,
      ((n >> 14) & 0x7f) | 0x80,
      ((n >> 7) & 0x7f) | 0x80,
      n & 0x7f,
    ]);
  } else {
    sizeBytes = new Uint8Array([payload.length & 0x7f]);
  }
  return concat([new Uint8Array([tagId]), sizeBytes, payload]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseEsdsPayload', () => {
  it('extracts AudioSpecificConfig bytes from DecoderSpecificInfo (1-byte size form)', () => {
    const asc = new Uint8Array([0x12, 0x10]); // typical 2-byte AAC-LC ASC
    const payload = buildEsdsPayload(0x40, asc, false);
    const result = parseEsdsPayload(payload);
    expect(result.objectTypeIndication).toBe(0x40);
    expect(result.decoderSpecificInfo).toEqual(asc);
  });

  it('extracts AudioSpecificConfig bytes from DecoderSpecificInfo (4-byte size form)', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const payload = buildEsdsPayload(0x40, asc, true);
    const result = parseEsdsPayload(payload);
    expect(result.objectTypeIndication).toBe(0x40);
    expect(result.decoderSpecificInfo).toEqual(asc);
  });

  it('correctly decodes variable-length size 0x80 0x80 0x80 0x22 = 34', () => {
    // Specifically test that [0x80, 0x80, 0x80, 0x22] decodes to 34 (Trap §6).
    const asc = new Uint8Array(34); // 34 bytes
    asc[0] = 0x12;
    asc[1] = 0x10;
    const payload = buildEsdsPayload(0x40, asc, true);
    const result = parseEsdsPayload(payload);
    expect(result.decoderSpecificInfo.length).toBe(34);
  });

  it('handles objectTypeIndication 0x67 (MPEG-2 AAC-LC)', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const payload = buildEsdsPayload(0x67, asc, false);
    const result = parseEsdsPayload(payload);
    expect(result.objectTypeIndication).toBe(0x67);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseEsdsPayload(new Uint8Array(2))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when ES_DescrTag is missing', () => {
    const payload = new Uint8Array(8);
    payload[4] = 0x99; // wrong tag
    payload[5] = 0x01; // size=1
    payload[6] = 0x00;
    expect(() => parseEsdsPayload(payload)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4DescriptorTooLargeError for oversized descriptor', () => {
    // Build a descriptor claiming size > 16 MiB.
    const payload = new Uint8Array(10);
    payload[4] = 0x03; // ES_DescrTag
    // Encode a 4-byte size > 16 MiB.
    const bigSize = 16 * 1024 * 1024 + 1;
    payload[5] = ((bigSize >> 21) & 0x7f) | 0x80;
    payload[6] = ((bigSize >> 14) & 0x7f) | 0x80;
    payload[7] = ((bigSize >> 7) & 0x7f) | 0x80;
    payload[8] = bigSize & 0x7f;
    expect(() => parseEsdsPayload(payload)).toThrow(Mp4DescriptorTooLargeError);
  });

  it('throws Mp4InvalidBoxError when descriptor size field is truncated', () => {
    // ES_DescrTag present but size byte has continuation bit set and no following byte.
    const payload = new Uint8Array(6);
    payload[4] = 0x03; // ES_DescrTag
    payload[5] = 0x80; // continuation bit set, but no more bytes
    expect(() => parseEsdsPayload(payload)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when descriptor payload claims size beyond buffer', () => {
    const payload = new Uint8Array(8);
    payload[4] = 0x03; // ES_DescrTag
    payload[5] = 50; // claims 50 bytes payload but only 2 bytes remain
    expect(() => parseEsdsPayload(payload)).toThrow(Mp4InvalidBoxError);
  });

  it('handles ES_Descriptor with stream_dependence_flag (esFlags & 0x80)', () => {
    // Build a payload where esFlags has stream_dependence set — the parser skips 2 extra bytes.
    const asc = new Uint8Array([0x12, 0x10]);
    const slBlock = buildDescriptor(0x06, new Uint8Array([0x02]), false);
    const dsiBlock = buildDescriptor(0x05, asc, false);
    const dcFixed = new Uint8Array(13);
    dcFixed[0] = 0x40;
    dcFixed[1] = 0x15;
    const dcPayload = concat([dcFixed, dsiBlock]);
    const dcBlock = buildDescriptor(0x04, dcPayload, false);
    // ES_ID(2) + flags(1=0x80=stream_dep) + dependsOn_ES_ID(2) + DC + SL
    const esFixed = new Uint8Array([0x00, 0x01, 0x80, 0x00, 0x02]);
    const esPayload = concat([esFixed, dcBlock, slBlock]);
    const esBlock = buildDescriptor(0x03, esPayload, false);
    const fullPayload = concat([new Uint8Array(4), esBlock]);
    const result = parseEsdsPayload(fullPayload);
    expect(result.objectTypeIndication).toBe(0x40);
    expect(result.decoderSpecificInfo).toEqual(asc);
  });

  it('throws Mp4InvalidBoxError when DecoderConfigDescriptor tag is wrong', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    // Build esds with wrong DC tag (use 0x99 instead of 0x04).
    const dsiBlock = buildDescriptor(0x05, asc, false);
    const dcFixed = new Uint8Array(13);
    const dcPayload = concat([dcFixed, dsiBlock]);
    const dcBlock = buildDescriptor(0x99, dcPayload, false); // wrong tag
    const slBlock = buildDescriptor(0x06, new Uint8Array([0x02]), false);
    const esFixed = new Uint8Array([0x00, 0x01, 0x00]);
    const esPayload = concat([esFixed, dcBlock, slBlock]);
    const esBlock = buildDescriptor(0x03, esPayload, false);
    const fullPayload = concat([new Uint8Array(4), esBlock]);
    expect(() => parseEsdsPayload(fullPayload)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when DecoderSpecificInfo tag is wrong', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const dsiBlock = buildDescriptor(0x99, asc, false); // wrong tag (should be 0x05)
    const dcFixed = new Uint8Array(13);
    dcFixed[0] = 0x40;
    dcFixed[1] = 0x15;
    const dcPayload = concat([dcFixed, dsiBlock]);
    const dcBlock = buildDescriptor(0x04, dcPayload, false);
    const slBlock = buildDescriptor(0x06, new Uint8Array([0x02]), false);
    const esFixed = new Uint8Array([0x00, 0x01, 0x00]);
    const esPayload = concat([esFixed, dcBlock, slBlock]);
    const esBlock = buildDescriptor(0x03, esPayload, false);
    const fullPayload = concat([new Uint8Array(4), esBlock]);
    expect(() => parseEsdsPayload(fullPayload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeEsdsPayload', () => {
  it('round-trips objectTypeIndication and ASC bytes', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const serialized = serializeEsdsPayload(0x40, asc);
    const reparsed = parseEsdsPayload(serialized);
    expect(reparsed.objectTypeIndication).toBe(0x40);
    expect(reparsed.decoderSpecificInfo).toEqual(asc);
  });

  it('produces a FullBox with version=0 prefix', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const bytes = serializeEsdsPayload(0x40, asc);
    expect(bytes[0]).toBe(0); // version
    expect(bytes[1]).toBe(0); // flags
    expect(bytes[2]).toBe(0);
    expect(bytes[3]).toBe(0);
  });

  it('uses 2-byte descriptor size encoding for payloads >= 128 bytes (covers encodeDescriptorSize branches)', () => {
    // A 128-byte ASC will cause the DecoderSpecificInfo descriptor size to use
    // the 2-byte encoding (size >= 0x80). Round-trip should still work.
    const asc = new Uint8Array(128);
    asc.fill(0x11);
    const serialized = serializeEsdsPayload(0x40, asc);
    const reparsed = parseEsdsPayload(serialized);
    expect(reparsed.decoderSpecificInfo.length).toBe(128);
    expect(reparsed.objectTypeIndication).toBe(0x40);
  });
});
