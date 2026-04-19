/**
 * ZIP demuxer (reader).
 *
 * Algorithm (design note §"Demuxer algorithm — ZIP"):
 *   1. Validate input length (>= 22, <= 200 MiB).
 *   2. EOCD backward search (Trap #3: bound at 4 KiB).
 *   3. Decode EOCD; reject multi-disk / ZIP64 / entry count cap.
 *   4. Walk central directory; validate each entry.
 *   5. Construct lazy ZipEntry objects whose data() reads the local header
 *      at access time (Trap #17: re-read local name+extra lengths).
 *
 * Security: 200 MiB input cap is the FIRST statement.
 * Endianness: ALL fields little-endian (Trap #18).
 */

import { decompressBytes, decompressStream } from './compression.ts';
import {
  MAX_COMPRESSION_RATIO,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_INPUT_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ZIP_COMMENT_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_NAME_BYTES,
  ZIP64_SENTINEL_U16,
  ZIP64_SENTINEL_U32,
  ZIP_CENTRAL_DIR_FIXED_SIZE,
  ZIP_CENTRAL_DIR_SIG,
  ZIP_EOCD_FIXED_SIZE,
  ZIP_EOCD_SIG,
  ZIP_FLAG_ENCRYPTED,
  ZIP_FLAG_UTF8,
  ZIP_LOCAL_HEADER_FIXED_SIZE,
  ZIP_LOCAL_HEADER_SIG,
  ZIP_METHOD_DEFLATE,
  ZIP_METHOD_STORED,
} from './constants.ts';
import { computeCrc32 } from './crc32.ts';
import {
  ArchiveEntrySizeCapError,
  ArchiveInputTooLargeError,
  ZipBadCentralDirectoryError,
  ZipBadLocalHeaderError,
  ZipChecksumError,
  ZipCommentTooLargeError,
  ZipCompressionRatioError,
  ZipCorruptStreamError,
  ZipEncryptedNotSupportedError,
  ZipMultiDiskNotSupportedError,
  ZipNoEocdError,
  ZipNotZip64SupportedError,
  ZipTooManyEntriesError,
  ZipTooShortError,
  ZipTruncatedEntryError,
  ZipUnsupportedMethodError,
} from './errors.ts';
import { validateEntryName } from './path-validator.ts';
import {
  UTF8_DECODER,
  decodeCentralDirHeader,
  decodeMsDosDateTime,
  readU32LE,
} from './zip-headers.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single entry in a ZIP archive. */
export interface ZipEntry {
  /** UTF-8 decoded entry name; '/' separated forward slashes only. */
  name: string;
  /** Compression method: 0 (stored) or 8 (deflate). */
  method: 0 | 8;
  /** CRC-32 (zlib variant) of uncompressed data. */
  crc32: number;
  /** Bytes on disk for the compressed stream. */
  compressedSize: number;
  /** Bytes after decompression. */
  uncompressedSize: number;
  /** Last modification time as JS Date in UTC. */
  modified: Date;
  /** True if this entry is a directory (name ends in '/' AND size === 0). */
  isDirectory: boolean;
  /** Absolute file offset of the corresponding local file header. */
  localHeaderOffset: number;
  /** Lazy decompressed-bytes accessor. Caps enforced inside. */
  data(): Promise<Uint8Array>;
  /** Lazy stream accessor for huge entries. */
  stream(): ReadableStream<Uint8Array>;
}

/** Parsed ZIP archive. */
export interface ZipFile {
  entries: ZipEntry[];
  /** ZIP file comment (UTF-8 attempted). */
  comment: string;
}

// ---------------------------------------------------------------------------
// EOCD backward search
// ---------------------------------------------------------------------------

/**
 * Search backward from end of `buf` for the EOCD signature.
 *
 * Bound: we search at most MAX_ZIP_COMMENT_BYTES + EOCD_FIXED_SIZE bytes
 * from the end, as ZIP comments are capped at 4 KiB (Trap #3).
 *
 * @returns Absolute byte offset of the EOCD signature, or -1 if not found.
 */
function findEocd(buf: Uint8Array): number {
  const minOffset = Math.max(0, buf.length - ZIP_EOCD_FIXED_SIZE - MAX_ZIP_COMMENT_BYTES);
  // Start at the earliest possible EOCD position (last 22 bytes)
  for (let i = buf.length - ZIP_EOCD_FIXED_SIZE; i >= minOffset; i--) {
    if (readU32LE(buf, i) === ZIP_EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Lazy entry data() implementation
// ---------------------------------------------------------------------------

/**
 * Build the lazy data() and stream() closures for a ZipEntry.
 *
 * Per Trap #17: we re-read the LOCAL file header's nameLength and extraFieldLength
 * (bytes 26-29) rather than using the central directory's copies, because they
 * may legitimately differ in real-world ZIPs.
 *
 * Per Trap #9: compressed/uncompressed sizes come from the CENTRAL DIRECTORY (cd*).
 */
function makeEntryAccessors(
  input: Uint8Array,
  localHeaderOffset: number,
  cdCompressedSize: number,
  cdUncompressedSize: number,
  method: 0 | 8,
  expectedCrc32: number,
  name: string,
  cumulativeState: { current: number; cap: number },
): { data: () => Promise<Uint8Array>; stream: () => ReadableStream<Uint8Array> } {
  function getPayloadSlice(): Uint8Array {
    // Verify local file header signature
    const sig = readU32LE(input, localHeaderOffset);
    if (sig !== ZIP_LOCAL_HEADER_SIG) {
      throw new ZipBadLocalHeaderError(localHeaderOffset, sig);
    }

    // Re-read local header name+extra lengths (Trap #17)
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const payloadOffset =
      localHeaderOffset + ZIP_LOCAL_HEADER_FIXED_SIZE + localNameLen + localExtraLen;

    // Sec-H-1: validate payload does not extend past input (Trap #17 follow-up)
    if (payloadOffset + cdCompressedSize > input.length) {
      throw new ZipTruncatedEntryError(name, payloadOffset, cdCompressedSize, input.length);
    }

    // Use central directory sizes (Trap #9)
    return input.subarray(payloadOffset, payloadOffset + cdCompressedSize);
  }

  const data = async (): Promise<Uint8Array> => {
    const compressed = getPayloadSlice();

    if (method === ZIP_METHOD_STORED) {
      // Validate CRC-32 for stored entries
      const crc = computeCrc32(compressed);
      if (crc !== expectedCrc32) {
        throw new ZipChecksumError(name, expectedCrc32, crc);
      }
      return compressed;
    }

    // method === ZIP_METHOD_DEFLATE
    // Trap #10: use 'deflate-raw' (NOT 'deflate')
    const decompressed = await decompressBytes(compressed, 'deflate-raw', name, cumulativeState);

    // Validate decompressed size
    if (decompressed.length !== cdUncompressedSize) {
      throw new ZipChecksumError(name, expectedCrc32, computeCrc32(decompressed));
    }

    // Validate CRC-32
    const crc = computeCrc32(decompressed);
    if (crc !== expectedCrc32) {
      throw new ZipChecksumError(name, expectedCrc32, crc);
    }

    return decompressed;
  };

  const stream = (): ReadableStream<Uint8Array> => {
    const compressed = getPayloadSlice();
    if (method === ZIP_METHOD_STORED) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });
    }
    return decompressStream(compressed, 'deflate-raw', name, cumulativeState);
  };

  return { data, stream };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a ZIP archive from a Uint8Array.
 *
 * @param input Raw ZIP bytes. Must be <= 200 MiB.
 * @throws ArchiveInputTooLargeError, ZipTooShortError, ZipNoEocdError,
 *         ZipNotZip64SupportedError, ZipMultiDiskNotSupportedError,
 *         ZipTooManyEntriesError, ZipBadCentralDirectoryError,
 *         ZipEncryptedNotSupportedError, ZipUnsupportedMethodError,
 *         ArchiveInvalidEntryNameError, ArchiveEntrySizeCapError,
 *         ZipCompressionRatioError, ZipCorruptStreamError
 */
export function parseZip(input: Uint8Array): ZipFile {
  // Security cap — FIRST statement
  if (input.length > MAX_INPUT_BYTES) {
    throw new ArchiveInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // Minimum valid ZIP is 22 bytes (empty EOCD only)
  if (input.length < ZIP_EOCD_FIXED_SIZE) {
    throw new ZipTooShortError(input.length);
  }

  // Step 2: EOCD backward search (Trap #3)
  const eocdOffset = findEocd(input);
  if (eocdOffset === -1) {
    throw new ZipNoEocdError();
  }

  // Check for ZIP64 EOCD signature just before EOCD (ZIP64 locator at eocdOffset - 20)
  // Also check if the EOCD itself is a ZIP64 EOCD
  if (eocdOffset >= 4 && readU32LE(input, eocdOffset - 20) === 0x07064b50) {
    throw new ZipNotZip64SupportedError();
  }

  // Step 3: Decode EOCD
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const numberOfThisDisk = view.getUint16(eocdOffset + 4, true);
  const diskWhereCdStarts = view.getUint16(eocdOffset + 6, true);
  const numberOfRecordsOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalRecords = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const commentLength = view.getUint16(eocdOffset + 20, true);

  // Validate comment length (Q-H-3)
  if (commentLength > MAX_ZIP_COMMENT_BYTES) {
    throw new ZipCommentTooLargeError(commentLength);
  }

  // Reject multi-disk (Trap #15)
  if (numberOfThisDisk !== 0 || diskWhereCdStarts !== 0) {
    throw new ZipMultiDiskNotSupportedError(numberOfThisDisk);
  }

  // Reject ZIP64 sentinel values
  if (
    numberOfRecordsOnDisk === ZIP64_SENTINEL_U16 ||
    totalRecords === ZIP64_SENTINEL_U16 ||
    cdSize === ZIP64_SENTINEL_U32 ||
    cdOffset === ZIP64_SENTINEL_U32
  ) {
    throw new ZipNotZip64SupportedError();
  }

  // Entry count cap
  if (totalRecords > MAX_ZIP_ENTRIES) {
    throw new ZipTooManyEntriesError(totalRecords, MAX_ZIP_ENTRIES);
  }

  // Decode optional comment
  const commentBytes = input.subarray(eocdOffset + 22, eocdOffset + 22 + commentLength);
  const comment = UTF8_DECODER.decode(commentBytes);

  // Validate CD bounds
  if (cdOffset + cdSize > eocdOffset) {
    throw new ZipCorruptStreamError(
      `Central directory (offset=${cdOffset}, size=${cdSize}) overruns EOCD (offset=${eocdOffset}).`,
    );
  }

  // Step 4: Walk central directory
  const entries: ZipEntry[] = [];
  // Shared cumulative decompression counter for cap enforcement
  const cumulativeState = { current: 0, cap: MAX_TOTAL_UNCOMPRESSED_BYTES };
  let cdPos = cdOffset;

  for (let i = 0; i < totalRecords; i++) {
    if (cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE > input.length) {
      throw new ZipCorruptStreamError(`Central directory entry ${i} is truncated.`);
    }

    // Verify signature
    const sig = readU32LE(input, cdPos);
    if (sig !== ZIP_CENTRAL_DIR_SIG) {
      throw new ZipBadCentralDirectoryError(cdPos, sig);
    }

    const hdr = decodeCentralDirHeader(input, cdPos);

    // Reject multi-disk entry
    if (hdr.diskNumberStart !== 0) {
      throw new ZipMultiDiskNotSupportedError(hdr.diskNumberStart);
    }

    // Reject encrypted entries (bit 0)
    if ((hdr.flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      // Decode name for error message (best effort)
      const nameSlice = input.subarray(
        cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE,
        cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE + Math.min(hdr.fileNameLength, 256),
      );
      const tempName = UTF8_DECODER.decode(nameSlice);
      throw new ZipEncryptedNotSupportedError(tempName);
    }

    // Reject unsupported methods
    if (hdr.method !== ZIP_METHOD_STORED && hdr.method !== ZIP_METHOD_DEFLATE) {
      const nameSlice = input.subarray(
        cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE,
        cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE + Math.min(hdr.fileNameLength, 256),
      );
      const tempName = UTF8_DECODER.decode(nameSlice);
      throw new ZipUnsupportedMethodError(tempName, hdr.method);
    }

    // Name length cap
    if (hdr.fileNameLength > MAX_ZIP_NAME_BYTES) {
      throw new ZipCorruptStreamError(
        `Entry ${i} has name length ${hdr.fileNameLength} > ${MAX_ZIP_NAME_BYTES}.`,
      );
    }

    // Decode name (Trap #7: use UTF-8 regardless of bit 11)
    const nameOffset = cdPos + ZIP_CENTRAL_DIR_FIXED_SIZE;
    const nameBytes = input.subarray(nameOffset, nameOffset + hdr.fileNameLength);
    const rawName = UTF8_DECODER.decode(nameBytes);

    // Validate path (Trap #2)
    const name = validateEntryName(rawName);

    // Per-entry size cap
    if (hdr.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new ArchiveEntrySizeCapError(name, hdr.uncompressedSize, MAX_ENTRY_UNCOMPRESSED_BYTES);
    }

    // Cumulative size pre-check
    if (cumulativeState.current + hdr.uncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ZipCorruptStreamError(
        `Cumulative uncompressed size would exceed ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes.`,
      );
    }

    // Compression ratio bomb check (Trap #12, #1)
    if (
      hdr.compressedSize > 0 &&
      hdr.uncompressedSize > hdr.compressedSize * MAX_COMPRESSION_RATIO
    ) {
      const ratio = Math.floor(hdr.uncompressedSize / hdr.compressedSize);
      throw new ZipCompressionRatioError(name, ratio);
    }

    const modified = decodeMsDosDateTime(hdr.dosTime, hdr.dosDate);
    const isDirectory = name.endsWith('/') && hdr.uncompressedSize === 0;
    const method = hdr.method as 0 | 8;

    const { data, stream } = makeEntryAccessors(
      input,
      hdr.localHeaderOffset,
      hdr.compressedSize,
      hdr.uncompressedSize,
      method,
      hdr.crc32,
      name,
      cumulativeState,
    );

    entries.push({
      name,
      method,
      crc32: hdr.crc32,
      compressedSize: hdr.compressedSize,
      uncompressedSize: hdr.uncompressedSize,
      modified,
      isDirectory,
      localHeaderOffset: hdr.localHeaderOffset,
      data,
      stream,
    });

    // Advance past this central directory entry
    cdPos +=
      ZIP_CENTRAL_DIR_FIXED_SIZE +
      hdr.fileNameLength +
      hdr.extraFieldLength +
      hdr.fileCommentLength;
  }

  // Non-empty input must yield at least one entry or be a valid empty ZIP
  if (input.length > ZIP_EOCD_FIXED_SIZE && entries.length === 0 && totalRecords > 0) {
    throw new ZipCorruptStreamError('Non-empty input parsed to zero entries.');
  }

  return { entries, comment };
}
