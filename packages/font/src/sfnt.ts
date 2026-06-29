/**
 * sfnt (TTF/OTF) container parsing and serialisation.
 *
 * An sfnt file is: a 12-byte offset table (sfnt version + numTables + three
 * binary-search hint fields) followed by a table directory of 16-byte records
 * (tag, checksum, offset, length), followed by the table data — each table
 * padded to a 4-byte boundary. See ISO/IEC 14496-22 / the Microsoft OpenType
 * spec ("Organization of an OpenType Font" and "Table Directory").
 *
 * Clean-room implementation from the specification.
 */

import {
  HEAD_CHECKSUM_ADJUSTMENT_OFFSET,
  HEAD_CHECKSUM_MAGIC,
  MAX_TABLES,
  MAX_TABLE_BYTES,
  SFNT_FLAVOR_OTTO,
  SFNT_FLAVOR_TRUE,
  SFNT_FLAVOR_TTCF,
  SFNT_FLAVOR_TYP1,
  SFNT_HEADER_SIZE,
  SFNT_TABLE_RECORD_SIZE,
  SFNT_VERSION_TRUETYPE,
  WOFF2_SIGNATURE,
  WOFF_SIGNATURE,
} from './constants.ts';
import {
  FontCollectionNotSupportedError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';
import type { SfntFont, SfntTable } from './model.ts';

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

/** Read a 4-byte tag at `off` as an ASCII string (bytes mapped 1:1). */
export function readTag(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(
    bytes[off] ?? 0,
    bytes[off + 1] ?? 0,
    bytes[off + 2] ?? 0,
    bytes[off + 3] ?? 0,
  );
}

/** Write a 4-byte tag, right-padded with spaces (0x20) if shorter than 4. */
export function writeTag(out: Uint8Array, off: number, tag: string): void {
  for (let i = 0; i < 4; i += 1) {
    out[off + i] = i < tag.length ? tag.charCodeAt(i) & 0xff : 0x20;
  }
}

/** Round `n` up to the next multiple of 4 (sfnt / WOFF table padding). */
export function padTo4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * The sfnt table checksum: the sum (mod 2^32) of the table's bytes read as
 * big-endian u32 words, with the final partial word zero-padded. Computed over
 * the half-open byte range [start, end). The whole-file checksum (for
 * head.checkSumAdjustment) uses the same routine over [0, fileLength).
 */
export function computeChecksum(data: Uint8Array, start: number, end: number): number {
  let sum = 0;
  let i = start;
  for (; i + 4 <= end; i += 4) {
    const word =
      (((data[i] ?? 0) << 24) |
        ((data[i + 1] ?? 0) << 16) |
        ((data[i + 2] ?? 0) << 8) |
        (data[i + 3] ?? 0)) >>>
      0;
    sum = (sum + word) >>> 0;
  }
  if (i < end) {
    // Final partial word: pad missing low bytes with zero.
    const b0 = data[i] ?? 0;
    const b1 = i + 1 < end ? (data[i + 1] ?? 0) : 0;
    const b2 = i + 2 < end ? (data[i + 2] ?? 0) : 0;
    const word = ((b0 << 24) | (b1 << 16) | (b2 << 8)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum >>> 0;
}

/** Whether `flavor` is a recognised single-font sfnt version. */
export function isKnownSfntFlavor(flavor: number): boolean {
  return (
    flavor === SFNT_VERSION_TRUETYPE ||
    flavor === SFNT_FLAVOR_OTTO ||
    flavor === SFNT_FLAVOR_TRUE ||
    flavor === SFNT_FLAVOR_TYP1
  );
}

/** Output extension implied by an sfnt flavor: 'OTTO' → otf, else → ttf. */
export function flavorToExt(flavor: number): 'ttf' | 'otf' {
  return flavor === SFNT_FLAVOR_OTTO ? 'otf' : 'ttf';
}

/** The three sfnt binary-search hint fields derived from the table count. */
function computeSearchParams(numTables: number): {
  searchRange: number;
  entrySelector: number;
  rangeShift: number;
} {
  let entrySelector = 0;
  let pow = 1; // 2^entrySelector
  while (pow * 2 <= numTables) {
    pow *= 2;
    entrySelector += 1;
  }
  const searchRange = pow * 16;
  const rangeShift = numTables * 16 - searchRange;
  return { searchRange, entrySelector, rangeShift };
}

// ---------------------------------------------------------------------------
// parseSfnt
// ---------------------------------------------------------------------------

/**
 * Parse an sfnt (TTF/OTF) container into a flavor + a list of tables. Table
 * payloads are exposed as zero-copy subarrays of the input. Every table's
 * offset+length is validated to be in-bounds and not to overlap the
 * header/directory.
 */
export function parseSfnt(bytes: Uint8Array): SfntFont {
  if (bytes.length < SFNT_HEADER_SIZE) {
    throw new FontMalformedError('input is shorter than the 12-byte sfnt offset table');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavor = view.getUint32(0, false) >>> 0;

  if (flavor === SFNT_FLAVOR_TTCF) throw new FontCollectionNotSupportedError();
  if (flavor === WOFF2_SIGNATURE) throw new FontWoff2NotSupportedError();
  if (flavor === WOFF_SIGNATURE) {
    throw new FontMalformedError('input is a WOFF container, not an sfnt — use parseWoff');
  }
  if (!isKnownSfntFlavor(flavor)) {
    throw new FontInvalidSignatureError(
      `unknown sfnt version 0x${flavor.toString(16).padStart(8, '0')}`,
    );
  }

  const numTables = view.getUint16(4, false);
  if (numTables > MAX_TABLES) throw new FontTooManyTablesError(numTables, MAX_TABLES);
  if (numTables === 0) throw new FontMalformedError('sfnt declares zero tables');

  const directoryEnd = SFNT_HEADER_SIZE + numTables * SFNT_TABLE_RECORD_SIZE;
  if (directoryEnd > bytes.length) {
    throw new FontMalformedError('sfnt table directory extends past the end of the input');
  }

  // searchRange / entrySelector / rangeShift (offsets 6/8/10) are parsed only
  // loosely: they are redundant binary-search hints, recomputed on serialize.

  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const recOff = SFNT_HEADER_SIZE + i * SFNT_TABLE_RECORD_SIZE;
    const tag = readTag(bytes, recOff);
    // checksum at recOff+4 is recomputed on serialize, not retained here.
    const offset = view.getUint32(recOff + 8, false) >>> 0;
    const length = view.getUint32(recOff + 12, false) >>> 0;

    if (length > MAX_TABLE_BYTES) {
      throw new FontTableTooLargeError(
        `table "${tag}" length ${length} exceeds ${MAX_TABLE_BYTES}`,
      );
    }
    if (offset < directoryEnd) {
      throw new FontMalformedError(
        `table "${tag}" offset ${offset} overlaps the sfnt header/directory`,
      );
    }
    const tableEnd = offset + length;
    if (tableEnd > bytes.length) {
      throw new FontMalformedError(`table "${tag}" data extends past the end of the input`);
    }
    tables.push({ tag, data: bytes.subarray(offset, tableEnd) });
  }

  return { flavor, tables };
}

// ---------------------------------------------------------------------------
// serializeSfnt
// ---------------------------------------------------------------------------

interface SfntLayoutEntry {
  readonly tag: string;
  readonly data: Uint8Array;
  readonly offset: number;
  readonly length: number;
  readonly padded: number;
}

/**
 * Serialise a font into a valid sfnt: directory sorted by tag, every table
 * padded to 4 bytes, table checksums recomputed, and head.checkSumAdjustment
 * recomputed per the OpenType spec (set the field to 0, sum the whole file as
 * big-endian u32 words, then checkSumAdjustment = 0xB1B0AFBA − sum).
 */
export function serializeSfnt(font: SfntFont): Uint8Array {
  const numTables = font.tables.length;
  if (numTables === 0) throw new FontMalformedError('cannot serialize an sfnt with zero tables');
  if (numTables > MAX_TABLES) throw new FontTooManyTablesError(numTables, MAX_TABLES);

  const sorted = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directoryEnd = SFNT_HEADER_SIZE + numTables * SFNT_TABLE_RECORD_SIZE;
  let cursor = directoryEnd;
  const layout: SfntLayoutEntry[] = sorted.map((t) => {
    const length = t.data.length;
    const entry: SfntLayoutEntry = {
      tag: t.tag,
      data: t.data,
      offset: cursor,
      length,
      padded: padTo4(length),
    };
    cursor += entry.padded;
    return entry;
  });

  const totalSize = cursor;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Offset table.
  view.setUint32(0, font.flavor >>> 0, false);
  view.setUint16(4, numTables, false);
  const { searchRange, entrySelector, rangeShift } = computeSearchParams(numTables);
  view.setUint16(6, searchRange, false);
  view.setUint16(8, entrySelector, false);
  view.setUint16(10, rangeShift, false);

  // Table data (padding bytes stay zero).
  let headOffset = -1;
  for (const entry of layout) {
    out.set(entry.data, entry.offset);
    if (entry.tag === 'head') headOffset = entry.offset;
  }

  // Zero head.checkSumAdjustment before any checksum is computed.
  const hasHead = headOffset >= 0 && headOffset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET + 4 <= totalSize;
  if (hasHead) {
    view.setUint32(headOffset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET, 0, false);
  }

  // Directory records, with table checksums computed over the padded region.
  for (const [i, entry] of layout.entries()) {
    const recOff = SFNT_HEADER_SIZE + i * SFNT_TABLE_RECORD_SIZE;
    writeTag(out, recOff, entry.tag);
    const checksum = computeChecksum(out, entry.offset, entry.offset + entry.padded);
    view.setUint32(recOff + 4, checksum, false);
    view.setUint32(recOff + 8, entry.offset, false);
    view.setUint32(recOff + 12, entry.length, false);
  }

  // Whole-file checksum → head.checkSumAdjustment.
  if (hasHead) {
    const fileChecksum = computeChecksum(out, 0, totalSize);
    const adjustment = (HEAD_CHECKSUM_MAGIC - fileChecksum) >>> 0;
    view.setUint32(headOffset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET, adjustment, false);
  }

  return out;
}
