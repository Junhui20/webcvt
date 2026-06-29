import { describe, expect, it } from 'vitest';
import { buildName, buildSampleFont, buildSfnt } from './_test-helpers/build-sfnt.ts';
import { readFontMeta } from './font-meta.ts';
import type { SfntFont } from './model.ts';
import { parseSfnt } from './sfnt.ts';

describe('readFontMeta', () => {
  it('reads family/subfamily/full names plus unitsPerEm and numGlyphs', () => {
    const font = parseSfnt(
      buildSampleFont({ unitsPerEm: 2048, numGlyphs: 7, family: 'Acme Sans' }),
    );
    const meta = readFontMeta(font);
    expect(meta.familyName).toBe('Acme Sans');
    expect(meta.subfamilyName).toBe('Regular');
    expect(meta.fullName).toBe('Acme Sans Regular');
    expect(meta.unitsPerEm).toBe(2048);
    expect(meta.numGlyphs).toBe(7);
  });

  it('returns an empty object when head/maxp/name are all missing', () => {
    const font: SfntFont = {
      flavor: 0x00010000,
      tables: [{ tag: 'cmap', data: new Uint8Array(4) }],
    };
    expect(readFontMeta(font)).toEqual({});
  });

  it('prefers a Windows record over a Macintosh record for the same name ID', () => {
    const name = buildName([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 1, value: 'MacFamily' },
      { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 1, value: 'WinFamily' },
    ]);
    const font = parseSfnt(buildSfnt([{ tag: 'name', data: name }]));
    expect(readFontMeta(font).familyName).toBe('WinFamily');
  });

  it('decodes a Macintosh (single-byte) name when no Windows record exists', () => {
    const name = buildName([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 4, value: 'MacOnly' },
    ]);
    const font = parseSfnt(buildSfnt([{ tag: 'name', data: name }]));
    expect(readFontMeta(font).fullName).toBe('MacOnly');
  });

  it('tolerates a truncated head table', () => {
    const font: SfntFont = {
      flavor: 0x00010000,
      tables: [{ tag: 'head', data: new Uint8Array(4) }],
    };
    expect(readFontMeta(font).unitsPerEm).toBeUndefined();
  });

  it('tolerates a truncated name table without throwing', () => {
    // A name header claiming 3 records but with no record bytes following.
    const truncated = new Uint8Array(6);
    new DataView(truncated.buffer).setUint16(2, 3, false);
    const font: SfntFont = { flavor: 0x00010000, tables: [{ tag: 'name', data: truncated }] };
    expect(() => readFontMeta(font)).not.toThrow();
    expect(readFontMeta(font).familyName).toBeUndefined();
  });

  it('ignores a name record whose string runs past the table end', () => {
    // Build a valid table then shrink it so the string storage is out of bounds.
    const name = buildName([
      { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 1, value: 'Family' },
    ]);
    const clipped = name.subarray(0, name.length - 2);
    const font: SfntFont = { flavor: 0x00010000, tables: [{ tag: 'name', data: clipped }] };
    expect(readFontMeta(font).familyName).toBeUndefined();
  });
});
