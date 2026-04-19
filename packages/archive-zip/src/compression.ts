/**
 * Browser Compression Streams wrappers for @webcvt/archive-zip.
 *
 * Provides:
 *   - decompressBytes(): pipe a Uint8Array through DecompressionStream with
 *     incremental size-cap enforcement via a TransformStream counter (Trap #1).
 *   - compressBytes(): pipe a Uint8Array through CompressionStream.
 *   - decompressStream(): return a size-capped ReadableStream for huge entries.
 *   - collectStream(): drain a ReadableStream<Uint8Array> into a Uint8Array.
 *
 * Algorithm strings:
 *   'deflate-raw' — ZIP method 8 (raw Deflate, no zlib header). Trap #10.
 *   'gzip'        — GZip member envelope. RFC 1952.
 *   'deflate'     — NOT used by this package (zlib-wrapped; would fail on ZIP entries).
 *
 * Size-cap enforcement (Trap #1):
 *   A TransformStream counts outgoing bytes. When the count exceeds the
 *   per-entry cap, controller.error() is called to abort decompression
 *   BEFORE the full allocation happens. This prevents zip-bomb OOM.
 */

import { MAX_ENTRY_UNCOMPRESSED_BYTES } from './constants.ts';
import { ArchiveEntrySizeCapError, ArchiveTotalSizeCapError } from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Algorithms supported by the W3C Compression Streams spec. */
export type CompressionAlgorithm = 'deflate-raw' | 'gzip' | 'deflate';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect all chunks from a ReadableStream<Uint8Array> into a single Uint8Array.
 */
export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const reader = stream.getReader();
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

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0] as Uint8Array;

  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Build a TransformStream that counts bytes and errors when a cap is exceeded.
 * Used to enforce per-entry and cumulative size caps during decompression (Trap #1).
 */
function makeSizeCapTransform(
  entryName: string,
  perEntryCap: number,
  cumulativeRef: { current: number; cap: number },
): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.length;
      cumulativeRef.current += chunk.length;

      if (seen > perEntryCap) {
        controller.error(new ArchiveEntrySizeCapError(entryName, seen, perEntryCap));
        return;
      }

      if (cumulativeRef.current > cumulativeRef.cap) {
        controller.error(new ArchiveTotalSizeCapError(cumulativeRef.current, cumulativeRef.cap));
        return;
      }

      controller.enqueue(chunk);
    },
  });
}

/**
 * Create a Uint8Array-backed ReadableStream (works in Node + browser).
 */
function bytesToStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decompress bytes using the specified algorithm.
 *
 * Enforces per-entry and cumulative size caps via a streaming TransformStream
 * counter (Trap #1 — caps enforced BEFORE full allocation).
 *
 * @param compressed      Compressed byte slice.
 * @param algorithm       Decompression algorithm ('deflate-raw' for ZIP, 'gzip' for gz).
 * @param entryName       Used in error messages.
 * @param cumulativeState Shared mutable object tracking cumulative decompressed bytes.
 */
export async function decompressBytes(
  compressed: Uint8Array,
  algorithm: CompressionAlgorithm,
  entryName: string,
  cumulativeState: { current: number; cap: number },
): Promise<Uint8Array> {
  const sourceStream = bytesToStream(compressed);
  const decomp = new DecompressionStream(algorithm);
  const capTransform = makeSizeCapTransform(
    entryName,
    MAX_ENTRY_UNCOMPRESSED_BYTES,
    cumulativeState,
  );

  // Pipe manually to avoid type mismatch: DecompressionStream.writable is
  // WritableStream<BufferSource> while ReadableStream.pipeThrough expects
  // WritableStream<Uint8Array>. Both accept Uint8Array at runtime.
  const outputStream = (sourceStream as ReadableStream<Uint8Array>)
    .pipeThrough(decomp as unknown as TransformStream<Uint8Array, Uint8Array>)
    .pipeThrough(capTransform);

  return collectStream(outputStream);
}

/**
 * Compress bytes using the specified algorithm.
 *
 * @param data       Raw bytes to compress.
 * @param algorithm  Compression algorithm ('deflate-raw' for ZIP, 'gzip' for gz).
 */
export async function compressBytes(
  data: Uint8Array,
  algorithm: CompressionAlgorithm,
): Promise<Uint8Array> {
  const sourceStream = bytesToStream(data);
  const compStream = new CompressionStream(algorithm);
  return collectStream(
    sourceStream.pipeThrough(compStream as unknown as TransformStream<Uint8Array, Uint8Array>),
  );
}

/**
 * Return a size-capped readable stream for lazy streaming of large entries.
 *
 * @param compressed      Compressed bytes.
 * @param algorithm       Decompression algorithm.
 * @param entryName       Used in error messages.
 * @param cumulativeState Shared cumulative state.
 */
export function decompressStream(
  compressed: Uint8Array,
  algorithm: CompressionAlgorithm,
  entryName: string,
  cumulativeState: { current: number; cap: number },
): ReadableStream<Uint8Array> {
  const sourceStream = bytesToStream(compressed);
  const decomp = new DecompressionStream(algorithm);
  const capTransform = makeSizeCapTransform(
    entryName,
    MAX_ENTRY_UNCOMPRESSED_BYTES,
    cumulativeState,
  );
  return (sourceStream as ReadableStream<Uint8Array>)
    .pipeThrough(decomp as unknown as TransformStream<Uint8Array, Uint8Array>)
    .pipeThrough(capTransform);
}
