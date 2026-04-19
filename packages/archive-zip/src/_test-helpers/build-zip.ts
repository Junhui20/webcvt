/**
 * Synthetic ZIP builder for tests.
 *
 * Builds minimal valid stored-method (method 0) ZIP archives from
 * (name, bytes) pairs without relying on any library. Used exclusively
 * in tests — not exported from the package index.
 *
 * To build a deflate-method ZIP, use serializeZip() from zip-serializer.ts.
 */

import {
  ZIP_CENTRAL_DIR_FIXED_SIZE,
  ZIP_CENTRAL_DIR_SIG,
  ZIP_EOCD_FIXED_SIZE,
  ZIP_EOCD_SIG,
  ZIP_FLAG_UTF8,
  ZIP_LOCAL_HEADER_FIXED_SIZE,
  ZIP_LOCAL_HEADER_SIG,
  ZIP_METHOD_STORED,
  ZIP_VERSION_NEEDED,
} from '../constants.ts';
import { computeCrc32 } from '../crc32.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
  modified?: Date;
  /** If true, this is a directory entry (bytes ignored). */
  isDirectory?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

function writeU16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

function encodeMsDos(date: Date): [number, number] {
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  const dosDate = (((y - 1980) & 0x7f) << 9) | ((mo & 0x0f) << 5) | (d & 0x1f);
  const dosTime = ((h & 0x1f) << 11) | ((mi & 0x3f) << 5) | (Math.floor(s / 2) & 0x1f);
  return [dosTime, dosDate];
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid stored-method ZIP archive.
 *
 * @param entries  Array of (name, bytes) pairs.
 * @returns        Uint8Array containing a valid ZIP archive.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const nameBytesList = entries.map((e) => ENCODER.encode(e.name));

  // Calculate total size
  let totalSize = 0;
  const localOffsets: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    localOffsets.push(totalSize);
    const entry = entries[i] as ZipEntry;
    const nameLen = (nameBytesList[i] as Uint8Array).length;
    const dataLen = entry.isDirectory ? 0 : (entry.bytes?.length ?? 0);
    totalSize += ZIP_LOCAL_HEADER_FIXED_SIZE + nameLen + dataLen;
  }

  const cdOffset = totalSize;
  for (let i = 0; i < entries.length; i++) {
    totalSize += ZIP_CENTRAL_DIR_FIXED_SIZE + (nameBytesList[i] as Uint8Array).length;
  }

  const eocdOffset = totalSize;
  totalSize += ZIP_EOCD_FIXED_SIZE;

  const out = new Uint8Array(totalSize);

  // Write local file headers + data
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ZipEntry;
    const nameBytes = nameBytesList[i] as Uint8Array;
    const dataBytes = entry.isDirectory ? new Uint8Array(0) : (entry.bytes ?? new Uint8Array(0));
    const crc = entry.isDirectory ? 0 : computeCrc32(dataBytes);
    const [dosTime, dosDate] = encodeMsDos(entry.modified ?? new Date('1980-01-01T00:00:00Z'));
    const off = localOffsets[i] as number;

    writeU32LE(out, off + 0, ZIP_LOCAL_HEADER_SIG);
    writeU16LE(out, off + 4, ZIP_VERSION_NEEDED);
    writeU16LE(out, off + 6, ZIP_FLAG_UTF8);
    writeU16LE(out, off + 8, ZIP_METHOD_STORED);
    writeU16LE(out, off + 10, dosTime);
    writeU16LE(out, off + 12, dosDate);
    writeU32LE(out, off + 14, crc);
    writeU32LE(out, off + 18, dataBytes.length);
    writeU32LE(out, off + 22, dataBytes.length);
    writeU16LE(out, off + 26, nameBytes.length);
    writeU16LE(out, off + 28, 0);
    out.set(nameBytes, off + 30);
    out.set(dataBytes, off + 30 + nameBytes.length);
  }

  // Write central directory
  let cdPos = cdOffset;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ZipEntry;
    const nameBytes = nameBytesList[i] as Uint8Array;
    const dataBytes = entry.isDirectory ? new Uint8Array(0) : (entry.bytes ?? new Uint8Array(0));
    const crc = entry.isDirectory ? 0 : computeCrc32(dataBytes);
    const [dosTime, dosDate] = encodeMsDos(entry.modified ?? new Date('1980-01-01T00:00:00Z'));
    const localOff = localOffsets[i] as number;

    writeU32LE(out, cdPos + 0, ZIP_CENTRAL_DIR_SIG);
    writeU16LE(out, cdPos + 4, 0x0314); // version made by
    writeU16LE(out, cdPos + 6, ZIP_VERSION_NEEDED);
    writeU16LE(out, cdPos + 8, ZIP_FLAG_UTF8);
    writeU16LE(out, cdPos + 10, ZIP_METHOD_STORED);
    writeU16LE(out, cdPos + 12, dosTime);
    writeU16LE(out, cdPos + 14, dosDate);
    writeU32LE(out, cdPos + 16, crc);
    writeU32LE(out, cdPos + 20, dataBytes.length);
    writeU32LE(out, cdPos + 24, dataBytes.length);
    writeU16LE(out, cdPos + 28, nameBytes.length);
    writeU16LE(out, cdPos + 30, 0); // extra
    writeU16LE(out, cdPos + 32, 0); // comment
    writeU16LE(out, cdPos + 34, 0); // disk
    writeU16LE(out, cdPos + 36, 0); // internal attrs
    writeU32LE(
      out,
      cdPos + 38,
      entry.isDirectory ? (0o040755 << 16) >>> 0 : (0o100644 << 16) >>> 0,
    );
    writeU32LE(out, cdPos + 42, localOff);
    out.set(nameBytes, cdPos + 46);
    cdPos += ZIP_CENTRAL_DIR_FIXED_SIZE + nameBytes.length;
  }

  // Write EOCD
  const cdSize = eocdOffset - cdOffset;
  writeU32LE(out, eocdOffset + 0, ZIP_EOCD_SIG);
  writeU16LE(out, eocdOffset + 4, 0); // disk
  writeU16LE(out, eocdOffset + 6, 0); // cd disk
  writeU16LE(out, eocdOffset + 8, entries.length);
  writeU16LE(out, eocdOffset + 10, entries.length);
  writeU32LE(out, eocdOffset + 12, cdSize);
  writeU32LE(out, eocdOffset + 16, cdOffset);
  writeU16LE(out, eocdOffset + 20, 0); // comment length

  return out;
}

/**
 * Build a ZIP archive with a comment appended to the EOCD.
 * Used for testing EOCD backward search past a long comment.
 */
export function buildZipWithComment(entries: ZipEntry[], comment: Uint8Array): Uint8Array {
  const baseZip = buildZip(entries);
  // The last 2 bytes of the EOCD (offset 20 from EOCD start) are comment length
  // We need to update the comment length and append the comment
  const eocdOffset = baseZip.length - ZIP_EOCD_FIXED_SIZE;

  const out = new Uint8Array(baseZip.length + comment.length);
  out.set(baseZip, 0);
  // Update comment length in EOCD
  out[eocdOffset + 20] = comment.length & 0xff;
  out[eocdOffset + 21] = (comment.length >> 8) & 0xff;
  // Append comment
  out.set(comment, baseZip.length);
  return out;
}
