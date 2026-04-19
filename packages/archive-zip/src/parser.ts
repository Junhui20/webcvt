/**
 * Top-level archive format detector and dispatcher.
 *
 * `parseArchive` inspects magic bytes and routes to:
 *   - ZIP: 'PK\x03\x04' at offset 0
 *   - GZip: 0x1F 0x8B at offset 0
 *   - TAR: 'ustar\0' at offset 257 (POSIX ustar)
 *   - bz2: 'BZh' at offset 0 → throws ArchiveBz2NotSupportedError
 *   - xz: 0xFD 0x37 0x7A 0x58 0x5A 0x00 at offset 0 → throws ArchiveXzNotSupportedError
 *
 * tar.gz detection: gzip magic at offset 0, then after gunzip the payload
 * begins with a ustar header at block offset 257.
 */

import { collectStream } from './compression.ts';
import {
  BZ2_MAGIC,
  GZIP_MAGIC_0,
  GZIP_MAGIC_1,
  MAX_INPUT_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  XZ_MAGIC,
  ZIP_LOCAL_HEADER_SIG,
} from './constants.ts';
import {
  ArchiveBz2NotSupportedError,
  ArchiveEntrySizeCapError,
  ArchiveInputTooLargeError,
  ArchiveXzNotSupportedError,
  GzipMultiMemberNotSupportedError,
} from './errors.ts';
import { parseTar } from './tar-parser.ts';
import type { TarFile } from './tar-parser.ts';
import { readU32LE } from './zip-headers.ts';
import { parseZip } from './zip-parser.ts';
import type { ZipFile } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminated union returned by parseArchive. */
export type ArchiveFile =
  | { kind: 'zip'; file: ZipFile }
  | { kind: 'tar'; file: TarFile }
  | { kind: 'gzip'; payload: Uint8Array; originalName?: string }
  | { kind: 'tar.gz'; file: TarFile };

// ---------------------------------------------------------------------------
// Magic-byte helpers
// ---------------------------------------------------------------------------

function isZipMagic(buf: Uint8Array): boolean {
  return readU32LE(buf, 0) === ZIP_LOCAL_HEADER_SIG;
}

function isGzipMagic(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1;
}

function isBz2Magic(buf: Uint8Array): boolean {
  if (buf.length < 3) return false;
  return buf[0] === BZ2_MAGIC[0] && buf[1] === BZ2_MAGIC[1] && buf[2] === BZ2_MAGIC[2];
}

function isXzMagic(buf: Uint8Array): boolean {
  if (buf.length < 6) return false;
  for (let i = 0; i < 6; i++) {
    if (buf[i] !== XZ_MAGIC[i]) return false;
  }
  return true;
}

function isTarMagic(buf: Uint8Array): boolean {
  // ustar magic at offset 257
  if (buf.length < 263) return false;
  return (
    buf[257] === 0x75 && // u
    buf[258] === 0x73 && // s
    buf[259] === 0x74 && // t
    buf[260] === 0x61 && // a
    buf[261] === 0x72 && // r
    buf[262] === 0x00 // \0
  );
}

// ---------------------------------------------------------------------------
// GZip FNAME extraction
// ---------------------------------------------------------------------------

/**
 * Extract the optional FNAME from a gzip member header (RFC 1952 §2.3).
 * Returns undefined if FNAME flag is not set or header is too short.
 */
function extractGzipFname(buf: Uint8Array): string | undefined {
  if (buf.length < 10) return undefined;
  const flg = buf[3] ?? 0;
  const FNAME_FLAG = 0x08;
  const FEXTRA_FLAG = 0x04;

  let pos = 10;

  // Skip FEXTRA if present
  if ((flg & FEXTRA_FLAG) !== 0) {
    if (pos + 2 > buf.length) return undefined;
    const xlen = (buf[pos] ?? 0) | ((buf[pos + 1] ?? 0) << 8);
    pos += 2 + xlen;
  }

  // Read FNAME if present (NUL-terminated)
  if ((flg & FNAME_FLAG) !== 0) {
    const start = pos;
    while (pos < buf.length && buf[pos] !== 0) pos++;
    const nameBytes = buf.subarray(start, pos);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(nameBytes);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Gunzip (size-capped + multi-member detection)
// ---------------------------------------------------------------------------

/**
 * A TransformStream that counts outgoing bytes and errors when the cap is exceeded.
 * Used to prevent decompression bombs in the gunzip path.
 */
function makeGunzipCapTransform(cap: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.length;
      if (seen > cap) {
        controller.error(new ArchiveEntrySizeCapError('(gzip payload)', seen, cap));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Scan input bytes for a second gzip member signature (Sec-C-4 / Trap #14).
 *
 * Strategy (b): after decompression, scan the raw input from offset 10 to end-2
 * looking for 0x1F 0x8B 0x08 (gzip magic + deflate method). If a second occurrence
 * exists AND it is not at offset 0, throw GzipMultiMemberNotSupportedError.
 */
function detectMultiMemberGzip(input: Uint8Array): void {
  // Start scanning at offset 10 (minimum gzip header size) to skip the first member's header
  for (let i = 10; i <= input.length - 3; i++) {
    if (input[i] === 0x1f && input[i + 1] === 0x8b && input[i + 2] === 0x08) {
      throw new GzipMultiMemberNotSupportedError();
    }
  }
}

/**
 * Decompress a single-member gzip payload.
 *
 * Enforces MAX_TOTAL_UNCOMPRESSED_BYTES cap via a size-counting TransformStream.
 * Detects and rejects multi-member gzip inputs.
 */
async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  // Sec-C-4: detect multi-member gzip before decompressing
  detectMultiMemberGzip(input);

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const decomp = new DecompressionStream('gzip');
  const capTransform = makeGunzipCapTransform(MAX_TOTAL_UNCOMPRESSED_BYTES);
  const decompressed = (source as ReadableStream<Uint8Array>)
    .pipeThrough(decomp as unknown as TransformStream<Uint8Array, Uint8Array>)
    .pipeThrough(capTransform);
  return collectStream(decompressed);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Detect and parse an archive from its raw bytes.
 *
 * @throws ArchiveBz2NotSupportedError when bz2 magic is detected.
 * @throws ArchiveXzNotSupportedError when xz magic is detected.
 */
export async function parseArchive(input: Uint8Array): Promise<ArchiveFile> {
  // Security cap — FIRST statement (Sec-C-1)
  if (input.length > MAX_INPUT_BYTES) {
    throw new ArchiveInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  // bz2 detection
  if (isBz2Magic(input)) {
    throw new ArchiveBz2NotSupportedError();
  }

  // xz detection
  if (isXzMagic(input)) {
    throw new ArchiveXzNotSupportedError();
  }

  // ZIP detection
  if (isZipMagic(input)) {
    const file = parseZip(input);
    return { kind: 'zip', file };
  }

  // GZip detection (could be .gz or .tar.gz)
  if (isGzipMagic(input)) {
    const originalName = extractGzipFname(input);
    const decompressed = await gunzip(input);

    // Check if the decompressed content is a TAR archive
    if (isTarMagic(decompressed)) {
      const file = parseTar(decompressed);
      return { kind: 'tar.gz', file };
    }

    return { kind: 'gzip', payload: decompressed, originalName };
  }

  // TAR detection (raw ustar at offset 257)
  if (isTarMagic(input)) {
    const file = parseTar(input);
    return { kind: 'tar', file };
  }

  // Unknown format — attempt ZIP parse (may fail with typed error)
  const file = parseZip(input);
  return { kind: 'zip', file };
}
