/**
 * Synthetic GZip builder for tests.
 *
 * Wraps bytes in a minimal single-member gzip envelope (RFC 1952).
 * Used exclusively in tests — not exported from the package index.
 *
 * For actual gzip compression use compressGzip() from serializer.ts.
 * This helper is for building test inputs that bypass CompressionStream
 * (useful in Node.js test environments where CompressionStream may not be available).
 */

import { computeCrc32 } from '../crc32.ts';

// ---------------------------------------------------------------------------
// GZip header constants
// ---------------------------------------------------------------------------

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);
const GZIP_CM_DEFLATE = 0x08;
const GZIP_OS_UNKNOWN = 0xff;

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Wrap raw (uncompressed) bytes in a gzip member using
 * CompressionStream('gzip'). Returns a promise because gzip requires
 * async compression.
 *
 * In test environments that have CompressionStream available (Node 18+,
 * any browser), this produces a real gzip-compressed payload.
 */
export async function buildGzip(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const comp = new CompressionStream('gzip');
  const reader = source
    .pipeThrough(comp as unknown as TransformStream<Uint8Array, Uint8Array>)
    .getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      totalLength += result.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Build a minimal gzip header (10 bytes) with no optional fields.
 * The "compressed" data in this case is just the raw bytes stored
 * as-is for testing purposes (NOT actually deflate-compressed).
 *
 * This is used to test magic-byte detection and header parsing,
 * NOT for testing decompression correctness.
 *
 * Structure:
 *   [0x1F, 0x8B]  magic
 *   [0x08]        compression method (deflate)
 *   [0x00]        flags (no FNAME, no FEXTRA, etc.)
 *   [0x00 x4]     mtime = 0
 *   [0x00]        XFL
 *   [0xFF]        OS = unknown
 */
export function buildGzipHeader(): Uint8Array {
  const header = new Uint8Array(10);
  header[0] = GZIP_MAGIC[0] as number;
  header[1] = GZIP_MAGIC[1] as number;
  header[2] = GZIP_CM_DEFLATE;
  header[3] = 0x00; // FLG: no optional fields
  // mtime = 0 (bytes 4-7 already 0)
  header[8] = 0x00; // XFL
  header[9] = GZIP_OS_UNKNOWN;
  return header;
}

/**
 * Build a gzip member with the FNAME flag set.
 * Used for testing originalName extraction in parseArchive.
 */
export async function buildGzipWithFname(data: Uint8Array, fname: string): Promise<Uint8Array> {
  // First compress the data, then parse and re-header is complex.
  // Instead: compress with native API and note fname is normally embedded by the OS tool.
  // For tests, we build the header manually and use the compressed data from buildGzip.
  const compressed = await buildGzip(data);
  // The native CompressionStream('gzip') doesn't embed FNAME.
  // For FNAME testing, we'll construct a manual header followed by the raw deflate data.
  // Extract the raw deflate body from the gzip (skip 10-byte header, strip 8-byte trailer).
  const deflateBody = compressed.subarray(10, compressed.length - 8);

  const fnameBytes = new TextEncoder().encode(fname);
  const fnameNul = new Uint8Array(fnameBytes.length + 1);
  fnameNul.set(fnameBytes);
  fnameNul[fnameBytes.length] = 0;

  // Compute CRC32 and ISIZE for the original uncompressed data
  const crc = computeCrc32(data);
  const isize = data.length >>> 0;

  // Build header with FNAME flag
  const header = new Uint8Array(10 + fnameNul.length);
  header[0] = 0x1f;
  header[1] = 0x8b;
  header[2] = 0x08; // CM = deflate
  header[3] = 0x08; // FLG: FNAME set
  // mtime = 0
  header[8] = 0x00; // XFL
  header[9] = 0xff; // OS = unknown
  header.set(fnameNul, 10);

  // Trailer: CRC32 + ISIZE (LE)
  const trailer = new Uint8Array(8);
  trailer[0] = crc & 0xff;
  trailer[1] = (crc >> 8) & 0xff;
  trailer[2] = (crc >> 16) & 0xff;
  trailer[3] = (crc >> 24) & 0xff;
  trailer[4] = isize & 0xff;
  trailer[5] = (isize >> 8) & 0xff;
  trailer[6] = (isize >> 16) & 0xff;
  trailer[7] = (isize >> 24) & 0xff;

  const out = new Uint8Array(header.length + deflateBody.length + trailer.length);
  out.set(header, 0);
  out.set(deflateBody, header.length);
  out.set(trailer, header.length + deflateBody.length);
  return out;
}
