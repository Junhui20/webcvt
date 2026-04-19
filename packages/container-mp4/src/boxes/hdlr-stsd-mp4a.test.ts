/**
 * Tests for boxes/hdlr-stsd-mp4a.ts — handler, stsd, mp4a, dref parsers.
 *
 * Covers:
 *   - parseHdlr (soun, non-soun, too short, name with/without null terminator)
 *   - serializeHdlr round-trip
 *   - validateDref (self-contained, external, too large, truncated)
 *   - parseStsd (mp4a, non-mp4a, too short, overrun)
 *   - parseMp4aPayload (via parseStsd: qt version rejection, missing esds)
 *   - serializeMp4a / serializeStsd round-trip
 */

import { describe, expect, it } from 'vitest';
import {
  Mp4ExternalDataRefError,
  Mp4InvalidBoxError,
  Mp4TableTooLargeError,
  Mp4TooManyBoxesError,
  Mp4UnsupportedSampleEntryError,
  Mp4UnsupportedSoundVersionError,
  Mp4UnsupportedTrackTypeError,
} from '../errors.ts';
import {
  parseHdlr,
  parseStsd,
  serializeHdlr,
  serializeMp4a,
  serializeStsd,
  validateDref,
} from './hdlr-stsd-mp4a.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHdlrPayload(handlerType: string, name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  // version(1)+flags(3)+pre_defined(4)+handler_type(4)+reserved(12)+name+null
  const out = new Uint8Array(4 + 4 + 4 + 12 + nameBytes.length + 1);
  for (let i = 0; i < 4; i++) out[8 + i] = handlerType.charCodeAt(i) & 0xff;
  out.set(nameBytes, 24);
  return out;
}

/**
 * Build a minimal valid stsd payload containing an mp4a sample entry.
 *
 * stsd layout:
 *   version(1)+flags(3)+entry_count(4) = 8 bytes
 *   then mp4a box: size(4)+type(4)+SampleEntry(8)+AudioSampleEntry(20)+esds box
 */
function buildMinimalStsdWithMp4a(
  channelCount: number,
  sampleRate: number,
  asc: Uint8Array,
): Uint8Array {
  // Build esds payload first.
  const esdsPayload = buildMinimalEsds(0x40, asc);
  const esdsBoxSize = 8 + esdsPayload.length;
  const esdsBox = new Uint8Array(esdsBoxSize);
  const esdsView = new DataView(esdsBox.buffer);
  esdsView.setUint32(0, esdsBoxSize, false);
  esdsBox[4] = 0x65;
  esdsBox[5] = 0x73;
  esdsBox[6] = 0x64;
  esdsBox[7] = 0x73; // 'esds'
  esdsBox.set(esdsPayload, 8);

  // mp4a payload = SampleEntry(8) + AudioSampleEntry(20) + esds box
  const mp4aPayloadSize = 28 + esdsBoxSize;
  const mp4aBoxSize = 8 + mp4aPayloadSize;
  const mp4aBox = new Uint8Array(mp4aBoxSize);
  const mp4aView = new DataView(mp4aBox.buffer);
  mp4aView.setUint32(0, mp4aBoxSize, false);
  mp4aBox[4] = 0x6d;
  mp4aBox[5] = 0x70;
  mp4aBox[6] = 0x34;
  mp4aBox[7] = 0x61; // 'mp4a'
  // SampleEntry: reserved(6)+data_ref_index(2) at offset 8
  mp4aView.setUint16(14, 1, false);
  // AudioSampleEntry at offset 16: reserved(8)+channelcount(2)+samplesize(2)+...+samplerate(4)
  mp4aView.setUint16(24, channelCount, false);
  mp4aView.setUint16(26, 16, false); // samplesize
  mp4aView.setUint32(32, (sampleRate & 0xffff) << 16, false); // Q16.16
  mp4aBox.set(esdsBox, 36);

  // stsd: version+flags(4)+entry_count(4)+mp4aBox
  const stsdPayloadSize = 8 + mp4aBoxSize;
  const out = new Uint8Array(stsdPayloadSize);
  const view = new DataView(out.buffer);
  view.setUint32(4, 1, false); // entry_count=1
  out.set(mp4aBox, 8);
  return out;
}

function buildMinimalEsds(oti: number, asc: Uint8Array): Uint8Array {
  const dsi = buildDescriptor(0x05, asc);
  const dcFixed = new Uint8Array(13);
  dcFixed[0] = oti;
  dcFixed[1] = 0x15;
  const dcPayload = concat([dcFixed, dsi]);
  const dc = buildDescriptor(0x04, dcPayload);
  const sl = buildDescriptor(0x06, new Uint8Array([0x02]));
  const esFixed = new Uint8Array([0x00, 0x01, 0x00]);
  const esPayload = concat([esFixed, dc, sl]);
  const es = buildDescriptor(0x03, esPayload);
  return concat([new Uint8Array(4), es]);
}

function buildDescriptor(tag: number, payload: Uint8Array): Uint8Array {
  const n = payload.length;
  const out = new Uint8Array(2 + n);
  out[0] = tag;
  out[1] = n & 0x7f; // 1-byte size (< 128 for these tests)
  out.set(payload, 2);
  return out;
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

function buildSelfContainedDrefPayload(): Uint8Array {
  // version+flags(4)+entry_count(4)+url_entry(12)
  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  view.setUint32(4, 1, false); // entry_count=1
  // url  entry: size(4)+type(4)+flags(4 with bit0=1 = self-contained)
  view.setUint32(8, 12, false); // size=12
  out[12] = 0x75;
  out[13] = 0x72;
  out[14] = 0x6c;
  out[15] = 0x20; // 'url '
  out[19] = 0x01; // flags bit0 = self-contained
  return out;
}

// ---------------------------------------------------------------------------
// parseHdlr tests
// ---------------------------------------------------------------------------

describe('parseHdlr', () => {
  it('parses soun handler type', () => {
    const payload = buildHdlrPayload('soun', 'Sound Handler');
    const h = parseHdlr(payload);
    expect(h.handlerType).toBe('soun');
    expect(h.name).toBe('Sound Handler');
  });

  it('throws Mp4UnsupportedTrackTypeError for non-soun handler', () => {
    const payload = buildHdlrPayload('vide', '');
    expect(() => parseHdlr(payload)).toThrow(Mp4UnsupportedTrackTypeError);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseHdlr(new Uint8Array(4))).toThrow(Mp4InvalidBoxError);
  });

  it('handles handler name without null terminator', () => {
    const out = buildHdlrPayload('soun', '');
    // Payload has exactly 25 bytes (24 + 1 null) but we add name bytes without null.
    const withName = new Uint8Array(30);
    withName.set(out.subarray(0, 24), 0);
    withName[8] = 0x73;
    withName[9] = 0x6f;
    withName[10] = 0x75;
    withName[11] = 0x6e; // 'soun'
    // Bytes 24-29: name bytes, no null terminator.
    withName[24] = 0x41; // 'A'
    withName[25] = 0x42; // 'B'
    // No null — the parser should still work.
    const h = parseHdlr(withName);
    expect(h.handlerType).toBe('soun');
    expect(h.name.length).toBeGreaterThan(0);
  });
});

describe('serializeHdlr', () => {
  it('round-trips handler type and name', () => {
    const original = { handlerType: 'soun', name: 'Sound Handler' };
    const bytes = serializeHdlr(original);
    const parsed = parseHdlr(bytes);
    expect(parsed.handlerType).toBe('soun');
    expect(parsed.name).toBe('Sound Handler');
  });
});

// ---------------------------------------------------------------------------
// validateDref tests
// ---------------------------------------------------------------------------

describe('validateDref', () => {
  it('passes for self-contained dref (url flags & 1 == 1)', () => {
    const payload = buildSelfContainedDrefPayload();
    expect(() => validateDref(payload)).not.toThrow();
  });

  it('throws Mp4ExternalDataRefError for external dref (flags & 1 == 0)', () => {
    const payload = buildSelfContainedDrefPayload();
    // Clear the self-contained flag.
    payload[19] = 0x00;
    expect(() => validateDref(payload)).toThrow(Mp4ExternalDataRefError);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => validateDref(new Uint8Array(4))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4TableTooLargeError when entry_count exceeds MAX_TABLE_ENTRIES', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => validateDref(payload)).toThrow(Mp4TableTooLargeError);
  });

  it('throws Mp4InvalidBoxError when dref entry is truncated', () => {
    // entry_count=1 but only 4 bytes remain (need 12).
    const out = new Uint8Array(12);
    const view = new DataView(out.buffer);
    view.setUint32(4, 1, false); // entry_count=1
    // Only 4 bytes at offset 8 — not enough for a 12-byte entry.
    expect(() => validateDref(out)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for zero entry_count (Sec-M-6: only exactly 1 is valid)', () => {
    const payload = new Uint8Array(8);
    // entry_count=0 — Sec-M-6 requires exactly 1.
    expect(() => validateDref(payload)).toThrow(Mp4InvalidBoxError);
  });

  it('Sec-M-6: throws Mp4InvalidBoxError when entry_count != 1', () => {
    // entry_count=2 is unsupported in first-pass.
    const out = new Uint8Array(20 + 12); // room for 2 entries
    const view = new DataView(out.buffer);
    view.setUint32(4, 2, false); // entry_count=2
    // First self-contained url  entry
    view.setUint32(8, 12, false);
    out[12] = 0x75;
    out[13] = 0x72;
    out[14] = 0x6c;
    out[15] = 0x20; // 'url '
    out[19] = 0x01; // self-contained
    // Second url  entry
    view.setUint32(20, 12, false);
    out[24] = 0x75;
    out[25] = 0x72;
    out[26] = 0x6c;
    out[27] = 0x20;
    out[31] = 0x01;
    expect(() => validateDref(out)).toThrow(Mp4InvalidBoxError);
  });
});

// ---------------------------------------------------------------------------
// parseStsd tests
// ---------------------------------------------------------------------------

describe('parseStsd', () => {
  it('parses a valid mp4a stsd payload', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const payload = buildMinimalStsdWithMp4a(2, 44100, asc);
    const fileData = new Uint8Array(0); // not used in this code path
    const entry = parseStsd(payload, fileData);
    expect(entry.channelCount).toBe(2);
    expect(entry.sampleRate).toBe(44100);
    expect(entry.decoderSpecificInfo).toEqual(asc);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseStsd(new Uint8Array(4), new Uint8Array(0))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when stsd has no sample entry (payload < 16)', () => {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1, false); // entry_count=1 but no entry follows
    expect(() => parseStsd(payload, new Uint8Array(0))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4UnsupportedSampleEntryError for non-mp4a entry type', () => {
    // Build stsd with an 'avc1' sample entry.
    const avc1Payload = new Uint8Array(100);
    const view = new DataView(avc1Payload.buffer);
    view.setUint32(4, 1, false); // entry_count=1
    view.setUint32(8, 100 - 8, false); // entry size
    avc1Payload[12] = 0x61;
    avc1Payload[13] = 0x76;
    avc1Payload[14] = 0x63;
    avc1Payload[15] = 0x31; // 'avc1'
    expect(() => parseStsd(avc1Payload, new Uint8Array(0))).toThrow(Mp4UnsupportedSampleEntryError);
  });

  it('throws Mp4TableTooLargeError when entry_count exceeds MAX_TABLE_ENTRIES', () => {
    const payload = new Uint8Array(20);
    const view = new DataView(payload.buffer);
    view.setUint32(4, 1_000_001, false);
    expect(() => parseStsd(payload, new Uint8Array(0))).toThrow(Mp4TableTooLargeError);
  });
});

describe('parseMp4aPayload — QuickTime version rejection', () => {
  it('throws Mp4UnsupportedSoundVersionError when qtVersion != 0', () => {
    // Build stsd with mp4a where the first 2 bytes of reserved[6] indicate QT version 1.
    const asc = new Uint8Array([0x12, 0x10]);
    const payload = buildMinimalStsdWithMp4a(2, 44100, asc);
    // The mp4a payload starts at stsd_payload[16]. Byte 16 in stsd_payload is
    // the first byte of mp4a's SampleEntry header (which is at offset 0 of mp4aPayload).
    // Set qtVersion = 1 at the first 2 bytes of mp4aPayload (offset 16 in stsd_payload).
    const view = new DataView(payload.buffer);
    view.setUint16(16, 1, false); // qtVersion=1 at mp4aPayload offset 0
    expect(() => parseStsd(payload, new Uint8Array(0))).toThrow(Mp4UnsupportedSoundVersionError);
  });
});

describe('parseMp4aPayload — missing esds', () => {
  it('throws Mp4InvalidBoxError when mp4a has no esds child box', () => {
    // Build an mp4a payload with SampleEntry(8)+AudioSampleEntry(20) = 28 bytes total,
    // no child boxes.
    const mp4aPayloadSize = 28; // no esds
    const mp4aBoxSize = 8 + mp4aPayloadSize;
    const mp4aBox = new Uint8Array(mp4aBoxSize);
    const mp4aView = new DataView(mp4aBox.buffer);
    mp4aView.setUint32(0, mp4aBoxSize, false);
    mp4aBox[4] = 0x6d;
    mp4aBox[5] = 0x70;
    mp4aBox[6] = 0x34;
    mp4aBox[7] = 0x61; // 'mp4a'
    mp4aView.setUint16(14, 1, false); // data_reference_index=1
    mp4aView.setUint16(24, 2, false); // channelCount
    mp4aView.setUint32(32, 44100 << 16, false); // sampleRate Q16.16

    const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
    const stsdView = new DataView(stsdPayload.buffer);
    stsdView.setUint32(4, 1, false); // entry_count=1
    stsdPayload.set(mp4aBox, 8);

    expect(() => parseStsd(stsdPayload, new Uint8Array(0))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError when mp4a has a non-esds child box before no esds (exercises cursor skip)', () => {
    // Build mp4a with one unknown child box ('sttf') then ends — no esds follows.
    // This exercises the `cursor += childSize` branch at line 271.
    const unknownChild = new Uint8Array(16); // size=16 'sttf' box
    const unknownView = new DataView(unknownChild.buffer);
    unknownView.setUint32(0, 16, false);
    unknownChild[4] = 0x73;
    unknownChild[5] = 0x74;
    unknownChild[6] = 0x74;
    unknownChild[7] = 0x66; // 'sttf'

    const mp4aPayloadSize = 28 + unknownChild.length; // header + unknown child, no esds
    const mp4aBoxSize = 8 + mp4aPayloadSize;
    const mp4aBox = new Uint8Array(mp4aBoxSize);
    const mp4aView = new DataView(mp4aBox.buffer);
    mp4aView.setUint32(0, mp4aBoxSize, false);
    mp4aBox[4] = 0x6d;
    mp4aBox[5] = 0x70;
    mp4aBox[6] = 0x34;
    mp4aBox[7] = 0x61; // 'mp4a'
    mp4aView.setUint16(14, 1, false);
    mp4aView.setUint16(24, 2, false);
    mp4aView.setUint32(32, 44100 << 16, false);
    mp4aBox.set(unknownChild, 36); // place unknown child after AudioSampleEntry

    const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
    const stsdView2 = new DataView(stsdPayload.buffer);
    stsdView2.setUint32(4, 1, false);
    stsdPayload.set(mp4aBox, 8);

    expect(() => parseStsd(stsdPayload, new Uint8Array(0))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for mp4a payload too short (< 28 bytes)', () => {
    // Build stsd with mp4a entry size too small to hold SampleEntry header.
    const mp4aBoxSize = 8 + 10; // only 10 bytes payload, need 28
    const mp4aBox = new Uint8Array(mp4aBoxSize);
    const mp4aView = new DataView(mp4aBox.buffer);
    mp4aView.setUint32(0, mp4aBoxSize, false);
    mp4aBox[4] = 0x6d;
    mp4aBox[5] = 0x70;
    mp4aBox[6] = 0x34;
    mp4aBox[7] = 0x61; // 'mp4a'

    const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
    const stsdView = new DataView(stsdPayload.buffer);
    stsdView.setUint32(4, 1, false);
    stsdPayload.set(mp4aBox, 8);

    expect(() => parseStsd(stsdPayload, new Uint8Array(0))).toThrow(Mp4InvalidBoxError);
  });
});

// ---------------------------------------------------------------------------
// serializeMp4a / serializeStsd
// ---------------------------------------------------------------------------

describe('parseMp4aPayload — Sec-H-3 box count cap', () => {
  it('throws Mp4TooManyBoxesError when mp4a contains more than MAX_BOXES_PER_FILE child boxes', () => {
    // Synthesise an mp4a payload with 11,000 minimal 8-byte child boxes.
    // Each box has size=8 and type='free'. No esds — but the cap fires first.
    const BOX_COUNT = 11_000;
    const CHILD_SIZE = 8;
    const mp4aHeaderSize = 28; // SampleEntry(8) + AudioSampleEntry(20)
    const mp4aPayloadSize = mp4aHeaderSize + BOX_COUNT * CHILD_SIZE;
    const mp4aBoxSize = 8 + mp4aPayloadSize;
    const mp4aBox = new Uint8Array(mp4aBoxSize);
    const mp4aView = new DataView(mp4aBox.buffer);
    mp4aView.setUint32(0, mp4aBoxSize, false);
    mp4aBox[4] = 0x6d;
    mp4aBox[5] = 0x70;
    mp4aBox[6] = 0x34;
    mp4aBox[7] = 0x61; // 'mp4a'
    mp4aView.setUint16(14, 1, false); // data_reference_index
    mp4aView.setUint16(24, 2, false); // channelCount
    mp4aView.setUint32(32, 44100 << 16, false); // sampleRate Q16.16
    // Write 11000 'free' boxes each claiming size=8.
    let off = 8 + mp4aHeaderSize; // position inside mp4aBox (after box header + AudioSampleEntry)
    for (let i = 0; i < BOX_COUNT; i++) {
      mp4aView.setUint32(off, CHILD_SIZE, false);
      mp4aBox[off + 4] = 0x66;
      mp4aBox[off + 5] = 0x72;
      mp4aBox[off + 6] = 0x65;
      mp4aBox[off + 7] = 0x65; // 'free'
      off += CHILD_SIZE;
    }

    // Wrap in stsd payload.
    const stsdPayload = new Uint8Array(8 + mp4aBoxSize);
    const stsdView = new DataView(stsdPayload.buffer);
    stsdView.setUint32(4, 1, false); // entry_count=1
    stsdPayload.set(mp4aBox, 8);

    // boxCount starts at 0; parseStsd with 11000 inner boxes exceeds MAX_BOXES_PER_FILE (10000).
    const boxCount = { value: 0 };
    expect(() => parseStsd(stsdPayload, new Uint8Array(0), boxCount)).toThrow(Mp4TooManyBoxesError);
  });
});

describe('serializeMp4a', () => {
  it('produces a box with the correct type "mp4a"', () => {
    const entry = {
      channelCount: 2,
      sampleSize: 16,
      sampleRate: 44100,
      decoderSpecificInfo: new Uint8Array([0x12, 0x10]),
      objectTypeIndication: 0x40,
    };
    const esdsBytes = new Uint8Array([0x00, 0x01, 0x02]); // minimal placeholder
    const bytes = serializeMp4a(entry, esdsBytes);
    expect(bytes[4]).toBe(0x6d); // 'm'
    expect(bytes[5]).toBe(0x70); // 'p'
    expect(bytes[6]).toBe(0x34); // '4'
    expect(bytes[7]).toBe(0x61); // 'a'
  });
});

describe('serializeStsd', () => {
  it('produces a box with entry_count=1', () => {
    const mp4aBytes = new Uint8Array(10);
    const bytes = serializeStsd(mp4aBytes);
    const view = new DataView(bytes.buffer);
    // entry_count at offset 12 (8 box header + 4 fullbox prefix)
    expect(view.getUint32(12, false)).toBe(1);
  });
});
