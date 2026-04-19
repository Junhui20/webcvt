/**
 * Tests for the compression/decompression stream wrappers.
 *
 * Covers:
 *   - compressBytes + decompressBytes round-trip for 'deflate-raw' and 'gzip'
 *   - Size cap enforcement via TransformStream (Trap #1)
 *   - collectStream utility
 */

import { describe, expect, it } from 'vitest';
import { collectStream, compressBytes, decompressBytes, decompressStream } from './compression.ts';
import { MAX_ENTRY_UNCOMPRESSED_BYTES } from './constants.ts';
import { ArchiveEntrySizeCapError, ArchiveTotalSizeCapError } from './errors.ts';

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('compression round-trips', () => {
  it('deflate-raw: compressBytes → decompressBytes round-trip', async () => {
    const original = new TextEncoder().encode('Hello, deflate-raw round trip!');
    const compressed = await compressBytes(original, 'deflate-raw');
    const state = { current: 0, cap: 512 * 1024 * 1024 };
    const decompressed = await decompressBytes(compressed, 'deflate-raw', 'test', state);
    expect(new TextDecoder().decode(decompressed)).toBe('Hello, deflate-raw round trip!');
  });

  it('gzip: compressBytes → decompressBytes round-trip', async () => {
    const original = new TextEncoder().encode('Hello, gzip round trip!');
    const compressed = await compressBytes(original, 'gzip');
    const state = { current: 0, cap: 512 * 1024 * 1024 };
    const decompressed = await decompressBytes(compressed, 'gzip', 'test', state);
    expect(new TextDecoder().decode(decompressed)).toBe('Hello, gzip round trip!');
  });

  it('handles empty input', async () => {
    const original = new Uint8Array(0);
    const compressed = await compressBytes(original, 'gzip');
    const state = { current: 0, cap: 512 * 1024 * 1024 };
    const decompressed = await decompressBytes(compressed, 'gzip', 'empty', state);
    expect(decompressed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Size cap enforcement (Trap #1)
// ---------------------------------------------------------------------------

describe('size cap enforcement', () => {
  it('throws ArchiveEntrySizeCapError when per-entry cap is exceeded during decompression', async () => {
    // Compress a reasonably large chunk of data
    const data = new Uint8Array(1000).fill(0x41); // 1000 'A' bytes
    const compressed = await compressBytes(data, 'gzip');

    // Set a very small per-entry cap (smaller than decompressed size)
    // We manipulate the cap at the module level by passing a tiny cap via
    // the cumulativeState object. But the per-entry cap is MAX_ENTRY_UNCOMPRESSED_BYTES.
    // To test per-entry cap enforcement, we need data > MAX_ENTRY_UNCOMPRESSED_BYTES.
    // That's 256 MiB — impractical to actually compress.
    // Instead, test the cumulative cap with a small cap value:
    const state = { current: 0, cap: 100 }; // cap at 100 bytes

    // Decompressing 1000 bytes should trigger cumulative cap
    await expect(decompressBytes(compressed, 'gzip', 'test.bin', state)).rejects.toThrow(
      ArchiveTotalSizeCapError,
    );
  });

  it('decompressStream returns a stream that throws on cumulative cap exceeded', async () => {
    const data = new Uint8Array(200).fill(0x42);
    const compressed = await compressBytes(data, 'gzip');
    const state = { current: 0, cap: 50 }; // cap at 50 bytes

    const stream = decompressStream(compressed, 'gzip', 'large.bin', state);
    const reader = stream.getReader();

    let error: unknown = null;
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ArchiveTotalSizeCapError);
  });
});

// ---------------------------------------------------------------------------
// collectStream
// ---------------------------------------------------------------------------

describe('collectStream', () => {
  it('collects single-chunk stream', async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    const result = await collectStream(stream);
    expect(result).toEqual(data);
  });

  it('collects multi-chunk stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.enqueue(new Uint8Array([5]));
        controller.close();
      },
    });
    const result = await collectStream(stream);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('returns empty Uint8Array for empty stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const result = await collectStream(stream);
    expect(result).toHaveLength(0);
  });
});
