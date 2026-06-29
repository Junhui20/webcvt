/**
 * Best-effort font metadata extraction from the `name`, `head`, and `maxp`
 * tables. Everything here tolerates missing or truncated tables — a field is
 * simply omitted when it cannot be read. Nothing in this module throws.
 *
 * References: OpenType `name` table (formats 0 and 1), `head` (unitsPerEm at
 * offset 18), `maxp` (numGlyphs at offset 4).
 */

import type { FontMeta, SfntFont } from './model.ts';

// name IDs of interest (OpenType "Name IDs").
const NAME_ID_FAMILY = 1;
const NAME_ID_SUBFAMILY = 2;
const NAME_ID_FULL = 4;

const NAME_RECORD_SIZE = 12;

/** Read a big-endian u16 at `off`, or undefined if out of bounds. */
function readU16(data: Uint8Array, off: number): number | undefined {
  if (off < 0 || off + 2 > data.length) return undefined;
  return ((data[off] ?? 0) << 8) | (data[off + 1] ?? 0);
}

function findTable(font: SfntFont, tag: string): Uint8Array | undefined {
  for (const table of font.tables) {
    if (table.tag === tag) return table.data;
  }
  return undefined;
}

/**
 * Decode a name string. Windows (platformID 3) and Unicode (platformID 0)
 * records are UTF-16BE; Macintosh (platformID 1) and others are treated as a
 * single-byte ASCII/Latin-1 superset (best-effort).
 */
function decodeNameString(slice: Uint8Array, platformID: number): string {
  if (platformID === 3 || platformID === 0) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(slice);
  }
  let out = '';
  for (let i = 0; i < slice.length; i += 1) {
    out += String.fromCharCode(slice[i] ?? 0);
  }
  return out;
}

/** Preference score: prefer Windows, then Unicode, then Macintosh, then other. */
function platformScore(platformID: number): number {
  if (platformID === 3) return 3;
  if (platformID === 0) return 2;
  if (platformID === 1) return 1;
  return 0;
}

interface Candidate {
  score: number;
  value: string;
}

/**
 * Parse the `name` table (format 0 or 1) and return the best candidate string
 * for each of the family/subfamily/full name IDs.
 */
function readNameTable(name: Uint8Array): {
  family?: string;
  subfamily?: string;
  full?: string;
} {
  const count = readU16(name, 2);
  const stringOffset = readU16(name, 4);
  if (count === undefined || stringOffset === undefined) return {};

  const best = new Map<number, Candidate>();

  for (let i = 0; i < count; i += 1) {
    const recOff = 6 + i * NAME_RECORD_SIZE;
    if (recOff + NAME_RECORD_SIZE > name.length) break;

    const platformID = readU16(name, recOff) ?? 0;
    const nameID = readU16(name, recOff + 6) ?? 0;
    if (nameID !== NAME_ID_FAMILY && nameID !== NAME_ID_SUBFAMILY && nameID !== NAME_ID_FULL) {
      continue;
    }

    const length = readU16(name, recOff + 8) ?? 0;
    const strOff = readU16(name, recOff + 10) ?? 0;
    const start = stringOffset + strOff;
    const end = start + length;
    if (end > name.length) continue;

    const value = decodeNameString(name.subarray(start, end), platformID);
    const score = platformScore(platformID);
    const existing = best.get(nameID);
    if (existing === undefined || score > existing.score) {
      best.set(nameID, { score, value });
    }
  }

  return {
    family: best.get(NAME_ID_FAMILY)?.value,
    subfamily: best.get(NAME_ID_SUBFAMILY)?.value,
    full: best.get(NAME_ID_FULL)?.value,
  };
}

/**
 * Read best-effort metadata from a parsed font. Missing tables yield undefined
 * fields rather than errors.
 */
export function readFontMeta(font: SfntFont): FontMeta {
  const meta: {
    familyName?: string;
    subfamilyName?: string;
    fullName?: string;
    unitsPerEm?: number;
    numGlyphs?: number;
  } = {};

  const head = findTable(font, 'head');
  if (head !== undefined) {
    const unitsPerEm = readU16(head, 18);
    if (unitsPerEm !== undefined) meta.unitsPerEm = unitsPerEm;
  }

  const maxp = findTable(font, 'maxp');
  if (maxp !== undefined) {
    const numGlyphs = readU16(maxp, 4);
    if (numGlyphs !== undefined) meta.numGlyphs = numGlyphs;
  }

  const name = findTable(font, 'name');
  if (name !== undefined) {
    const names = readNameTable(name);
    if (names.family !== undefined) meta.familyName = names.family;
    if (names.subfamily !== undefined) meta.subfamilyName = names.subfamily;
    if (names.full !== undefined) meta.fullName = names.full;
  }

  return meta;
}
