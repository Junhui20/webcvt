/**
 * zlib (RFC 1950) compression via the platform CompressionStream.
 *
 * PDF's `FlateDecode` filter expects zlib-wrapped DEFLATE, which is exactly what
 * `new CompressionStream('deflate')` produces (NOT 'deflate-raw'). Available in
 * browsers, workers, and Node 18+.
 */

import { PdfEncodeError } from './errors.ts';

/** Compress bytes to zlib format for embedding as a PDF FlateDecode stream. */
export async function deflate(input: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.CompressionStream === 'undefined') {
    throw new PdfEncodeError(
      'CompressionStream is unavailable in this environment; cannot Flate-compress the image. ' +
        'Use a JPEG source (embedded losslessly without compression) or a runtime with CompressionStream.',
    );
  }

  const cs = new globalThis.CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // Cast bridges a lib.dom typing gap: write() wants BufferSource (ArrayBuffer-backed),
  // but Uint8Array is generic over ArrayBufferLike in TS 5.7+.
  void writer.write(input as BufferSource);
  void writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}
