/**
 * Tests for cross-container conversion (Task 5): zip ↔ tar.
 *
 * Covers, per the task brief:
 *   - entry round-trip zip → tar → zip preserving names / mtimes / content
 *   - nested directories
 *   - empty archive
 *   - encrypted-zip rejection (typed error, enforced by parseZip on the new path)
 *   - unsupported entry type (tar symlink) rejection (typed error, parseTar)
 *   - decompression-bomb cap enforcement on the new path
 *   - lossy-field documentation (owner names / mode dropped, comment dropped)
 *   - canCrossContainers gate truth table
 */

import { describe, expect, it } from 'vitest';
import { buildTar } from './_test-helpers/build-tar.ts';
import { buildZip } from './_test-helpers/build-zip.ts';
import { ArchiveBackend } from './backend.ts';
import {
  TAR_BLOCK_SIZE,
  TAR_LEN_CHKSUM,
  TAR_MIME,
  TAR_OFF_CHKSUM,
  TAR_OFF_TYPEFLAG,
  ZIP_MIME,
} from './constants.ts';
import { canCrossContainers, tarToZip, zipToTar } from './cross.ts';
import {
  TarUnsupportedTypeflagError,
  ZipCompressionRatioError,
  ZipEncryptedNotSupportedError,
} from './errors.ts';
import { parseTar } from './tar-parser.ts';
import { parseZip } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const zipFmt = { ext: 'zip', mime: ZIP_MIME, category: 'archive' as const };
const tarFmt = { ext: 'tar', mime: TAR_MIME, category: 'archive' as const };
const noop = {};
const enc = new TextEncoder();
const dec = new TextDecoder();

function blobOf(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Find the first central-directory record and mutate it via a DataView. */
function patchZipCd(zip: Uint8Array, fn: (view: DataView, cdOffset: number) => void): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 4; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      fn(view, i);
      return;
    }
  }
  throw new Error('central directory signature not found');
}

/** Overwrite a tar header's typeflag and recompute its checksum. */
function setTarTypeflag(tar: Uint8Array, headerOffset: number, typeflag: string): void {
  tar[headerOffset + TAR_OFF_TYPEFLAG] = typeflag.charCodeAt(0);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    const inChksum = i >= TAR_OFF_CHKSUM && i < TAR_OFF_CHKSUM + TAR_LEN_CHKSUM;
    sum += inChksum ? 0x20 : (tar[headerOffset + i] ?? 0);
  }
  const octal = enc.encode(sum.toString(8).padStart(6, '0'));
  tar.fill(0, headerOffset + TAR_OFF_CHKSUM, headerOffset + TAR_OFF_CHKSUM + TAR_LEN_CHKSUM);
  tar.set(octal.subarray(0, 6), headerOffset + TAR_OFF_CHKSUM);
  tar[headerOffset + TAR_OFF_CHKSUM + 6] = 0x00;
  tar[headerOffset + TAR_OFF_CHKSUM + 7] = 0x20;
}

// ---------------------------------------------------------------------------
// canCrossContainers gate
// ---------------------------------------------------------------------------

describe('canCrossContainers', () => {
  it('accepts zip → tar and tar → zip', () => {
    expect(canCrossContainers(ZIP_MIME, TAR_MIME)).toBe(true);
    expect(canCrossContainers(TAR_MIME, ZIP_MIME)).toBe(true);
  });

  it('rejects identity pairs (handled by the identity route instead)', () => {
    expect(canCrossContainers(ZIP_MIME, ZIP_MIME)).toBe(false);
    expect(canCrossContainers(TAR_MIME, TAR_MIME)).toBe(false);
  });

  it('rejects gz on either side (compression wrapper, not a container)', () => {
    expect(canCrossContainers('application/gzip', TAR_MIME)).toBe(false);
    expect(canCrossContainers(ZIP_MIME, 'application/gzip')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end round-trip via ArchiveBackend
// ---------------------------------------------------------------------------

describe('ArchiveBackend cross-container convert', () => {
  const backend = new ArchiveBackend();

  it('round-trips zip → tar → zip preserving names, mtimes and content', async () => {
    const t1 = new Date('2023-05-15T10:20:30Z'); // even seconds (MS-DOS 2s grid)
    const t2 = new Date('2021-11-02T08:00:00Z');
    const srcZip = buildZip([
      { name: 'readme.txt', bytes: enc.encode('hello cross world'), modified: t1 },
      { name: 'data/values.csv', bytes: enc.encode('a,b\n1,2\n'), modified: t2 },
    ]);

    // zip → tar
    const tarRes = await backend.convert(blobOf(srcZip, ZIP_MIME), tarFmt, noop);
    expect(tarRes.blob.type).toBe(TAR_MIME);
    expect(tarRes.backend).toBe('archive-zip');
    const tarBytes = await bytesOf(tarRes.blob);
    // Sanity: it is a real ustar archive with the two entries.
    const tarParsed = parseTar(tarBytes);
    expect(tarParsed.entries.map((e) => e.name)).toEqual(['readme.txt', 'data/values.csv']);

    // tar → zip
    const zipRes = await backend.convert(blobOf(tarBytes, TAR_MIME), zipFmt, noop);
    expect(zipRes.blob.type).toBe(ZIP_MIME);
    const finalZip = parseZip(await bytesOf(zipRes.blob));

    expect(finalZip.entries.map((e) => e.name)).toEqual(['readme.txt', 'data/values.csv']);
    expect(finalZip.entries.map((e) => e.modified.getTime())).toEqual([t1.getTime(), t2.getTime()]);
    expect(dec.decode(await finalZip.entries[0]!.data())).toBe('hello cross world');
    expect(dec.decode(await finalZip.entries[1]!.data())).toBe('a,b\n1,2\n');
  });

  it('preserves nested directory entries through zip → tar → zip', async () => {
    const dir = new Date('2022-01-01T00:00:00Z');
    const srcZip = buildZip([
      { name: 'top/', bytes: new Uint8Array(0), modified: dir, isDirectory: true },
      { name: 'top/sub/', bytes: new Uint8Array(0), modified: dir, isDirectory: true },
      { name: 'top/sub/f.txt', bytes: enc.encode('nested'), modified: dir },
    ]);

    const tarBytes = await bytesOf(
      (await backend.convert(blobOf(srcZip, ZIP_MIME), tarFmt, noop)).blob,
    );
    const tarParsed = parseTar(tarBytes);
    expect(tarParsed.entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      'directory:top/',
      'directory:top/sub/',
      'file:top/sub/f.txt',
    ]);

    const finalZip = parseZip(
      await bytesOf((await backend.convert(blobOf(tarBytes, TAR_MIME), zipFmt, noop)).blob),
    );
    expect(finalZip.entries.map((e) => `${e.isDirectory}:${e.name}`)).toEqual([
      'true:top/',
      'true:top/sub/',
      'false:top/sub/f.txt',
    ]);
    expect(dec.decode(await finalZip.entries[2]!.data())).toBe('nested');
  });

  it('round-trips an empty archive both directions', async () => {
    const emptyZip = buildZip([]);
    const tarBytes = await bytesOf(
      (await backend.convert(blobOf(emptyZip, ZIP_MIME), tarFmt, noop)).blob,
    );
    expect(parseTar(tarBytes).entries).toHaveLength(0);

    const emptyTar = buildTar([]);
    const zipBytes = await bytesOf(
      (await backend.convert(blobOf(emptyTar, TAR_MIME), zipFmt, noop)).blob,
    );
    expect(parseZip(zipBytes).entries).toHaveLength(0);
  });

  it('reports progress and terminates at 100%', async () => {
    const srcZip = buildZip([{ name: 'f.txt', bytes: enc.encode('hi') }]);
    const percents: number[] = [];
    await backend.convert(blobOf(srcZip, ZIP_MIME), tarFmt, {
      onProgress: ({ percent }) => percents.push(percent),
    });
    expect(percents.length).toBeGreaterThan(0);
    expect(percents).toContain(100);
  });

  // -- rejections ----------------------------------------------------------

  it('rejects an encrypted ZIP entry on the zip → tar path', async () => {
    const zip = buildZip([{ name: 'secret.txt', bytes: enc.encode('x') }]);
    patchZipCd(zip, (_view, cdOffset) => {
      // Set general-purpose bit 0 (encrypted) at CD offset +8.
      zip[cdOffset + 8] = (zip[cdOffset + 8] ?? 0) | 0x01;
    });
    await expect(backend.convert(blobOf(zip, ZIP_MIME), tarFmt, noop)).rejects.toThrow(
      ZipEncryptedNotSupportedError,
    );
  });

  it('rejects a TAR symlink entry on the tar → zip path (unsupported type)', async () => {
    const tar = buildTar([{ name: 'link', bytes: new Uint8Array(0) }]);
    setTarTypeflag(tar, 0, '2'); // '2' = symlink
    await expect(backend.convert(blobOf(tar, TAR_MIME), zipFmt, noop)).rejects.toThrow(
      TarUnsupportedTypeflagError,
    );
  });

  it('enforces the compression-ratio bomb cap on the zip → tar path', async () => {
    const zip = buildZip([{ name: 'bomb.bin', bytes: enc.encode('x') }]);
    patchZipCd(zip, (view, cdOffset) => {
      view.setUint32(cdOffset + 20, 1, true); // compressedSize = 1
      view.setUint32(cdOffset + 24, 1001, true); // uncompressedSize = 1001 → >1000:1
    });
    await expect(backend.convert(blobOf(zip, ZIP_MIME), tarFmt, noop)).rejects.toThrow(
      ZipCompressionRatioError,
    );
  });
});

// ---------------------------------------------------------------------------
// Projection functions (lossy-field contract)
// ---------------------------------------------------------------------------

describe('zipToTar projection', () => {
  it('maps names/sizes/mtimes and drops owner + mode (zip has neither)', () => {
    const t = new Date('2020-06-01T12:00:00Z');
    const zip = parseZip(buildZip([{ name: 'a.txt', bytes: enc.encode('abc'), modified: t }]));
    const tar = zipToTar(zip);
    const e = tar.entries[0]!;
    expect(e.name).toBe('a.txt');
    expect(e.type).toBe('file');
    expect(e.size).toBe(3);
    expect(e.modified.getTime()).toBe(t.getTime());
    expect(e.uname).toBe(''); // ZIP has no owner user
    expect(e.gname).toBe(''); // ZIP has no owner group
    expect(e.mode).toBe(0); // deferred to serializeTar defaults
  });
});

describe('tarToZip projection', () => {
  it('maps names/sizes/mtimes/dir-flag and emits an empty archive comment', () => {
    const t = new Date('2019-03-03T03:03:02Z'); // even seconds
    const tar = parseTar(
      buildTar([
        { name: 'd/', bytes: new Uint8Array(0), isDirectory: true, modified: t },
        { name: 'd/f.bin', bytes: enc.encode('xyz'), modified: t },
      ]),
    );
    const zip = tarToZip(tar);
    expect(zip.comment).toBe(''); // TAR has no archive-level comment
    expect(zip.entries.map((e) => `${e.isDirectory}:${e.name}:${e.uncompressedSize}`)).toEqual([
      'true:d/:0',
      'false:d/f.bin:3',
    ]);
    expect(zip.entries[1]!.modified.getTime()).toBe(t.getTime());
  });
});
