/**
 * Top-level archive serializer.
 *
 * Routes to:
 *   - serializeZip for ZIP output
 *   - serializeTar for TAR output
 *   - compressGzip for GZip output
 */

import { compressBytes, decompressBytes } from './compression.ts';
import { MAX_TOTAL_UNCOMPRESSED_BYTES } from './constants.ts';
import type { TarFile } from './tar-parser.ts';
import { serializeTar } from './tar-serializer.ts';
import type { ZipFile } from './zip-parser.ts';
import { serializeZip } from './zip-serializer.ts';

// ---------------------------------------------------------------------------
// GZip decompression/compression convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Decompress a gzip-wrapped byte payload.
 *
 * Delegates to decompressBytes with a cumulative cap of MAX_TOTAL_UNCOMPRESSED_BYTES
 * (Sec-M-2: same cap as decompressBytes in compression.ts). Single-member only.
 */
export async function decompressGzip(input: Uint8Array): Promise<Uint8Array> {
  const cumulativeState = { current: 0, cap: MAX_TOTAL_UNCOMPRESSED_BYTES };
  return decompressBytes(input, 'gzip', '(gzip payload)', cumulativeState);
}

/**
 * Compress a byte payload into a gzip-wrapped envelope.
 *
 * Uses native CompressionStream('gzip'). Emits a single gzip member.
 */
export async function compressGzip(input: Uint8Array): Promise<Uint8Array> {
  return compressBytes(input, 'gzip');
}

// ---------------------------------------------------------------------------
// Re-exports for top-level convenience
// ---------------------------------------------------------------------------

export { serializeZip } from './zip-serializer.ts';
export { serializeTar } from './tar-serializer.ts';
