/**
 * Synthetic sfnt builders for tests only. NOT part of the shipped package and
 * excluded from coverage. These build minimal but structurally valid sfnt
 * containers (offset table + directory + 4-byte-padded tables) with small
 * head / maxp / name tables — enough to exercise parse/serialize/checksum
 * without any real glyph data.
 */

export interface TableSpec {
  readonly tag: string;
  readonly data: Uint8Array;
}

export interface NameRecordSpec {
  readonly platformID: number;
  readonly encodingID: number;
  readonly languageID: number;
  readonly nameID: number;
  readonly value: string;
}

const SFNT_VERSION_TRUETYPE = 0x00010000;

/** Round n up to a multiple of 4. */
function pad4(n: number): number {
  return (n + 3) & ~3;
}

/** Build a structurally valid sfnt from a flavor and a set of tables. */
export function buildSfnt(tables: TableSpec[], flavor = SFNT_VERSION_TRUETYPE): Uint8Array {
  const numTables = tables.length;
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const dirEnd = 12 + numTables * 16;
  let cursor = dirEnd;
  const entries = sorted.map((t) => {
    const length = t.data.length;
    const padded = pad4(length);
    const entry = { tag: t.tag, data: t.data, offset: cursor, length, padded };
    cursor += padded;
    return entry;
  });

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor >>> 0, false);
  view.setUint16(4, numTables, false);
  view.setUint16(6, 16, false); // searchRange (loose)
  view.setUint16(8, 0, false); // entrySelector (loose)
  view.setUint16(10, Math.max(0, numTables * 16 - 16), false); // rangeShift (loose)

  for (const [i, e] of entries.entries()) {
    const recOff = 12 + i * 16;
    for (let k = 0; k < 4; k += 1) {
      out[recOff + k] = k < e.tag.length ? e.tag.charCodeAt(k) & 0xff : 0x20;
    }
    view.setUint32(recOff + 4, 0, false); // checksum (parseSfnt ignores it)
    view.setUint32(recOff + 8, e.offset, false);
    view.setUint32(recOff + 12, e.length, false);
    out.set(e.data, e.offset);
  }

  return out;
}

/** Build a 54-byte head table (the minimum valid size). */
export function buildHead(unitsPerEm = 1000, checkSumAdjustment = 0): Uint8Array {
  const head = new Uint8Array(54);
  const v = new DataView(head.buffer);
  v.setUint32(0, 0x00010000, false); // version 1.0
  v.setUint32(4, 0x00010000, false); // fontRevision 1.0
  v.setUint32(8, checkSumAdjustment >>> 0, false); // checkSumAdjustment
  v.setUint32(12, 0x5f0f3cf5, false); // magicNumber
  v.setUint16(16, 0, false); // flags
  v.setUint16(18, unitsPerEm, false); // unitsPerEm
  // created/modified (8+8), bbox (8), macStyle, lowestRecPPEM, fontDirectionHint,
  // indexToLocFormat, glyphDataFormat all left zero.
  return head;
}

/** Build a 6-byte maxp table (version 0.5). */
export function buildMaxp(numGlyphs = 1): Uint8Array {
  const maxp = new Uint8Array(6);
  const v = new DataView(maxp.buffer);
  v.setUint32(0, 0x00005000, false); // version 0.5
  v.setUint16(4, numGlyphs, false);
  return maxp;
}

function encodeNameValue(value: string, platformID: number): Uint8Array {
  if (platformID === 3 || platformID === 0) {
    const buf = new Uint8Array(value.length * 2);
    for (let i = 0; i < value.length; i += 1) {
      const c = value.charCodeAt(i);
      buf[i * 2] = (c >> 8) & 0xff;
      buf[i * 2 + 1] = c & 0xff;
    }
    return buf;
  }
  const buf = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    buf[i] = value.charCodeAt(i) & 0xff;
  }
  return buf;
}

/** Build a format-0 name table from a list of name records. */
export function buildName(records: NameRecordSpec[]): Uint8Array {
  const encoded = records.map((r) => ({ spec: r, bytes: encodeNameValue(r.value, r.platformID) }));
  const recordCount = encoded.length;
  const headerSize = 6 + recordCount * 12;

  let storageLen = 0;
  const offsets: number[] = [];
  for (const e of encoded) {
    offsets.push(storageLen);
    storageLen += e.bytes.length;
  }

  const out = new Uint8Array(headerSize + storageLen);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, false); // format 0
  v.setUint16(2, recordCount, false);
  v.setUint16(4, headerSize, false); // stringOffset

  for (let i = 0; i < recordCount; i += 1) {
    const e = encoded[i];
    const strOffset = offsets[i];
    if (e === undefined || strOffset === undefined) continue;
    const off = 6 + i * 12;
    v.setUint16(off, e.spec.platformID, false);
    v.setUint16(off + 2, e.spec.encodingID, false);
    v.setUint16(off + 4, e.spec.languageID, false);
    v.setUint16(off + 6, e.spec.nameID, false);
    v.setUint16(off + 8, e.bytes.length, false);
    v.setUint16(off + 10, strOffset, false);
    out.set(e.bytes, headerSize + strOffset);
  }

  return out;
}

export interface RawWoffEntry {
  readonly tag: string;
  /** Explicit body offset; defaults to sequential placement after the directory. */
  readonly offset?: number;
  /** Explicit compLength field; defaults to data.length. */
  readonly compLength?: number;
  /** Explicit origLength field; defaults to data.length. */
  readonly origLength?: number;
  readonly data: Uint8Array;
}

const WOFF_SIGNATURE = 0x774f4646;

/**
 * Build a raw WOFF container with full control over header/directory fields, for
 * negative-path tests. By default bodies are placed sequentially, padded to 4.
 */
export function buildRawWoff(opts: {
  signature?: number;
  flavor?: number;
  numTablesField?: number;
  entries: RawWoffEntry[];
  truncateTo?: number;
}): Uint8Array {
  const entries = opts.entries;
  const numTables = entries.length;
  const dirEnd = 44 + numTables * 20;

  let cursor = dirEnd;
  const placed = entries.map((e) => {
    const offset = e.offset ?? cursor;
    cursor = Math.max(cursor, offset + pad4(e.data.length));
    return { entry: e, offset };
  });

  const total = opts.truncateTo ?? cursor;
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint32(0, (opts.signature ?? WOFF_SIGNATURE) >>> 0, false);
  v.setUint32(4, (opts.flavor ?? SFNT_VERSION_TRUETYPE) >>> 0, false);
  v.setUint32(8, total, false);
  v.setUint16(12, opts.numTablesField ?? numTables, false);
  v.setUint16(14, 0, false);
  v.setUint32(16, 0, false);

  for (let i = 0; i < numTables; i += 1) {
    const p = placed[i];
    if (p === undefined) continue;
    const { entry, offset } = p;
    const recOff = 44 + i * 20;
    // Skip records that do not fit a deliberately-truncated buffer (the point of
    // those fixtures is a directory that runs past the end — parseWoff rejects it).
    if (recOff + 20 > total) continue;
    for (let k = 0; k < 4; k += 1) {
      buf[recOff + k] = k < entry.tag.length ? entry.tag.charCodeAt(k) & 0xff : 0x20;
    }
    v.setUint32(recOff + 4, offset, false);
    v.setUint32(recOff + 8, entry.compLength ?? entry.data.length, false);
    v.setUint32(recOff + 12, entry.origLength ?? entry.data.length, false);
    v.setUint32(recOff + 16, 0, false);
    if (offset + entry.data.length <= total) buf.set(entry.data, offset);
  }

  return buf;
}

/** A convenient three-table font: head + maxp + name. */
export function buildSampleFont(
  options: { flavor?: number; unitsPerEm?: number; numGlyphs?: number; family?: string } = {},
): Uint8Array {
  const {
    flavor = SFNT_VERSION_TRUETYPE,
    unitsPerEm = 2048,
    numGlyphs = 5,
    family = 'Test Sans',
  } = options;
  return buildSfnt(
    [
      { tag: 'head', data: buildHead(unitsPerEm) },
      { tag: 'maxp', data: buildMaxp(numGlyphs) },
      {
        tag: 'name',
        data: buildName([
          { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 1, value: family },
          { platformID: 3, encodingID: 1, languageID: 0x409, nameID: 2, value: 'Regular' },
          {
            platformID: 3,
            encodingID: 1,
            languageID: 0x409,
            nameID: 4,
            value: `${family} Regular`,
          },
        ]),
      },
    ],
    flavor,
  );
}
