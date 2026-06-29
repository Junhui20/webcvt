/**
 * zlib (RFC 1950) compression helpers backed by the platform Compression Streams.
 *
 * WOFF 1.0 compresses each table with zlib — RFC 1950, i.e. a 2-byte zlib header
 * + raw DEFLATE + Adler-32 trailer. That is exactly what `CompressionStream('deflate')`
 * produces and `DecompressionStream('deflate')` consumes (NOT 'deflate-raw').
 * Available in browsers, Workers, and Node 18+.
 *
 * `inflate()` enforces a streaming output cap: a TransformStream counts decoded
 * bytes and aborts (via controller.error) the moment the running total would
 * exceed the cap — BEFORE the full allocation — so a decompression bomb cannot
 * exhaust memory.
 */

import {
  FontCompressionUnavailableError,
  FontDecompressionError,
  FontTableTooLargeError,
} from './errors.ts';

/** Drain a ReadableStream<Uint8Array> into a single Uint8Array. */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Wrap a Uint8Array in a single-chunk ReadableStream (Node + browser). */
function bytesToStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/** Compress bytes to zlib (RFC 1950) format for a WOFF table block. */
export async function deflate(input: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.CompressionStream === 'undefined') {
    throw new FontCompressionUnavailableError('CompressionStream');
  }
  const cs = new globalThis.CompressionStream('deflate');
  // Cast bridges a lib.dom typing gap: pipeThrough wants WritableStream<Uint8Array>
  // while CompressionStream.writable is typed WritableStream<BufferSource>.
  const output = bytesToStream(input).pipeThrough(
    cs as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
  return collectStream(output);
}

/**
 * Decompress zlib (RFC 1950) bytes, enforcing a streaming output cap.
 *
 * @param compressed Compressed table bytes.
 * @param cap        Per-table output cap (the declared origLength); decoding is
 *                   aborted if the output would exceed this.
 * @param tag        Table tag, for error messages.
 * @param budget     Shared mutable cumulative-output budget (decompression-bomb
 *                   guard across all tables).
 */
export async function inflate(
  compressed: Uint8Array,
  cap: number,
  tag: string,
  budget: { used: number; max: number },
): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream === 'undefined') {
    throw new FontCompressionUnavailableError('DecompressionStream');
  }

  let seen = 0;
  const capTransform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.length;
      budget.used += chunk.length;
      if (seen > cap) {
        controller.error(
          new FontTableTooLargeError(
            `table "${tag}" decompressed to more than its declared ${cap} bytes`,
          ),
        );
        return;
      }
      if (budget.used > budget.max) {
        controller.error(
          new FontTableTooLargeError(
            `cumulative decompressed output exceeded the cap of ${budget.max} bytes`,
          ),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const ds = new globalThis.DecompressionStream('deflate');
  try {
    const output = bytesToStream(compressed)
      .pipeThrough(ds as unknown as TransformStream<Uint8Array, Uint8Array>)
      .pipeThrough(capTransform);
    return await collectStream(output);
  } catch (err) {
    if (err instanceof FontTableTooLargeError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new FontDecompressionError(tag, detail);
  }
}
