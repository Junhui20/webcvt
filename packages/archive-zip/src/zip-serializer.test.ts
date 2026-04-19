/**
 * Tests for the ZIP muxer (serializer).
 *
 * Covers:
 *   - Round-trip: serializeZip → parseZip preserves all entry tuples
 *   - Stored and deflate method selection
 *   - Directory entries
 *   - Entry count cap
 */

import { describe, expect, it } from 'vitest';
import { ZipTooManyEntriesError } from './errors.ts';
import { parseZip } from './zip-parser.ts';
import type { ZipEntry } from './zip-parser.ts';
import { serializeZip } from './zip-serializer.ts';

// ---------------------------------------------------------------------------
// Helper: create a minimal ZipEntry with pre-resolved data
// ---------------------------------------------------------------------------

function makeEntry(
  name: string,
  content: string,
  modified = new Date('2024-01-01T00:00:00Z'),
): ZipEntry {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    method: 0,
    crc32: 0,
    compressedSize: bytes.length,
    uncompressedSize: bytes.length,
    modified,
    isDirectory: false,
    localHeaderOffset: 0,
    data: async () => bytes,
    stream: () => new ReadableStream(),
  };
}

function makeDirEntry(name: string): ZipEntry {
  return {
    name,
    method: 0,
    crc32: 0,
    compressedSize: 0,
    uncompressedSize: 0,
    modified: new Date('2024-01-01T00:00:00Z'),
    isDirectory: true,
    localHeaderOffset: 0,
    data: async () => new Uint8Array(0),
    stream: () => new ReadableStream(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeZip', () => {
  it('round-trip: serializeZip → parseZip preserves all entry tuples', async () => {
    const entries = [
      makeEntry('file1.txt', 'content one'),
      makeEntry('file2.txt', 'content two'),
      makeEntry('dir/nested.txt', 'nested content'),
    ];
    const zipBytes = await serializeZip({ entries, comment: '' });

    const parsed = parseZip(zipBytes);
    expect(parsed.entries).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const original = entries[i]!;
      const recovered = parsed.entries[i]!;
      expect(recovered.name).toBe(original.name);
      const origData = await original.data();
      const recovData = await recovered.data();
      expect(new TextDecoder().decode(recovData)).toBe(new TextDecoder().decode(origData));
    }
  });

  it('produces a valid ZIP with stored method', async () => {
    const entries = [makeEntry('stored.txt', 'hello stored')];
    const zipBytes = await serializeZip({ entries, comment: '' }, { method: 0 });
    const parsed = parseZip(zipBytes);
    expect(parsed.entries[0]!.method).toBe(0);
    const data = await parsed.entries[0]!.data();
    expect(new TextDecoder().decode(data)).toBe('hello stored');
  });

  it('produces a valid ZIP with deflate method', async () => {
    const content =
      'This content is long enough to be compressed by deflate algorithm and save space';
    const entries = [makeEntry('deflated.txt', content)];
    const zipBytes = await serializeZip({ entries, comment: '' }, { method: 8 });
    const parsed = parseZip(zipBytes);
    // Method 8 requested, but serializer may fall back to 0 if deflate is larger
    const data = await parsed.entries[0]!.data();
    expect(new TextDecoder().decode(data)).toBe(content);
  });

  it('serializes directory entries correctly', async () => {
    const entries = [makeDirEntry('mydir/'), makeEntry('mydir/file.txt', 'inside dir')];
    const zipBytes = await serializeZip({ entries, comment: '' });
    const parsed = parseZip(zipBytes);
    expect(parsed.entries[0]!.isDirectory).toBe(true);
    expect(parsed.entries[0]!.name).toBe('mydir/');
    expect(parsed.entries[1]!.isDirectory).toBe(false);
  });

  it('serializes an empty ZIP (zero entries)', async () => {
    const zipBytes = await serializeZip({ entries: [], comment: '' });
    const parsed = parseZip(zipBytes);
    expect(parsed.entries).toHaveLength(0);
  });

  it('throws ZipTooManyEntriesError when entries exceed cap', async () => {
    // We just create a mock file with too many entries (don't actually allocate them)
    const mockFile = {
      entries: new Array(65537).fill(makeEntry('f.txt', 'x')),
      comment: '',
    };
    await expect(serializeZip(mockFile)).rejects.toThrow(ZipTooManyEntriesError);
  });

  it('preserves modification dates in round-trip', async () => {
    const modified = new Date('2023-06-15T12:00:00Z');
    const entries = [makeEntry('dated.txt', 'content', modified)];
    const zipBytes = await serializeZip({ entries, comment: '' });
    const parsed = parseZip(zipBytes);
    const recoveredDate = parsed.entries[0]!.modified;
    // MS-DOS time has 2-second resolution; year/month/day/hour/minute should match exactly
    expect(recoveredDate.getUTCFullYear()).toBe(2023);
    expect(recoveredDate.getUTCMonth()).toBe(5); // June
    expect(recoveredDate.getUTCDate()).toBe(15);
    expect(recoveredDate.getUTCHours()).toBe(12);
    expect(recoveredDate.getUTCMinutes()).toBe(0);
  });
});
