/**
 * Tests for the TAR muxer (serializer).
 *
 * Covers:
 *   - Round-trip: serializeTar → parseTar preserves all entry tuples
 *   - Long name rejection
 *   - Entry count cap
 */

import { describe, expect, it } from 'vitest';
import { TarLongNameNotSupportedError, TarTooManyEntriesError } from './errors.ts';
import { parseTar } from './tar-parser.ts';
import type { TarEntry } from './tar-parser.ts';
import { serializeTar } from './tar-serializer.ts';

// ---------------------------------------------------------------------------
// Helper: create a minimal TarEntry
// ---------------------------------------------------------------------------

function makeEntry(
  name: string,
  content: string,
  type: 'file' | 'directory' = 'file',
  modified = new Date('2024-01-01T00:00:00Z'),
): TarEntry {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type,
    size: type === 'directory' ? 0 : bytes.length,
    mode: type === 'directory' ? 0o755 : 0o644,
    modified,
    uname: 'user',
    gname: 'group',
    data: async () => bytes,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeTar', () => {
  it('round-trip: serializeTar → parseTar preserves all entry tuples', async () => {
    const entries = [
      makeEntry('file1.txt', 'first file content'),
      makeEntry('file2.txt', 'second file content'),
    ];
    const tarBytes = await serializeTar({ entries });

    const parsed = parseTar(tarBytes);
    expect(parsed.entries).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      const original = entries[i]!;
      const recovered = parsed.entries[i]!;
      expect(recovered.name).toBe(original.name);
      expect(recovered.type).toBe('file');
      const origData = await original.data();
      const recovData = await recovered.data();
      expect(new TextDecoder().decode(recovData)).toBe(new TextDecoder().decode(origData));
    }
  });

  it('serializes directory entries correctly', async () => {
    const entries = [makeEntry('mydir/', '', 'directory'), makeEntry('mydir/file.txt', 'content')];
    const tarBytes = await serializeTar({ entries });
    const parsed = parseTar(tarBytes);
    expect(parsed.entries[0]!.type).toBe('directory');
    expect(parsed.entries[1]!.type).toBe('file');
  });

  it('output is a multiple of 512 bytes', async () => {
    const entries = [makeEntry('f.txt', 'hello')];
    const tarBytes = await serializeTar({ entries });
    expect(tarBytes.length % 512).toBe(0);
  });

  it('ends with 1024 bytes of zero (EOA marker)', async () => {
    const entries = [makeEntry('f.txt', 'hello')];
    const tarBytes = await serializeTar({ entries });
    // Last 1024 bytes should be zero
    for (let i = tarBytes.length - 1024; i < tarBytes.length; i++) {
      expect(tarBytes[i]).toBe(0);
    }
  });

  it('throws TarLongNameNotSupportedError for names > 100 bytes', async () => {
    const longName = 'a'.repeat(101);
    const entries = [makeEntry(longName, 'content')];
    await expect(serializeTar({ entries })).rejects.toThrow(TarLongNameNotSupportedError);
  });

  it('throws TarTooManyEntriesError when entries exceed cap', async () => {
    const mockFile = {
      entries: new Array(65537).fill(makeEntry('f.txt', 'x')),
    };
    await expect(serializeTar(mockFile)).rejects.toThrow(TarTooManyEntriesError);
  });

  it('preserves mode in round-trip', async () => {
    const entries = [makeEntry('f.sh', 'echo hello', 'file')];
    entries[0]!.mode = 0o755;
    const tarBytes = await serializeTar({ entries });
    const parsed = parseTar(tarBytes);
    expect(parsed.entries[0]!.mode).toBe(0o755);
  });

  it('handles entries with data at exact block boundaries', async () => {
    const data = new Uint8Array(512).fill(0x42); // 'B' * 512
    const entries = [
      {
        name: 'exact.bin',
        type: 'file' as const,
        size: 512,
        mode: 0o644,
        modified: new Date('2024-01-01T00:00:00Z'),
        uname: '',
        gname: '',
        data: async () => data,
      },
    ];
    const tarBytes = await serializeTar({ entries });
    const parsed = parseTar(tarBytes);
    const recovered = await parsed.entries[0]!.data();
    expect(recovered).toHaveLength(512);
    expect(recovered[0]).toBe(0x42);
  });
});
