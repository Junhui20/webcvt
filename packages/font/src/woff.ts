/**
 * WOFF 1.0 container parsing and serialisation.
 *
 * A WOFF file is the SAME sfnt tables wrapped in a 44-byte WOFF header + a
 * directory of 20-byte entries (tag, offset, compLength, origLength,
 * origChecksum), followed by the (optionally zlib-compressed) table data — each
 * block padded to a 4-byte boundary. A table is compressed iff
 * compLength < origLength; otherwise it is stored uncompressed. See the WOFF
 * File Format 1.0 W3C Recommendation.
 *
 * Clean-room implementation from the specification. WOFF 2.0 (wOF2) is out of
 * scope (Brotli + glyf-table transform) and is rejected with a typed error.
 */

import { deflate, inflate } from './compression.ts';
import {
  MAX_TABLES,
  MAX_TABLE_BYTES,
  MAX_TOTAL_DECOMPRESSED_BYTES,
  SFNT_HEADER_SIZE,
  SFNT_TABLE_RECORD_SIZE,
  WOFF2_SIGNATURE,
  WOFF_HEADER_SIZE,
  WOFF_SIGNATURE,
  WOFF_TABLE_RECORD_SIZE,
} from './constants.ts';
import {
  FontDecompressionError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';
import type { SfntFont, SfntTable } from './model.ts';
import { computeChecksum, padTo4, readTag, writeTag } from './sfnt.ts';

// ---------------------------------------------------------------------------
// parseWoff
// ---------------------------------------------------------------------------

/**
 * Parse a WOFF 1.0 container into the same {flavor, tables} model as an sfnt,
 * decompressing each zlib-compressed table. Decompression is size-capped per
 * table (declared origLength) and globally (MAX_TOTAL_DECOMPRESSED_BYTES) to
 * defeat decompression bombs.
 */
export async function parseWoff(bytes: Uint8Array): Promise<SfntFont> {
  if (bytes.length < WOFF_HEADER_SIZE) {
    throw new FontMalformedError('input is shorter than the 44-byte WOFF header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0, false) >>> 0;

  if (signature === WOFF2_SIGNATURE) throw new FontWoff2NotSupportedError();
  if (signature !== WOFF_SIGNATURE) {
    throw new FontInvalidSignatureError(
      `expected WOFF signature 'wOFF' but found 0x${signature.toString(16).padStart(8, '0')}`,
    );
  }

  const flavor = view.getUint32(4, false) >>> 0;
  const numTables = view.getUint16(12, false);
  if (numTables > MAX_TABLES) throw new FontTooManyTablesError(numTables, MAX_TABLES);
  if (numTables === 0) throw new FontMalformedError('WOFF declares zero tables');

  const directoryEnd = WOFF_HEADER_SIZE + numTables * WOFF_TABLE_RECORD_SIZE;
  if (directoryEnd > bytes.length) {
    throw new FontMalformedError('WOFF table directory extends past the end of the input');
  }

  const budget = { used: 0, max: MAX_TOTAL_DECOMPRESSED_BYTES };
  const tables: SfntTable[] = [];

  for (let i = 0; i < numTables; i += 1) {
    const recOff = WOFF_HEADER_SIZE + i * WOFF_TABLE_RECORD_SIZE;
    const tag = readTag(bytes, recOff);
    const offset = view.getUint32(recOff + 4, false) >>> 0;
    const compLength = view.getUint32(recOff + 8, false) >>> 0;
    const origLength = view.getUint32(recOff + 12, false) >>> 0;
    // origChecksum at recOff+16 is informational; the sfnt checksum is recomputed.

    if (origLength > MAX_TABLE_BYTES) {
      throw new FontTableTooLargeError(
        `table "${tag}" origLength ${origLength} exceeds ${MAX_TABLE_BYTES}`,
      );
    }
    if (compLength > MAX_TABLE_BYTES) {
      throw new FontTableTooLargeError(
        `table "${tag}" compLength ${compLength} exceeds ${MAX_TABLE_BYTES}`,
      );
    }
    if (offset < directoryEnd) {
      throw new FontMalformedError(
        `table "${tag}" offset ${offset} overlaps the WOFF header/directory`,
      );
    }
    const compEnd = offset + compLength;
    if (compEnd > bytes.length) {
      throw new FontMalformedError(`table "${tag}" data extends past the end of the input`);
    }

    const compData = bytes.subarray(offset, compEnd);
    let data: Uint8Array;
    if (compLength < origLength) {
      data = await inflate(compData, origLength, tag, budget);
      if (data.length !== origLength) {
        throw new FontDecompressionError(
          tag,
          `decompressed to ${data.length} bytes but the directory declared ${origLength}`,
        );
      }
    } else {
      if (compLength > origLength) {
        throw new FontMalformedError(
          `table "${tag}" compLength ${compLength} exceeds origLength ${origLength}`,
        );
      }
      // Stored uncompressed (compLength === origLength).
      budget.used += origLength;
      if (budget.used > budget.max) {
        throw new FontTableTooLargeError(
          `cumulative table output exceeded the cap of ${budget.max} bytes`,
        );
      }
      data = compData;
    }

    tables.push({ tag, data });
  }

  return { flavor, tables };
}

// ---------------------------------------------------------------------------
// serializeWoff
// ---------------------------------------------------------------------------

interface WoffBlock {
  readonly tag: string;
  readonly offset: number;
  readonly compData: Uint8Array;
  readonly compLength: number;
  readonly origLength: number;
  readonly origChecksum: number;
}

/**
 * Serialise a font into a WOFF 1.0 container. Each table is zlib-deflated; a
 * table is stored uncompressed when compression does not actually shrink it
 * (compLength === origLength), per the WOFF spec. The directory is sorted by
 * tag and every table block is padded to 4 bytes.
 */
export async function serializeWoff(font: SfntFont): Promise<Uint8Array> {
  const numTables = font.tables.length;
  if (numTables === 0) throw new FontMalformedError('cannot serialize a WOFF with zero tables');
  if (numTables > MAX_TABLES) throw new FontTooManyTablesError(numTables, MAX_TABLES);

  const sorted = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directoryEnd = WOFF_HEADER_SIZE + numTables * WOFF_TABLE_RECORD_SIZE;
  let woffCursor = directoryEnd;
  // Size of the equivalent uncompressed sfnt (header + directory + padded tables).
  let sfntSize = SFNT_HEADER_SIZE + numTables * SFNT_TABLE_RECORD_SIZE;

  const blocks: WoffBlock[] = [];
  for (const table of sorted) {
    const origData = table.data;
    const origLength = origData.length;
    const origChecksum = computeChecksum(origData, 0, origLength);
    const compressed = await deflate(origData);

    let compData: Uint8Array;
    let compLength: number;
    if (compressed.length < origLength) {
      compData = compressed;
      compLength = compressed.length;
    } else {
      // Compression did not help: store the table uncompressed.
      compData = origData;
      compLength = origLength;
    }

    blocks.push({
      tag: table.tag,
      offset: woffCursor,
      compData,
      compLength,
      origLength,
      origChecksum,
    });
    woffCursor += padTo4(compLength);
    sfntSize += padTo4(origLength);
  }

  const totalWoffSize = woffCursor;
  const out = new Uint8Array(totalWoffSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // WOFF header.
  view.setUint32(0, WOFF_SIGNATURE, false);
  view.setUint32(4, font.flavor >>> 0, false);
  view.setUint32(8, totalWoffSize, false); // length
  view.setUint16(12, numTables, false);
  view.setUint16(14, 0, false); // reserved — must be 0
  view.setUint32(16, sfntSize, false); // totalSfntSize
  view.setUint16(20, 1, false); // majorVersion
  view.setUint16(22, 0, false); // minorVersion
  view.setUint32(24, 0, false); // metaOffset
  view.setUint32(28, 0, false); // metaLength
  view.setUint32(32, 0, false); // metaOrigLength
  view.setUint32(36, 0, false); // privOffset
  view.setUint32(40, 0, false); // privLength

  // Directory + table blocks (padding stays zero).
  for (const [i, block] of blocks.entries()) {
    const recOff = WOFF_HEADER_SIZE + i * WOFF_TABLE_RECORD_SIZE;
    writeTag(out, recOff, block.tag);
    view.setUint32(recOff + 4, block.offset, false);
    view.setUint32(recOff + 8, block.compLength, false);
    view.setUint32(recOff + 12, block.origLength, false);
    view.setUint32(recOff + 16, block.origChecksum, false);
    out.set(block.compData, block.offset);
  }

  return out;
}
