import { describe, expect, it } from 'vitest';
import { buildHead, buildMaxp, buildSampleFont, buildSfnt } from './_test-helpers/build-sfnt.ts';
import { HEAD_CHECKSUM_MAGIC } from './constants.ts';
import {
  FontCollectionNotSupportedError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';
import type { SfntFont } from './model.ts';
import {
  computeChecksum,
  flavorToExt,
  isKnownSfntFlavor,
  parseSfnt,
  serializeSfnt,
} from './sfnt.ts';

/** Build a 12-byte (or longer) raw sfnt header for negative tests. */
function rawHeader(flavor: number, numTables: number, totalLen = 12): Uint8Array {
  const buf = new Uint8Array(Math.max(totalLen, 12));
  const v = new DataView(buf.buffer);
  v.setUint32(0, flavor >>> 0, false);
  v.setUint16(4, numTables, false);
  return buf;
}

describe('parseSfnt', () => {
  it('parses a valid TrueType sfnt and exposes tables in tag order', () => {
    const font = parseSfnt(buildSampleFont());
    expect(font.flavor).toBe(0x00010000);
    const tags = font.tables.map((t) => t.tag);
    expect(tags).toContain('head');
    expect(tags).toContain('maxp');
    expect(tags).toContain('name');
    const head = font.tables.find((t) => t.tag === 'head');
    expect(head?.data.length).toBe(54);
  });

  it('exposes table data as a zero-copy subarray of the input', () => {
    const bytes = buildSampleFont();
    const font = parseSfnt(bytes);
    const head = font.tables.find((t) => t.tag === 'head');
    expect(head?.data.buffer).toBe(bytes.buffer);
  });

  it('rejects input shorter than the offset table', () => {
    expect(() => parseSfnt(new Uint8Array(4))).toThrow(FontMalformedError);
  });

  it('rejects a TrueType/OpenType Collection (ttcf)', () => {
    expect(() => parseSfnt(rawHeader(0x74746366, 1))).toThrow(FontCollectionNotSupportedError);
  });

  it('rejects a WOFF2 signature with a typed error', () => {
    expect(() => parseSfnt(rawHeader(0x774f4632, 1))).toThrow(FontWoff2NotSupportedError);
  });

  it('rejects a WOFF container passed to parseSfnt', () => {
    expect(() => parseSfnt(rawHeader(0x774f4646, 1))).toThrow(FontMalformedError);
  });

  it('rejects an unknown sfnt version', () => {
    expect(() => parseSfnt(rawHeader(0x12345678, 1))).toThrow(FontInvalidSignatureError);
  });

  it('rejects an absurd table count', () => {
    expect(() => parseSfnt(rawHeader(0x00010000, 99999))).toThrow(FontTooManyTablesError);
  });

  it('rejects zero tables', () => {
    expect(() => parseSfnt(rawHeader(0x00010000, 0))).toThrow(FontMalformedError);
  });

  it('rejects a directory that runs past the end of the input', () => {
    // numTables = 3 needs 12 + 48 = 60 bytes; supply only 20.
    expect(() => parseSfnt(rawHeader(0x00010000, 3, 20))).toThrow(FontMalformedError);
  });

  it('rejects a table whose declared length exceeds the per-table cap', () => {
    const buf = rawHeader(0x00010000, 1, 12 + 16);
    const v = new DataView(buf.buffer);
    // record: tag, checksum, offset, length
    v.setUint32(12, 0x68656164, false); // 'head'
    v.setUint32(12 + 8, 28, false); // offset (past dir)
    v.setUint32(12 + 12, 0x7fffffff, false); // absurd length
    expect(() => parseSfnt(buf)).toThrow(FontTableTooLargeError);
  });

  it('rejects a table offset that overlaps the header/directory', () => {
    const buf = rawHeader(0x00010000, 1, 12 + 16 + 4);
    const v = new DataView(buf.buffer);
    v.setUint32(12, 0x68656164, false);
    v.setUint32(12 + 8, 4, false); // offset inside the header
    v.setUint32(12 + 12, 4, false);
    expect(() => parseSfnt(buf)).toThrow(FontMalformedError);
  });

  it('rejects a table whose data extends past the end of the input', () => {
    const buf = rawHeader(0x00010000, 1, 12 + 16 + 4);
    const v = new DataView(buf.buffer);
    v.setUint32(12, 0x68656164, false);
    v.setUint32(12 + 8, 28, false); // offset at dir end
    v.setUint32(12 + 12, 100, false); // length beyond buffer
    expect(() => parseSfnt(buf)).toThrow(FontMalformedError);
  });
});

describe('serializeSfnt', () => {
  it('round-trips tags and bytes through parse → serialize → parse', () => {
    // Compare against the CANONICAL form: serializeSfnt legitimately recomputes
    // head.checkSumAdjustment, so the first serialize normalises it; a second
    // round-trip must then be byte-identical (serialize is idempotent here).
    const original = parseSfnt(serializeSfnt(parseSfnt(buildSampleFont())));
    const rebuilt = parseSfnt(serializeSfnt(original));
    const byTag = (f: SfntFont) => new Map(f.tables.map((t) => [t.tag, t.data]));
    const a = byTag(original);
    const b = byTag(rebuilt);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [tag, data] of a) {
      expect(Array.from(b.get(tag) ?? [])).toEqual(Array.from(data));
    }
  });

  it('recomputes head.checkSumAdjustment so the whole-file checksum equals the magic', () => {
    const font = parseSfnt(buildSampleFont());
    const out = serializeSfnt(font);
    expect(computeChecksum(out, 0, out.length)).toBe(HEAD_CHECKSUM_MAGIC);
  });

  it('serializes a font without a head table (no checkSumAdjustment write)', () => {
    const font: SfntFont = {
      flavor: 0x00010000,
      tables: [{ tag: 'maxp', data: buildMaxp(3) }],
    };
    const out = serializeSfnt(font);
    const reparsed = parseSfnt(out);
    expect(reparsed.tables.map((t) => t.tag)).toEqual(['maxp']);
  });

  it('rejects serializing zero tables', () => {
    expect(() => serializeSfnt({ flavor: 0x00010000, tables: [] })).toThrow(FontMalformedError);
  });

  it('rejects serializing more than the table cap', () => {
    const tables = Array.from({ length: 4097 }, (_, i) => ({
      tag: `t${i}`.padEnd(4, ' ').slice(0, 4),
      data: new Uint8Array(2),
    }));
    expect(() => serializeSfnt({ flavor: 0x00010000, tables })).toThrow(FontTooManyTablesError);
  });

  it('pads unaligned tables to a 4-byte boundary', () => {
    const font: SfntFont = {
      flavor: 0x00010000,
      tables: [
        { tag: 'head', data: buildHead() },
        { tag: 'test', data: new Uint8Array([1, 2, 3]) }, // length 3 → padded to 4
      ],
    };
    const out = serializeSfnt(font);
    // total = 12 + 2*16 + pad4(54) + pad4(3) = 12 + 32 + 56 + 4 = 104
    expect(out.length).toBe(104);
  });
});

describe('computeChecksum', () => {
  it('sums big-endian u32 words', () => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02]);
    expect(computeChecksum(data, 0, 8)).toBe(3);
  });

  it('zero-pads a trailing partial word', () => {
    // [0x00,0x00,0x00,0x01, 0xFF] → 1 + (0xFF000000) = 0xFF000001
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0xff]);
    expect(computeChecksum(data, 0, 5)).toBe(0xff000001);
  });

  it('wraps modulo 2^32', () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x02]);
    expect(computeChecksum(data, 0, 8)).toBe(1);
  });
});

describe('flavorToExt / isKnownSfntFlavor', () => {
  it('maps OTTO to otf and everything else to ttf', () => {
    expect(flavorToExt(0x4f54544f)).toBe('otf');
    expect(flavorToExt(0x00010000)).toBe('ttf');
    expect(flavorToExt(0x74727565)).toBe('ttf');
  });

  it('recognises the known sfnt flavors', () => {
    expect(isKnownSfntFlavor(0x00010000)).toBe(true);
    expect(isKnownSfntFlavor(0x4f54544f)).toBe(true);
    expect(isKnownSfntFlavor(0x74727565)).toBe(true);
    expect(isKnownSfntFlavor(0x74797031)).toBe(true);
    expect(isKnownSfntFlavor(0xdeadbeef)).toBe(false);
  });
});
