/**
 * ZIP muxer (writer).
 *
 * Algorithm (design note §"Muxer algorithm — ZIP"):
 *   1. Per-entry: resolve bytes, compute CRC-32, optionally compress with
 *      CompressionStream('deflate-raw') (Trap #10).
 *   2. Write local file header + filename + compressed data.
 *   3. Write central directory.
 *   4. Write EOCD.
 *
 * Round-trip note: NOT byte-identical. Deflate output is non-deterministic
 * across browser engines. Semantic equivalence (same entries) is the contract.
 *
 * Endianness: ALL fields little-endian (Trap #18).
 */

import { compressBytes } from './compression.ts';
import {
  MAX_ZIP_ENTRIES,
  ZIP_CENTRAL_DIR_FIXED_SIZE,
  ZIP_COMPRESS_THRESHOLD,
  ZIP_EOCD_FIXED_SIZE,
  ZIP_LOCAL_HEADER_FIXED_SIZE,
  ZIP_METHOD_DEFLATE,
  ZIP_METHOD_STORED,
} from './constants.ts';
import { computeCrc32 } from './crc32.ts';
import { ZipTooManyEntriesError } from './errors.ts';
import {
  UTF8_ENCODER,
  encodeCentralDirHeader,
  encodeEocd,
  encodeLocalFileHeader,
  encodeMsDosDateTime,
} from './zip-headers.ts';
import type { ZipFile } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// Internal per-entry state
// ---------------------------------------------------------------------------

interface ResolvedEntry {
  nameBytes: Uint8Array;
  compressedData: Uint8Array;
  uncompressedSize: number;
  crc32: number;
  method: 0 | 8;
  dosTime: number;
  dosDate: number;
  isDirectory: boolean;
}

// ---------------------------------------------------------------------------
// Main serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a ZipFile to a Uint8Array.
 *
 * @param file    ZipFile to serialize.
 * @param opts    Optional: force compression method (0 = stored, 8 = deflate).
 *                When omitted, entries <= ZIP_COMPRESS_THRESHOLD bytes use stored,
 *                larger entries use deflate.
 */
export async function serializeZip(file: ZipFile, opts?: { method?: 0 | 8 }): Promise<Uint8Array> {
  if (file.entries.length > MAX_ZIP_ENTRIES) {
    throw new ZipTooManyEntriesError(file.entries.length, MAX_ZIP_ENTRIES);
  }

  // Step 1: Resolve all entries
  const resolved: ResolvedEntry[] = [];

  for (const entry of file.entries) {
    const nameBytes = UTF8_ENCODER.encode(entry.name);
    const [dosTime, dosDate] = encodeMsDosDateTime(entry.modified);

    if (entry.isDirectory) {
      resolved.push({
        nameBytes,
        compressedData: new Uint8Array(0),
        uncompressedSize: 0,
        crc32: 0,
        method: ZIP_METHOD_STORED,
        dosTime,
        dosDate,
        isDirectory: true,
      });
      continue;
    }

    const rawBytes = await entry.data();
    const crc = computeCrc32(rawBytes);

    // Determine compression method
    let method: 0 | 8;
    if (opts?.method !== undefined) {
      method = opts.method;
    } else {
      method = rawBytes.length > ZIP_COMPRESS_THRESHOLD ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORED;
    }

    let compressedData: Uint8Array;
    if (method === ZIP_METHOD_DEFLATE) {
      // Trap #10: use 'deflate-raw' for ZIP method 8
      const deflated = await compressBytes(rawBytes, 'deflate-raw');
      // If deflate makes it larger, fall back to stored
      if (deflated.length >= rawBytes.length) {
        compressedData = rawBytes;
        method = ZIP_METHOD_STORED;
      } else {
        compressedData = deflated;
      }
    } else {
      compressedData = rawBytes;
    }

    resolved.push({
      nameBytes,
      compressedData,
      uncompressedSize: rawBytes.length,
      crc32: crc,
      method,
      dosTime,
      dosDate,
      isDirectory: false,
    });
  }

  // Step 2: Compute total output size
  let totalSize = 0;
  const localOffsets: number[] = [];

  for (const r of resolved) {
    localOffsets.push(totalSize);
    totalSize += ZIP_LOCAL_HEADER_FIXED_SIZE + r.nameBytes.length + r.compressedData.length;
  }

  const centralDirOffset = totalSize;
  for (const r of resolved) {
    totalSize += ZIP_CENTRAL_DIR_FIXED_SIZE + r.nameBytes.length;
  }

  const centralDirSize = totalSize - centralDirOffset;
  totalSize += ZIP_EOCD_FIXED_SIZE;

  // Step 3: Write output
  const out = new Uint8Array(totalSize);

  // Local file headers + data
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i] as ResolvedEntry;
    const localOffset = localOffsets[i] as number;

    encodeLocalFileHeader(out, localOffset, r.nameBytes, {
      method: r.method,
      dosTime: r.dosTime,
      dosDate: r.dosDate,
      crc32: r.crc32,
      compressedSize: r.compressedData.length,
      uncompressedSize: r.uncompressedSize,
    });

    out.set(r.compressedData, localOffset + ZIP_LOCAL_HEADER_FIXED_SIZE + r.nameBytes.length);
  }

  // Central directory
  let cdPos = centralDirOffset;
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i] as ResolvedEntry;
    const localOffset = localOffsets[i] as number;

    encodeCentralDirHeader(out, cdPos, r.nameBytes, {
      method: r.method,
      dosTime: r.dosTime,
      dosDate: r.dosDate,
      crc32: r.crc32,
      compressedSize: r.compressedData.length,
      uncompressedSize: r.uncompressedSize,
      localHeaderOffset: localOffset,
      isDirectory: r.isDirectory,
    });

    cdPos += ZIP_CENTRAL_DIR_FIXED_SIZE + r.nameBytes.length;
  }

  // EOCD
  encodeEocd(out, centralDirOffset + centralDirSize, {
    numberOfRecords: resolved.length,
    centralDirectorySize: centralDirSize,
    centralDirectoryOffset: centralDirOffset,
  });

  return out;
}
