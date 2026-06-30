/**
 * Real-file regression test: a genuine TrueType font (Ubuntu Mono) committed
 * under tests/fixtures/font/. Unlike the synthetic builders, this exercises the
 * sfnt parser + WOFF round-trip on a real, full-size, encoder-produced font.
 */
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { parseSfnt, parseWoff, readFontMeta, serializeWoff } from './index.ts';

const FIXTURE = 'font/UbuntuMono-R.ttf';

describe('font — REAL fixture (UbuntuMono-R.ttf, TrueType/glyf)', () => {
  it('parses the real TTF and reads its name/head tables', async () => {
    const ttf = await loadFixture(FIXTURE);
    const sfnt = parseSfnt(ttf);
    expect(sfnt.flavor).toBe(0x00010000); // TrueType sfnt version
    const tags = sfnt.tables.map((t) => t.tag);
    expect(tags).toContain('glyf');
    expect(tags).toContain('cmap');
    expect(tags).toContain('head');
    const meta = readFontMeta(sfnt);
    expect(meta.familyName ?? '').toMatch(/ubuntu/i);
    expect(meta.unitsPerEm ?? 0).toBeGreaterThan(0);
  });

  it('round-trips the real TTF through WOFF losslessly (every table byte preserved)', async () => {
    const ttf = await loadFixture(FIXTURE);
    const sfnt = parseSfnt(ttf);
    const woff = await serializeWoff(sfnt);
    expect(woff.length).toBeLessThan(ttf.length); // WOFF deflates the tables
    const back = await parseWoff(woff);
    expect(back.flavor).toBe(sfnt.flavor);
    expect(back.tables.map((t) => t.tag).sort()).toEqual(sfnt.tables.map((t) => t.tag).sort());
    for (const t of sfnt.tables) {
      const r = back.tables.find((x) => x.tag === t.tag);
      expect(r && Array.from(r.data)).toEqual(Array.from(t.data));
    }
  });
});
