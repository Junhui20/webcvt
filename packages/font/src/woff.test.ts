import { describe, expect, it } from 'vitest';
import { buildRawWoff, buildSampleFont } from './_test-helpers/build-sfnt.ts';
import { deflate } from './compression.ts';
import { WOFF_TABLE_RECORD_SIZE } from './constants.ts';
import {
  FontDecompressionError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';
import type { SfntFont, SfntTable } from './model.ts';
import { parseSfnt, serializeSfnt } from './sfnt.ts';
import { parseWoff, serializeWoff } from './woff.ts';

function tableMap(font: SfntFont): Map<string, number[]> {
  return new Map(font.tables.map((t) => [t.tag, Array.from(t.data)]));
}

describe('serializeWoff / parseWoff round-trip', () => {
  it('preserves flavor, table tags, and table bytes through sfnt → woff → sfnt', async () => {
    const sfnt = parseSfnt(buildSampleFont({ flavor: 0x00010000 }));
    const woff = await serializeWoff(sfnt);
    const back = await parseWoff(woff);
    expect(back.flavor).toBe(0x00010000);
    expect(tableMap(back)).toEqual(tableMap(sfnt));
  });

  it('preserves an OTTO (CFF) flavor', async () => {
    const sfnt = parseSfnt(buildSampleFont({ flavor: 0x4f54544f }));
    const back = await parseWoff(await serializeWoff(sfnt));
    expect(back.flavor).toBe(0x4f54544f);
  });

  it('compresses a compressible table and inflates it back exactly', async () => {
    const big: SfntTable = { tag: 'BIG ', data: new Uint8Array(4096) }; // all zeros: very compressible
    const font: SfntFont = { flavor: 0x00010000, tables: [big] };
    const woff = await serializeWoff(font);
    // compLength (at directory entry offset 44+8) must be < origLength for a zero table.
    const v = new DataView(woff.buffer);
    const compLength = v.getUint32(44 + 8, false);
    const origLength = v.getUint32(44 + 12, false);
    expect(compLength).toBeLessThan(origLength);
    const back = await parseWoff(woff);
    expect(Array.from(back.tables[0]?.data ?? [])).toEqual(Array.from(big.data));
  });

  it('stores an incompressible table uncompressed (compLength === origLength)', async () => {
    const tiny: SfntTable = { tag: 'TINY', data: new Uint8Array([0x12, 0x34, 0x56]) };
    const woff = await serializeWoff({ flavor: 0x00010000, tables: [tiny] });
    const v = new DataView(woff.buffer);
    expect(v.getUint32(44 + 8, false)).toBe(v.getUint32(44 + 12, false));
    const back = await parseWoff(woff);
    expect(Array.from(back.tables[0]?.data ?? [])).toEqual([0x12, 0x34, 0x56]);
  });

  it('round-trips through woff → sfnt (serializeSfnt) and back', async () => {
    // Use the canonical sfnt as the baseline — serializeSfnt recomputes
    // head.checkSumAdjustment, so compare normalised forms.
    const sfnt = parseSfnt(serializeSfnt(parseSfnt(buildSampleFont())));
    const rebuiltSfnt = serializeSfnt(await parseWoff(await serializeWoff(sfnt)));
    expect(tableMap(parseSfnt(rebuiltSfnt))).toEqual(tableMap(sfnt));
  });
});

describe('parseWoff validation', () => {
  it('rejects input shorter than the WOFF header', async () => {
    await expect(parseWoff(new Uint8Array(10))).rejects.toThrow(FontMalformedError);
  });

  it('rejects a WOFF2 signature with a typed error', async () => {
    const woff = buildRawWoff({
      signature: 0x774f4632,
      entries: [{ tag: 'head', data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontWoff2NotSupportedError);
  });

  it('rejects an unrecognised signature', async () => {
    const woff = buildRawWoff({
      signature: 0x12345678,
      entries: [{ tag: 'head', data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontInvalidSignatureError);
  });

  it('rejects an absurd table count', async () => {
    const woff = buildRawWoff({
      numTablesField: 99999,
      entries: [{ tag: 'head', data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontTooManyTablesError);
  });

  it('rejects zero tables', async () => {
    const woff = buildRawWoff({
      numTablesField: 0,
      entries: [{ tag: 'head', data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontMalformedError);
  });

  it('rejects a directory that runs past the end of the input', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', data: new Uint8Array(4) }],
      truncateTo: 50, // 44 + 20 = 64 needed
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontMalformedError);
  });

  it('rejects an origLength above the per-table cap', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', origLength: 0x7fffffff, compLength: 4, data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontTableTooLargeError);
  });

  it('rejects a compLength above the per-table cap', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', origLength: 4, compLength: 0x7fffffff, data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontTableTooLargeError);
  });

  it('rejects a table offset overlapping the header/directory', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', offset: 10, data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontMalformedError);
  });

  it('rejects a table whose data extends past the end', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', compLength: 100, origLength: 100, data: new Uint8Array(4) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontMalformedError);
  });

  it('rejects compLength greater than origLength', async () => {
    const woff = buildRawWoff({
      entries: [{ tag: 'head', compLength: 8, origLength: 4, data: new Uint8Array(8) }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontMalformedError);
  });

  it('reads a stored (uncompressed) table where compLength === origLength', async () => {
    const woff = buildRawWoff({ entries: [{ tag: 'maxp', data: new Uint8Array([1, 2, 3, 4]) }] });
    const font = await parseWoff(woff);
    expect(Array.from(font.tables[0]?.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('rejects a table that decompresses larger than its declared origLength', async () => {
    const payload = new Uint8Array(200); // zeros: compresses small
    const compressed = await deflate(payload);
    const woff = buildRawWoff({
      entries: [{ tag: 'glyf', compLength: compressed.length, origLength: 50, data: compressed }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontTableTooLargeError);
  });

  it('rejects a table whose decompressed length disagrees with origLength', async () => {
    const payload = new Uint8Array(200);
    const compressed = await deflate(payload);
    const woff = buildRawWoff({
      entries: [{ tag: 'glyf', compLength: compressed.length, origLength: 300, data: compressed }],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontDecompressionError);
  });

  it('wraps invalid zlib data in a typed decompression error', async () => {
    const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]);
    const woff = buildRawWoff({
      entries: [
        { tag: 'glyf', compLength: garbage.length, origLength: garbage.length + 10, data: garbage },
      ],
    });
    await expect(parseWoff(woff)).rejects.toThrow(FontDecompressionError);
  });
});

describe('serializeWoff validation', () => {
  it('rejects serializing zero tables', async () => {
    await expect(serializeWoff({ flavor: 0x00010000, tables: [] })).rejects.toThrow(
      FontMalformedError,
    );
  });

  it('rejects serializing more than the table cap', async () => {
    const tables = Array.from({ length: 4097 }, () => ({ tag: 'AAAA', data: new Uint8Array(2) }));
    await expect(serializeWoff({ flavor: 0x00010000, tables })).rejects.toThrow(
      FontTooManyTablesError,
    );
  });

  it('lays out the directory with 20-byte records', async () => {
    const sfnt = parseSfnt(buildSampleFont());
    const woff = await serializeWoff(sfnt);
    const v = new DataView(woff.buffer);
    const numTables = v.getUint16(12, false);
    expect(numTables).toBe(sfnt.tables.length);
    // first table body must start at/after the directory end
    const firstOffset = v.getUint32(44 + 4, false);
    expect(firstOffset).toBeGreaterThanOrEqual(44 + numTables * WOFF_TABLE_RECORD_SIZE);
  });
});
