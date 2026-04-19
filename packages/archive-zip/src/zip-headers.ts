/**
 * ZIP binary record layout: encode/decode helpers.
 *
 * Covers:
 *   - Local file header (signature 0x04034b50, 30 bytes fixed + variable)
 *   - Central directory header (signature 0x02014b50, 46 bytes fixed + variable)
 *   - End-of-Central-Directory record (signature 0x06054b50, 22 bytes fixed + comment)
 *   - MS-DOS time/date encoding + decoding (Trap #13)
 *
 * ALL multi-byte fields are LITTLE-ENDIAN (Trap #18: ZIP uses DOS heritage LE).
 * Use view.getUint16(offset, true) / getUint32(offset, true) — `true` = little-endian.
 *
 * References: PKWARE APPNOTE.TXT §4.3, §4.4
 */

import {
  ZIP_CENTRAL_DIR_FIXED_SIZE,
  ZIP_CENTRAL_DIR_SIG,
  ZIP_EOCD_FIXED_SIZE,
  ZIP_EOCD_SIG,
  ZIP_FLAG_UTF8,
  ZIP_LOCAL_HEADER_FIXED_SIZE,
  ZIP_LOCAL_HEADER_SIG,
  ZIP_VERSION_MADE_BY,
  ZIP_VERSION_NEEDED,
} from './constants.ts';

// ---------------------------------------------------------------------------
// MS-DOS time/date (Trap #13)
// ---------------------------------------------------------------------------

/**
 * Decode a MS-DOS time word and date word into a JS Date (UTC).
 *
 * time  = (hour << 11) | (minute << 5) | (second / 2)
 * date  = ((year - 1980) << 9) | (month << 5) | day
 *
 * Year 0 in the encoded form means 1980 (offset). Minimum representable
 * date is 1980-01-01T00:00:00Z.
 */
export function decodeMsDosDateTime(dosTime: number, dosDate: number): Date {
  if (dosTime === 0 && dosDate === 0) {
    return new Date('1980-01-01T00:00:00Z');
  }
  const second = (dosTime & 0x1f) * 2;
  const minute = (dosTime >> 5) & 0x3f;
  const hour = (dosTime >> 11) & 0x1f;
  const day = dosDate & 0x1f;
  const month = (dosDate >> 5) & 0x0f;
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  // Use UTC to avoid timezone shifts
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Encode a JS Date into MS-DOS time and date words.
 *
 * @returns [dosTime, dosDate] as a tuple of u16 values.
 */
export function encodeMsDosDateTime(date: Date): [number, number] {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  const dosTime = ((hour & 0x1f) << 11) | ((minute & 0x3f) << 5) | (Math.floor(second / 2) & 0x1f);
  return [dosTime, dosDate];
}

// ---------------------------------------------------------------------------
// Local file header (30 bytes + name + extra)
// ---------------------------------------------------------------------------

export interface LocalFileHeader {
  /** Version needed to extract. */
  versionNeeded: number;
  /** General purpose bit flag. */
  flags: number;
  /** Compression method (0 = stored, 8 = deflate). */
  method: number;
  /** MS-DOS last modification time. */
  dosTime: number;
  /** MS-DOS last modification date. */
  dosDate: number;
  /** CRC-32 of uncompressed data. */
  crc32: number;
  /** Compressed size on disk. */
  compressedSize: number;
  /** Uncompressed size. */
  uncompressedSize: number;
  /** Length of the file name field. */
  fileNameLength: number;
  /** Length of the extra field. */
  extraFieldLength: number;
}

/**
 * Decode a local file header from `buf` at `offset`.
 * Does NOT verify the signature — caller must check.
 */
export function decodeLocalFileHeader(buf: Uint8Array, offset: number): LocalFileHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    versionNeeded: view.getUint16(offset + 4, true),
    flags: view.getUint16(offset + 6, true),
    method: view.getUint16(offset + 8, true),
    dosTime: view.getUint16(offset + 10, true),
    dosDate: view.getUint16(offset + 12, true),
    crc32: view.getUint32(offset + 14, true),
    compressedSize: view.getUint32(offset + 18, true),
    uncompressedSize: view.getUint32(offset + 22, true),
    fileNameLength: view.getUint16(offset + 26, true),
    extraFieldLength: view.getUint16(offset + 28, true),
  };
}

/**
 * Encode a local file header into `out` starting at `offset`.
 * Writes exactly ZIP_LOCAL_HEADER_FIXED_SIZE (30) bytes.
 *
 * @param out         Output buffer (must have room for 30 + nameLen bytes).
 * @param offset      Byte offset in `out` to write at.
 * @param nameBytes   UTF-8 encoded file name.
 * @param h           Header fields.
 */
export function encodeLocalFileHeader(
  out: Uint8Array,
  offset: number,
  nameBytes: Uint8Array,
  h: {
    method: number;
    dosTime: number;
    dosDate: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
  },
): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(offset + 0, ZIP_LOCAL_HEADER_SIG, true);
  view.setUint16(offset + 4, ZIP_VERSION_NEEDED, true);
  view.setUint16(offset + 6, ZIP_FLAG_UTF8, true); // bit 11: UTF-8 filename
  view.setUint16(offset + 8, h.method, true);
  view.setUint16(offset + 10, h.dosTime, true);
  view.setUint16(offset + 12, h.dosDate, true);
  view.setUint32(offset + 14, h.crc32, true);
  view.setUint32(offset + 18, h.compressedSize, true);
  view.setUint32(offset + 22, h.uncompressedSize, true);
  view.setUint16(offset + 26, nameBytes.length, true);
  view.setUint16(offset + 28, 0, true); // no extra field
  out.set(nameBytes, offset + ZIP_LOCAL_HEADER_FIXED_SIZE);
}

// ---------------------------------------------------------------------------
// Central directory header (46 bytes + name + extra + comment)
// ---------------------------------------------------------------------------

export interface CentralDirHeader {
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  fileNameLength: number;
  extraFieldLength: number;
  fileCommentLength: number;
  diskNumberStart: number;
  internalAttrs: number;
  externalAttrs: number;
  localHeaderOffset: number;
}

/**
 * Decode a central directory header from `buf` at `offset`.
 * Does NOT verify the signature — caller must check.
 */
export function decodeCentralDirHeader(buf: Uint8Array, offset: number): CentralDirHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    versionMadeBy: view.getUint16(offset + 4, true),
    versionNeeded: view.getUint16(offset + 6, true),
    flags: view.getUint16(offset + 8, true),
    method: view.getUint16(offset + 10, true),
    dosTime: view.getUint16(offset + 12, true),
    dosDate: view.getUint16(offset + 14, true),
    crc32: view.getUint32(offset + 16, true),
    compressedSize: view.getUint32(offset + 20, true),
    uncompressedSize: view.getUint32(offset + 24, true),
    fileNameLength: view.getUint16(offset + 28, true),
    extraFieldLength: view.getUint16(offset + 30, true),
    fileCommentLength: view.getUint16(offset + 32, true),
    diskNumberStart: view.getUint16(offset + 34, true),
    internalAttrs: view.getUint16(offset + 36, true),
    externalAttrs: view.getUint32(offset + 38, true),
    localHeaderOffset: view.getUint32(offset + 42, true),
  };
}

/**
 * Encode a central directory header into `out` at `offset`.
 * Writes exactly ZIP_CENTRAL_DIR_FIXED_SIZE (46) + nameBytes.length bytes.
 */
export function encodeCentralDirHeader(
  out: Uint8Array,
  offset: number,
  nameBytes: Uint8Array,
  h: {
    method: number;
    dosTime: number;
    dosDate: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    isDirectory: boolean;
  },
): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(offset + 0, ZIP_CENTRAL_DIR_SIG, true);
  view.setUint16(offset + 4, ZIP_VERSION_MADE_BY, true);
  view.setUint16(offset + 6, ZIP_VERSION_NEEDED, true);
  view.setUint16(offset + 8, ZIP_FLAG_UTF8, true);
  view.setUint16(offset + 10, h.method, true);
  view.setUint16(offset + 12, h.dosTime, true);
  view.setUint16(offset + 14, h.dosDate, true);
  view.setUint32(offset + 16, h.crc32, true);
  view.setUint32(offset + 20, h.compressedSize, true);
  view.setUint32(offset + 24, h.uncompressedSize, true);
  view.setUint16(offset + 28, nameBytes.length, true);
  view.setUint16(offset + 30, 0, true); // no extra field
  view.setUint16(offset + 32, 0, true); // no comment
  view.setUint16(offset + 34, 0, true); // disk number start
  view.setUint16(offset + 36, 0, true); // internal attrs
  // External file attributes: high 16 bits = Unix mode
  const unixMode = h.isDirectory ? 0o040755 : 0o100644;
  view.setUint32(offset + 38, (unixMode << 16) >>> 0, true);
  view.setUint32(offset + 42, h.localHeaderOffset, true);
  out.set(nameBytes, offset + ZIP_CENTRAL_DIR_FIXED_SIZE);
}

// ---------------------------------------------------------------------------
// End-of-Central-Directory record (22 bytes + comment)
// ---------------------------------------------------------------------------

export interface EocdRecord {
  numberOfThisDisk: number;
  diskWhereCdStarts: number;
  numberOfRecordsOnThisDisk: number;
  totalNumberOfRecords: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
  commentLength: number;
}

/**
 * Decode the EOCD record from `buf` at `offset`.
 * Does NOT verify the signature — caller must check.
 */
export function decodeEocd(buf: Uint8Array, offset: number): EocdRecord {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    numberOfThisDisk: view.getUint16(offset + 4, true),
    diskWhereCdStarts: view.getUint16(offset + 6, true),
    numberOfRecordsOnThisDisk: view.getUint16(offset + 8, true),
    totalNumberOfRecords: view.getUint16(offset + 10, true),
    centralDirectorySize: view.getUint32(offset + 12, true),
    centralDirectoryOffset: view.getUint32(offset + 16, true),
    commentLength: view.getUint16(offset + 20, true),
  };
}

/**
 * Encode the EOCD record into `out` at `offset`. Writes exactly 22 bytes.
 */
export function encodeEocd(
  out: Uint8Array,
  offset: number,
  h: {
    numberOfRecords: number;
    centralDirectorySize: number;
    centralDirectoryOffset: number;
  },
): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(offset + 0, ZIP_EOCD_SIG, true);
  view.setUint16(offset + 4, 0, true); // disk number
  view.setUint16(offset + 6, 0, true); // disk where CD starts
  view.setUint16(offset + 8, h.numberOfRecords, true);
  view.setUint16(offset + 10, h.numberOfRecords, true);
  view.setUint32(offset + 12, h.centralDirectorySize, true);
  view.setUint32(offset + 16, h.centralDirectoryOffset, true);
  view.setUint16(offset + 20, 0, true); // no comment
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

/**
 * Read a u32 LE value from `buf` at `offset`. Returns 0 if out of range.
 */
export function readU32LE(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint32(offset, true);
}

/**
 * Read a u16 LE value from `buf` at `offset`. Returns 0 if out of range.
 */
export function readU16LE(buf: Uint8Array, offset: number): number {
  if (offset + 2 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getUint16(offset, true);
}

// ---------------------------------------------------------------------------
// UTF-8 text decoder (module-scope, Lesson from container-ts)
// ---------------------------------------------------------------------------

/** Shared UTF-8 decoder; hoisted to module scope to avoid per-call allocation. */
export const UTF8_DECODER = new TextDecoder('utf-8');

/** Shared UTF-8 encoder. */
export const UTF8_ENCODER = new TextEncoder();

/**
 * Compute the total size (in bytes) needed for a local file header record.
 */
export function localHeaderRecordSize(nameBytes: Uint8Array): number {
  return ZIP_LOCAL_HEADER_FIXED_SIZE + nameBytes.length;
}

/**
 * Compute the total size (in bytes) needed for a central directory record.
 */
export function centralDirRecordSize(nameBytes: Uint8Array): number {
  return ZIP_CENTRAL_DIR_FIXED_SIZE + nameBytes.length;
}

/**
 * Compute the total size (in bytes) for the EOCD record.
 */
export function eocdRecordSize(): number {
  return ZIP_EOCD_FIXED_SIZE;
}
