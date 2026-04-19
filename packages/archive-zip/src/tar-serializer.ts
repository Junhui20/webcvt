/**
 * TAR (POSIX ustar) muxer (writer).
 *
 * Algorithm (design note §"Muxer algorithm — TAR"):
 *   1. Per-entry: resolve bytes, build 512-byte header block.
 *   2. Write checksum (Trap #5): 8 spaces first, compute sum, write octal.
 *   3. Append padded data blocks.
 *   4. Append 1024-byte end-of-archive marker (two all-zero 512-byte blocks).
 *
 * Endianness: N/A — TAR uses ASCII octal strings for all numeric fields.
 */

import {
  MAX_TAR_ENTRIES,
  TAR_BLOCK_SIZE,
  TAR_LEN_CHKSUM,
  TAR_LEN_GNAME,
  TAR_LEN_MODE,
  TAR_LEN_MTIME,
  TAR_LEN_NAME,
  TAR_LEN_UNAME,
  TAR_MAGIC,
  TAR_OFF_CHKSUM,
  TAR_OFF_GNAME,
  TAR_OFF_MAGIC,
  TAR_OFF_MODE,
  TAR_OFF_MTIME,
  TAR_OFF_NAME,
  TAR_OFF_SIZE,
  TAR_OFF_TYPEFLAG,
  TAR_OFF_UNAME,
  TAR_OFF_VERSION,
  TAR_TYPEFLAG_DIRECTORY,
  TAR_TYPEFLAG_FILE,
  TAR_VERSION,
} from './constants.ts';
import { TarLongNameNotSupportedError, TarTooManyEntriesError } from './errors.ts';
import type { TarFile } from './tar-parser.ts';

// ---------------------------------------------------------------------------
// ASCII encoder (module-scope)
// ---------------------------------------------------------------------------

const ASCII_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Octal encoding helpers
// ---------------------------------------------------------------------------

/**
 * Encode a number as an octal string into a fixed-width field in `block`.
 *
 * Format: "%0{width-1}o\0" (padded with leading zeros, NUL-terminated).
 * POSIX convention: for chksum field specifically, use "d%06o\0 " (six digits + NUL + space).
 *
 * @param block   512-byte header buffer.
 * @param offset  Field start offset.
 * @param width   Field width in bytes (including the NUL terminator).
 * @param value   Number to encode.
 */
function writeOctal(block: Uint8Array, offset: number, width: number, value: number): void {
  const octalStr = value.toString(8).padStart(width - 1, '0');
  const bytes = ASCII_ENCODER.encode(octalStr);
  // Copy up to width-1 bytes
  const copyLen = Math.min(bytes.length, width - 1);
  block.set(bytes.subarray(0, copyLen), offset + (width - 1 - copyLen));
  block[offset + width - 1] = 0; // NUL terminate
}

/**
 * Write the POSIX checksum in the format: "%06o\0 " (6 digits, NUL, space).
 */
function writeChecksum(block: Uint8Array, checksum: number): void {
  const octalStr = checksum.toString(8).padStart(6, '0');
  const bytes = ASCII_ENCODER.encode(octalStr);
  block.fill(0, TAR_OFF_CHKSUM, TAR_OFF_CHKSUM + TAR_LEN_CHKSUM);
  block.set(bytes.subarray(0, 6), TAR_OFF_CHKSUM);
  block[TAR_OFF_CHKSUM + 6] = 0x00; // NUL
  block[TAR_OFF_CHKSUM + 7] = 0x20; // space
}

/**
 * Write a NUL-padded ASCII string into a fixed-width field.
 */
function writeString(block: Uint8Array, offset: number, maxLength: number, value: string): void {
  const bytes = ASCII_ENCODER.encode(value);
  const copyLen = Math.min(bytes.length, maxLength);
  block.set(bytes.subarray(0, copyLen), offset);
  // Remaining bytes stay as zero (block was zero-filled)
}

// ---------------------------------------------------------------------------
// Checksum computation (Trap #5)
// ---------------------------------------------------------------------------

function computeChecksum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    if (i >= TAR_OFF_CHKSUM && i < TAR_OFF_CHKSUM + TAR_LEN_CHKSUM) {
      sum += 0x20; // Treat chksum bytes as spaces during computation
    } else {
      sum += block[i] ?? 0;
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Ceiling division to block boundary
// ---------------------------------------------------------------------------

function ceilToBlock(size: number): number {
  return TAR_BLOCK_SIZE * Math.ceil(size / TAR_BLOCK_SIZE);
}

// ---------------------------------------------------------------------------
// Main serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a TarFile to a Uint8Array (synchronous).
 *
 * Entry data is accessed via entry.data() (async) but TAR serialization
 * requires resolved bytes. Use serializeTarAsync for full async operation.
 *
 * @param file    TarFile with pre-resolved entry bytes.
 */
export async function serializeTar(file: TarFile): Promise<Uint8Array> {
  if (file.entries.length > MAX_TAR_ENTRIES) {
    throw new TarTooManyEntriesError(MAX_TAR_ENTRIES);
  }

  // Resolve all entry bytes
  const resolvedEntries: Array<{ entry: TarFile['entries'][number]; bytes: Uint8Array }> = [];

  for (const entry of file.entries) {
    const bytes = entry.type === 'directory' ? new Uint8Array(0) : await entry.data();
    resolvedEntries.push({ entry, bytes });
  }

  // Compute total output size
  let totalSize = 0;
  for (const { entry, bytes } of resolvedEntries) {
    totalSize += TAR_BLOCK_SIZE; // header
    if (entry.type === 'file' && bytes.length > 0) {
      totalSize += ceilToBlock(bytes.length);
    }
  }
  totalSize += TAR_BLOCK_SIZE * 2; // end-of-archive marker

  const out = new Uint8Array(totalSize);
  let pos = 0;

  for (const { entry, bytes } of resolvedEntries) {
    // Validate name length (first-pass writer supports only name <= 100 bytes)
    if (entry.name.length > 100) {
      throw new TarLongNameNotSupportedError(entry.name, entry.name.length);
    }

    // Build 512-byte header
    const header = new Uint8Array(TAR_BLOCK_SIZE); // zero-filled

    writeString(header, TAR_OFF_NAME, TAR_LEN_NAME, entry.name);
    writeOctal(
      header,
      TAR_OFF_MODE,
      TAR_LEN_MODE,
      entry.mode || (entry.type === 'directory' ? 0o755 : 0o644),
    );
    // uid/gid: 0 (written as "0000000\0")
    writeOctal(header, 108, 8, 0); // uid
    writeOctal(header, 116, 8, 0); // gid
    writeOctal(header, TAR_OFF_MTIME, TAR_LEN_MTIME, Math.floor(entry.modified.getTime() / 1000));
    writeOctal(header, TAR_OFF_SIZE, 12, entry.type === 'directory' ? 0 : bytes.length);

    // Typeflag
    header[TAR_OFF_TYPEFLAG] =
      entry.type === 'directory'
        ? TAR_TYPEFLAG_DIRECTORY.charCodeAt(0)
        : TAR_TYPEFLAG_FILE.charCodeAt(0);

    // Magic and version
    const magicBytes = ASCII_ENCODER.encode(TAR_MAGIC);
    header.set(magicBytes, TAR_OFF_MAGIC);
    const versionBytes = ASCII_ENCODER.encode(TAR_VERSION);
    header.set(versionBytes, TAR_OFF_VERSION);

    // uname / gname
    writeString(header, TAR_OFF_UNAME, TAR_LEN_UNAME, entry.uname);
    writeString(header, TAR_OFF_GNAME, TAR_LEN_GNAME, entry.gname);

    // Step d: write 8 spaces, compute checksum, overwrite (Trap #5)
    header.fill(0x20, TAR_OFF_CHKSUM, TAR_OFF_CHKSUM + TAR_LEN_CHKSUM);
    const checksum = computeChecksum(header);
    writeChecksum(header, checksum);

    out.set(header, pos);
    pos += TAR_BLOCK_SIZE;

    // Data blocks (padded to 512-byte boundary)
    if (entry.type === 'file' && bytes.length > 0) {
      out.set(bytes, pos);
      pos += ceilToBlock(bytes.length);
    }
  }

  // End-of-archive: 1024 bytes of zero (already zero-filled in out)
  // pos advances to totalSize (the two zero blocks are pre-zeroed)

  return out;
}
