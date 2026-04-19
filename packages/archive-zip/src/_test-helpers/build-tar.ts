/**
 * Synthetic TAR builder for tests.
 *
 * Builds minimal valid POSIX ustar TAR archives from (name, bytes) pairs.
 * Used exclusively in tests — not exported from the package index.
 */

import {
  TAR_BLOCK_SIZE,
  TAR_LEN_CHKSUM,
  TAR_LEN_GNAME,
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
} from '../constants.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TarEntry {
  name: string;
  bytes?: Uint8Array;
  mode?: number;
  modified?: Date;
  uname?: string;
  gname?: string;
  isDirectory?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

function writeString(block: Uint8Array, offset: number, maxLen: number, value: string): void {
  const bytes = ENCODER.encode(value);
  const len = Math.min(bytes.length, maxLen);
  block.set(bytes.subarray(0, len), offset);
}

function writeOctal(block: Uint8Array, offset: number, width: number, value: number): void {
  const s = value.toString(8).padStart(width - 1, '0');
  const bytes = ENCODER.encode(s);
  const copyLen = Math.min(bytes.length, width - 1);
  block.set(bytes.subarray(0, copyLen), offset + (width - 1 - copyLen));
  block[offset + width - 1] = 0;
}

function computeChecksum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    if (i >= TAR_OFF_CHKSUM && i < TAR_OFF_CHKSUM + TAR_LEN_CHKSUM) {
      sum += 0x20;
    } else {
      sum += block[i] ?? 0;
    }
  }
  return sum;
}

function writeChecksum(block: Uint8Array, checksum: number): void {
  const s = checksum.toString(8).padStart(6, '0');
  const bytes = ENCODER.encode(s);
  block.fill(0, TAR_OFF_CHKSUM, TAR_OFF_CHKSUM + TAR_LEN_CHKSUM);
  block.set(bytes.subarray(0, 6), TAR_OFF_CHKSUM);
  block[TAR_OFF_CHKSUM + 6] = 0x00;
  block[TAR_OFF_CHKSUM + 7] = 0x20;
}

function ceilToBlock(size: number): number {
  return TAR_BLOCK_SIZE * Math.ceil(size / TAR_BLOCK_SIZE);
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid POSIX ustar TAR archive.
 *
 * @param entries  Array of entry descriptors.
 * @returns        Uint8Array containing a valid TAR archive.
 */
export function buildTar(entries: TarEntry[]): Uint8Array {
  // Calculate total size
  let totalSize = 0;
  for (const entry of entries) {
    totalSize += TAR_BLOCK_SIZE; // header
    const dataLen = entry.isDirectory ? 0 : (entry.bytes?.length ?? 0);
    if (dataLen > 0) {
      totalSize += ceilToBlock(dataLen);
    }
  }
  totalSize += TAR_BLOCK_SIZE * 2; // EOA

  const out = new Uint8Array(totalSize);
  let pos = 0;

  for (const entry of entries) {
    const dataBytes = entry.isDirectory ? new Uint8Array(0) : (entry.bytes ?? new Uint8Array(0));
    const mtime = Math.floor((entry.modified ?? new Date('2024-01-01T00:00:00Z')).getTime() / 1000);
    const mode = entry.mode ?? (entry.isDirectory ? 0o755 : 0o644);

    const header = new Uint8Array(TAR_BLOCK_SIZE);

    writeString(header, TAR_OFF_NAME, TAR_LEN_NAME, entry.name);
    writeOctal(header, TAR_OFF_MODE, 8, mode);
    writeOctal(header, 108, 8, 0); // uid
    writeOctal(header, 116, 8, 0); // gid
    writeOctal(header, TAR_OFF_SIZE, 12, dataBytes.length);
    writeOctal(header, TAR_OFF_MTIME, 12, mtime);

    header[TAR_OFF_TYPEFLAG] = entry.isDirectory
      ? TAR_TYPEFLAG_DIRECTORY.charCodeAt(0)
      : TAR_TYPEFLAG_FILE.charCodeAt(0);

    // Magic + version
    writeString(header, TAR_OFF_MAGIC, 6, TAR_MAGIC);
    writeString(header, TAR_OFF_VERSION, 2, TAR_VERSION);

    // uname / gname
    writeString(header, TAR_OFF_UNAME, TAR_LEN_UNAME, entry.uname ?? 'root');
    writeString(header, TAR_OFF_GNAME, TAR_LEN_GNAME, entry.gname ?? 'root');

    // Checksum: write 8 spaces, compute, overwrite
    header.fill(0x20, TAR_OFF_CHKSUM, TAR_OFF_CHKSUM + TAR_LEN_CHKSUM);
    const checksum = computeChecksum(header);
    writeChecksum(header, checksum);

    out.set(header, pos);
    pos += TAR_BLOCK_SIZE;

    if (dataBytes.length > 0) {
      out.set(dataBytes, pos);
      pos += ceilToBlock(dataBytes.length);
    }
  }

  // EOA: two zero blocks (already zero-filled)
  return out;
}

/**
 * Build a TAR archive with a corrupted checksum in the first entry header.
 * Used for testing TarChecksumError.
 */
export function buildTarWithBadChecksum(entries: TarEntry[]): Uint8Array {
  const tar = buildTar(entries);
  // Corrupt the checksum field of the first header (offset 148)
  tar[TAR_OFF_CHKSUM] = 0x00;
  tar[TAR_OFF_CHKSUM + 1] = 0x00;
  tar[TAR_OFF_CHKSUM + 2] = 0x00;
  tar[TAR_OFF_CHKSUM + 3] = 0x00;
  tar[TAR_OFF_CHKSUM + 4] = 0x00;
  tar[TAR_OFF_CHKSUM + 5] = 0x00;
  tar[TAR_OFF_CHKSUM + 6] = 0x00;
  tar[TAR_OFF_CHKSUM + 7] = 0x00;
  return tar;
}
