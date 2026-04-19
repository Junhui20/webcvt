/**
 * TAR (POSIX ustar) demuxer (reader).
 *
 * Algorithm (design note §"Demuxer algorithm — TAR"):
 *   1. Validate: multiple of 512, >= 1024, <= 200 MiB.
 *   2. Linear block walk.
 *   3. EOA detection: two consecutive all-zero 512-byte blocks.
 *   4. ustar magic check (Trap #11).
 *   5. Octal-field parsing (Trap #4), checksum verify (Trap #5).
 *   6. Typeflag dispatch.
 *   7. Name + prefix join, path validation (Trap #2).
 *   8. Size caps.
 *
 * Endianness: TAR has no endianness — all numeric fields are ASCII octal strings.
 * Security: 200 MiB input cap is the FIRST statement.
 */

import {
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_INPUT_BYTES,
  MAX_TAR_ENTRIES,
  MAX_TAR_NAME_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  TAR_BLOCK_SIZE,
  TAR_LEN_CHKSUM,
  TAR_LEN_GNAME,
  TAR_LEN_MAGIC,
  TAR_LEN_MODE,
  TAR_LEN_MTIME,
  TAR_LEN_NAME,
  TAR_LEN_PREFIX,
  TAR_LEN_SIZE,
  TAR_LEN_UNAME,
  TAR_LEN_VERSION,
  TAR_MAGIC,
  TAR_OFF_CHKSUM,
  TAR_OFF_GNAME,
  TAR_OFF_MAGIC,
  TAR_OFF_MODE,
  TAR_OFF_MTIME,
  TAR_OFF_NAME,
  TAR_OFF_PREFIX,
  TAR_OFF_SIZE,
  TAR_OFF_TYPEFLAG,
  TAR_OFF_UNAME,
  TAR_OFF_VERSION,
  TAR_TYPEFLAG_DIRECTORY,
  TAR_TYPEFLAG_FILE,
  TAR_TYPEFLAG_FILE_NUL,
  TAR_TYPEFLAG_PAX_EXTENDED,
  TAR_TYPEFLAG_PAX_GLOBAL,
  TAR_VERSION,
} from './constants.ts';
import {
  ArchiveEntrySizeCapError,
  ArchiveInputTooLargeError,
  TarBase256SizeNotSupportedError,
  TarChecksumError,
  TarCorruptStreamError,
  TarCumulativeSizeCapError,
  TarGnuVariantNotSupportedError,
  TarInvalidOctalFieldError,
  TarLongNameNotSupportedError,
  TarMisalignedInputError,
  TarNonUstarNotSupportedError,
  TarPaxNotSupportedError,
  TarTooManyEntriesError,
  TarTooShortError,
  TarUnsupportedTypeflagError,
} from './errors.ts';
import { validateEntryName } from './path-validator.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single entry in a TAR archive. */
export interface TarEntry {
  /** Effective name (prefix + '/' + name when prefix is non-empty). */
  name: string;
  /** Regular file or directory. */
  type: 'file' | 'directory';
  /** Uncompressed size in bytes; 0 for directories. */
  size: number;
  /** Unix mode bits (octal) parsed from the `mode` field. */
  mode: number;
  /** Modification time as JS Date in UTC. */
  modified: Date;
  /** Owner user name (informational). */
  uname: string;
  /** Owner group name (informational). */
  gname: string;
  /** Lazy data accessor returning the entry's bytes. */
  data(): Promise<Uint8Array>;
}

/** Parsed TAR archive. */
export interface TarFile {
  entries: TarEntry[];
}

// ---------------------------------------------------------------------------
// Octal field parsing (Trap #4)
// ---------------------------------------------------------------------------

/** UTF-8 decoder for ASCII octal strings. */
const ASCII_DECODER = new TextDecoder('utf-8');

/**
 * Parse a fixed-width octal ASCII field from a TAR header.
 *
 * Strips trailing NUL / space characters, then parses as base-8.
 *
 * @param buf    Full 512-byte header block.
 * @param offset Field start offset.
 * @param length Field length in bytes.
 * @throws TarBase256SizeNotSupportedError if high bit is set (GNU base-256).
 */
export function parseOctal(buf: Uint8Array, offset: number, length: number): number {
  // Detect GNU base-256 encoding (high bit set on first byte)
  const firstByte = buf[offset] ?? 0;
  if ((firstByte & 0x80) !== 0) {
    // We can't construct a name here easily, pass empty string — caller handles
    throw new TarBase256SizeNotSupportedError('(unknown)');
  }

  const slice = buf.subarray(offset, offset + length);
  let end = slice.length;
  // Strip trailing NULs and spaces
  while (end > 0 && (slice[end - 1] === 0 || slice[end - 1] === 0x20)) {
    end--;
  }
  if (end === 0) return 0;

  const str = ASCII_DECODER.decode(slice.subarray(0, end));
  const value = Number.parseInt(str, 8);
  if (Number.isNaN(value)) {
    throw new TarInvalidOctalFieldError(str);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Checksum validation (Trap #5)
// ---------------------------------------------------------------------------

/**
 * Compute the POSIX ustar header checksum.
 *
 * Sum of all 512 bytes, treating the chksum field (bytes 148-155) as
 * eight ASCII space characters (0x20).
 */
function computeChecksum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    if (i >= TAR_OFF_CHKSUM && i < TAR_OFF_CHKSUM + TAR_LEN_CHKSUM) {
      sum += 0x20; // Treat chksum bytes as spaces
    } else {
      sum += block[i] ?? 0;
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// NUL-terminated string extraction
// ---------------------------------------------------------------------------

function extractString(buf: Uint8Array, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  let end = slice.indexOf(0); // Find first NUL
  if (end === -1) end = slice.length;
  return ASCII_DECODER.decode(slice.subarray(0, end));
}

// ---------------------------------------------------------------------------
// All-zero block check (EOA detection)
// ---------------------------------------------------------------------------

function isAllZero(block: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + TAR_BLOCK_SIZE; i++) {
    if ((block[i] ?? 0) !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ceiling division to next block boundary
// ---------------------------------------------------------------------------

function ceilToBlock(size: number): number {
  return TAR_BLOCK_SIZE * Math.ceil(size / TAR_BLOCK_SIZE);
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a POSIX ustar TAR archive from a Uint8Array.
 *
 * @param input Raw TAR bytes. Must be <= 200 MiB, multiple of 512, >= 1024.
 * @throws ArchiveInputTooLargeError, TarTooShortError, TarMisalignedInputError,
 *         TarNonUstarNotSupportedError, TarGnuVariantNotSupportedError,
 *         TarChecksumError, TarUnsupportedTypeflagError, TarPaxNotSupportedError,
 *         ArchiveInvalidEntryNameError, ArchiveEntrySizeCapError,
 *         TarTooManyEntriesError
 */
export function parseTar(input: Uint8Array): TarFile {
  // Security cap — FIRST statement
  if (input.length > MAX_INPUT_BYTES) {
    throw new ArchiveInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  if (input.length < TAR_BLOCK_SIZE * 2) {
    throw new TarTooShortError(input.length);
  }

  if (input.length % TAR_BLOCK_SIZE !== 0) {
    throw new TarMisalignedInputError(input.length);
  }

  const entries: TarEntry[] = [];
  let offset = 0;
  let entryCount = 0;
  let cumulativeBytes = 0;

  while (offset + TAR_BLOCK_SIZE <= input.length) {
    const block = input.subarray(offset, offset + TAR_BLOCK_SIZE);

    // EOA check: first all-zero block triggers peek at the next block (Trap #6)
    if (isAllZero(block, 0)) {
      if (
        offset + TAR_BLOCK_SIZE * 2 <= input.length &&
        isAllZero(input, offset + TAR_BLOCK_SIZE)
      ) {
        break; // Two consecutive all-zero blocks = end-of-archive
      }
      // Single zero block without a second — tolerate and continue
      // (some tools write only one zero block; treat as EOA)
      break;
    }

    // ustar magic check (Trap #11)
    const magic = extractString(block, TAR_OFF_MAGIC, TAR_LEN_MAGIC + TAR_LEN_VERSION);
    const magicOnly = extractString(block, TAR_OFF_MAGIC, TAR_LEN_MAGIC);
    const version = ASCII_DECODER.decode(
      block.subarray(TAR_OFF_VERSION, TAR_OFF_VERSION + TAR_LEN_VERSION),
    );

    // GNU tar uses "ustar  " (two spaces then NUL) — Trap #11
    const magicRaw = ASCII_DECODER.decode(
      block.subarray(TAR_OFF_MAGIC, TAR_OFF_MAGIC + TAR_LEN_MAGIC),
    );
    if (magicRaw === 'ustar ' || magicRaw.startsWith('ustar ')) {
      throw new TarGnuVariantNotSupportedError(offset);
    }

    if (magicOnly !== 'ustar') {
      throw new TarNonUstarNotSupportedError(offset, magicOnly);
    }

    if (version !== TAR_VERSION) {
      throw new TarNonUstarNotSupportedError(offset, `${magicOnly}${version}`);
    }

    // Verify checksum (Trap #5)
    const storedChecksum = parseOctal(block, TAR_OFF_CHKSUM, TAR_LEN_CHKSUM);
    const computedChecksum = computeChecksum(block);
    if (storedChecksum !== computedChecksum) {
      throw new TarChecksumError(offset, storedChecksum, computedChecksum);
    }

    // Typeflag
    const typeflagByte = block[TAR_OFF_TYPEFLAG] ?? 0;
    const typeflag = String.fromCharCode(typeflagByte);

    // PAX extended headers (rejected)
    if (typeflag === TAR_TYPEFLAG_PAX_EXTENDED || typeflag === TAR_TYPEFLAG_PAX_GLOBAL) {
      throw new TarPaxNotSupportedError(typeflag);
    }

    // Only file ('0', '\0') and directory ('5') are supported
    if (
      typeflag !== TAR_TYPEFLAG_FILE &&
      typeflag !== TAR_TYPEFLAG_FILE_NUL &&
      typeflag !== TAR_TYPEFLAG_DIRECTORY
    ) {
      const entryName = extractString(block, TAR_OFF_NAME, TAR_LEN_NAME);
      throw new TarUnsupportedTypeflagError(typeflag, entryName);
    }

    // Parse size (Trap #4)
    const size = parseOctal(block, TAR_OFF_SIZE, TAR_LEN_SIZE);

    // Name + prefix (POSIX ustar prefix field)
    const rawName = extractString(block, TAR_OFF_NAME, TAR_LEN_NAME);
    const rawPrefix = extractString(block, TAR_OFF_PREFIX, TAR_LEN_PREFIX);
    const fullRawName = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;

    // Path validation (Trap #2)
    const name = validateEntryName(fullRawName);

    // Name length cap (Sec-M-1)
    if (name.length > MAX_TAR_NAME_BYTES) {
      throw new TarLongNameNotSupportedError(name, name.length);
    }

    // Parse remaining fields
    const mode = parseOctal(block, TAR_OFF_MODE, TAR_LEN_MODE);
    const mtime = parseOctal(block, TAR_OFF_MTIME, TAR_LEN_MTIME);
    const modified = new Date(mtime * 1000);
    const uname = extractString(block, TAR_OFF_UNAME, TAR_LEN_UNAME);
    const gname = extractString(block, TAR_OFF_GNAME, TAR_LEN_GNAME);

    const type = typeflag === TAR_TYPEFLAG_DIRECTORY ? 'directory' : 'file';

    // Per-entry size cap (Sec-C-3 part 1)
    if (size > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new ArchiveEntrySizeCapError(name, size, MAX_ENTRY_UNCOMPRESSED_BYTES);
    }

    // Cumulative size cap (Sec-C-3)
    cumulativeBytes += size;
    if (cumulativeBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new TarCumulativeSizeCapError(cumulativeBytes, MAX_TOTAL_UNCOMPRESSED_BYTES);
    }

    // Entry count cap must be checked BEFORE push (Sec-H-2)
    if (entries.length >= MAX_TAR_ENTRIES) {
      throw new TarTooManyEntriesError(MAX_TAR_ENTRIES);
    }

    // Capture data slice for lazy accessor
    const dataOffset = offset + TAR_BLOCK_SIZE;
    const capturedInput = input;
    const capturedSize = size;

    const data = async (): Promise<Uint8Array> => {
      return capturedInput.subarray(dataOffset, dataOffset + capturedSize);
    };

    entries.push({ name, type, size, mode, modified, uname, gname, data });
    entryCount++;

    // Advance: header block + padded data blocks
    if (type === 'directory' || size === 0) {
      offset += TAR_BLOCK_SIZE;
    } else {
      offset += TAR_BLOCK_SIZE + ceilToBlock(size);
    }
  }

  // Q-H-4: non-empty input must yield at least one entry
  // Threshold: 1024 bytes = minimum for the two EOA blocks; anything larger should have had entries
  if (entries.length === 0 && input.length > TAR_BLOCK_SIZE * 2) {
    throw new TarCorruptStreamError(
      'Non-empty input produced zero entries. Archive may be corrupt.',
    );
  }

  return { entries };
}
