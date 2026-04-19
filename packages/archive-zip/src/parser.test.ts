/**
 * Tests for the top-level archive format detector and dispatcher.
 *
 * Covers:
 *   - ZIP dispatch
 *   - TAR dispatch
 *   - GZip dispatch (single-member)
 *   - tar.gz round-trip
 *   - bz2 magic → ArchiveBz2NotSupportedError
 *   - xz magic → ArchiveXzNotSupportedError
 *   - Multi-member gzip rejection
 */

import { describe, expect, it } from 'vitest';
import { buildGzip } from './_test-helpers/build-gzip.ts';
import { buildTar } from './_test-helpers/build-tar.ts';
import { buildZip } from './_test-helpers/build-zip.ts';
import { MAX_INPUT_BYTES } from './constants.ts';
import {
  ArchiveBz2NotSupportedError,
  ArchiveInputTooLargeError,
  GzipMultiMemberNotSupportedError,
} from './errors.ts';
import { ArchiveXzNotSupportedError } from './errors.ts';
import { parseArchive } from './parser.ts';
import { serializeTar } from './tar-serializer.ts';

// ---------------------------------------------------------------------------
// ZIP dispatch
// ---------------------------------------------------------------------------

describe('parseArchive - ZIP', () => {
  it('detects and parses a ZIP archive', async () => {
    const zip = buildZip([{ name: 'test.txt', bytes: new TextEncoder().encode('hello') }]);
    const result = await parseArchive(zip);
    expect(result.kind).toBe('zip');
    if (result.kind === 'zip') {
      expect(result.file.entries).toHaveLength(1);
      expect(result.file.entries[0]!.name).toBe('test.txt');
    }
  });
});

// ---------------------------------------------------------------------------
// TAR dispatch
// ---------------------------------------------------------------------------

describe('parseArchive - TAR', () => {
  it('detects and parses a TAR archive', async () => {
    const tar = buildTar([{ name: 'file.txt', bytes: new TextEncoder().encode('tar content') }]);
    const result = await parseArchive(tar);
    expect(result.kind).toBe('tar');
    if (result.kind === 'tar') {
      expect(result.file.entries).toHaveLength(1);
      expect(result.file.entries[0]!.name).toBe('file.txt');
    }
  });
});

// ---------------------------------------------------------------------------
// GZip dispatch
// ---------------------------------------------------------------------------

describe('parseArchive - GZip', () => {
  it('decompresses single-member gzip via DecompressionStream wrapper', async () => {
    const content = new TextEncoder().encode('gzip test content');
    const gzipped = await buildGzip(content);
    const result = await parseArchive(gzipped);
    expect(result.kind).toBe('gzip');
    if (result.kind === 'gzip') {
      expect(new TextDecoder().decode(result.payload)).toBe('gzip test content');
    }
  });
});

// ---------------------------------------------------------------------------
// tar.gz dispatch
// ---------------------------------------------------------------------------

describe('parseArchive - tar.gz', () => {
  it('tar.gz round-trip: gunzip then parseTar yields same entries as direct tar', async () => {
    // Build a TAR
    const tarBytes = buildTar([
      { name: 'inner.txt', bytes: new TextEncoder().encode('inner content') },
    ]);

    // Gzip the TAR
    const gzipped = await buildGzip(tarBytes);

    // Parse as tar.gz
    const result = await parseArchive(gzipped);
    expect(result.kind).toBe('tar.gz');

    if (result.kind === 'tar.gz') {
      expect(result.file.entries).toHaveLength(1);
      expect(result.file.entries[0]!.name).toBe('inner.txt');
      const data = await result.file.entries[0]!.data();
      expect(new TextDecoder().decode(data)).toBe('inner content');
    }
  });

  it('round-trip: serializeTar → gzip → parseArchive as tar.gz', async () => {
    const entries = [
      {
        name: 'a.txt',
        type: 'file' as const,
        size: 5,
        mode: 0o644,
        modified: new Date('2024-01-01T00:00:00Z'),
        uname: '',
        gname: '',
        data: async () => new TextEncoder().encode('hello'),
      },
    ];
    const tarBytes = await serializeTar({ entries });
    const gzipped = await buildGzip(tarBytes);
    const result = await parseArchive(gzipped);
    expect(result.kind).toBe('tar.gz');
    if (result.kind === 'tar.gz') {
      expect(result.file.entries[0]!.name).toBe('a.txt');
    }
  });
});

// ---------------------------------------------------------------------------
// bz2 / xz routing
// ---------------------------------------------------------------------------

describe('parseArchive - bz2/xz routing', () => {
  it('routes bzip2 magic to backend (ArchiveBz2NotSupportedError)', async () => {
    // bz2 magic: 0x42 0x5A 0x68 ('BZh')
    const bz2Magic = new Uint8Array([0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26]);
    await expect(parseArchive(bz2Magic)).rejects.toThrow(ArchiveBz2NotSupportedError);
  });

  it('routes xz magic to backend (ArchiveXzNotSupportedError)', async () => {
    // xz magic: 0xFD 0x37 0x7A 0x58 0x5A 0x00
    const xzMagic = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x04]);
    await expect(parseArchive(xzMagic)).rejects.toThrow(ArchiveXzNotSupportedError);
  });
});

// ---------------------------------------------------------------------------
// Sec-C-1: parseArchive MAX_INPUT_BYTES guard
// ---------------------------------------------------------------------------

describe('parseArchive - input size cap (Sec-C-1)', () => {
  it('throws ArchiveInputTooLargeError for input exceeding MAX_INPUT_BYTES', async () => {
    // Build a buffer that reports a length just over the cap without actually allocating 200 MiB.
    // We do this by sub-classing the array and overriding .length via a typed trick.
    // Instead: create a Proxy-backed fake Uint8Array with .length > MAX_INPUT_BYTES.
    // Simplest approach: allocate a small buffer, then override its .length property via
    // Object.defineProperty to simulate an oversized input.
    const tiny = new Uint8Array(8);
    Object.defineProperty(tiny, 'length', { value: MAX_INPUT_BYTES + 1, configurable: true });
    await expect(parseArchive(tiny)).rejects.toThrow(ArchiveInputTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// Sec-C-4: multi-member gzip detection
// ---------------------------------------------------------------------------

describe('parseArchive - multi-member gzip (Sec-C-4)', () => {
  it('throws GzipMultiMemberNotSupportedError for concatenated gzip members', async () => {
    // Build two real gzip members and concatenate them
    const member1 = await buildGzip(new TextEncoder().encode('member one'));
    const member2 = await buildGzip(new TextEncoder().encode('member two'));
    const multiMember = new Uint8Array(member1.length + member2.length);
    multiMember.set(member1, 0);
    multiMember.set(member2, member1.length);
    await expect(parseArchive(multiMember)).rejects.toThrow(GzipMultiMemberNotSupportedError);
  });
});
