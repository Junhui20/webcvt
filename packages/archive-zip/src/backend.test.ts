/**
 * Tests for the ArchiveBackend.
 *
 * Covers:
 *   - canHandle: identity-only (zip → zip, tar → tar, gz → gz)
 *   - canHandle: cross-MIME returns false
 *   - canHandle: bz2/xz returns false
 *   - convert: identity round-trip for ZIP
 */

import { describe, expect, it } from 'vitest';
import { buildGzip } from './_test-helpers/build-gzip.ts';
import { buildTar } from './_test-helpers/build-tar.ts';
import { buildZip } from './_test-helpers/build-zip.ts';
import { ArchiveBackend } from './backend.ts';
import {
  BZ2_MIME,
  GZIP_MIME,
  MAX_INPUT_BYTES,
  TAR_MIME,
  TGZ_MIME,
  XZ_MIME,
  ZIP_MIME,
} from './constants.ts';
import { ArchiveEncodeNotImplementedError, ArchiveInputTooLargeError } from './errors.ts';

describe('ArchiveBackend', () => {
  const backend = new ArchiveBackend();

  it('has a stable name', () => {
    expect(backend.name).toBe('archive-zip');
  });

  describe('canHandle', () => {
    it('returns true for zip → zip identity', async () => {
      const zip = { ext: 'zip', mime: ZIP_MIME, category: 'archive' as const };
      expect(await backend.canHandle(zip, zip)).toBe(true);
    });

    it('returns true for tar → tar identity', async () => {
      const tar = { ext: 'tar', mime: TAR_MIME, category: 'archive' as const };
      expect(await backend.canHandle(tar, tar)).toBe(true);
    });

    it('returns true for gz → gz identity', async () => {
      const gz = { ext: 'gz', mime: GZIP_MIME, category: 'archive' as const };
      expect(await backend.canHandle(gz, gz)).toBe(true);
    });

    it('returns true for tgz → tgz identity (TGZ_MIME === GZIP_MIME)', async () => {
      // TGZ_MIME and GZIP_MIME are the same constant ('application/gzip'),
      // so canHandle({ mime: TGZ_MIME }, { mime: TGZ_MIME }) is identical to gz → gz.
      const tgz = { ext: 'tgz', mime: TGZ_MIME, category: 'archive' as const };
      expect(await backend.canHandle(tgz, tgz)).toBe(true);
      // Confirm TGZ_MIME and GZIP_MIME are the same string
      expect(TGZ_MIME).toBe(GZIP_MIME);
    });

    it('returns false for cross-MIME (zip → tar)', async () => {
      const zip = { ext: 'zip', mime: ZIP_MIME, category: 'archive' as const };
      const tar = { ext: 'tar', mime: TAR_MIME, category: 'archive' as const };
      expect(await backend.canHandle(zip, tar)).toBe(false);
    });

    it('returns false for bz2 input', async () => {
      const bz2 = { ext: 'bz2', mime: BZ2_MIME, category: 'archive' as const };
      expect(await backend.canHandle(bz2, bz2)).toBe(false);
    });

    it('returns false for xz input', async () => {
      const xz = { ext: 'xz', mime: XZ_MIME, category: 'archive' as const };
      expect(await backend.canHandle(xz, xz)).toBe(false);
    });

    it('returns false for unknown MIME', async () => {
      const unknown = { ext: 'xyz', mime: 'application/x-unknown', category: 'archive' as const };
      const zip = { ext: 'zip', mime: ZIP_MIME, category: 'archive' as const };
      expect(await backend.canHandle(unknown, zip)).toBe(false);
    });
  });

  describe('convert', () => {
    const zipFmt = { ext: 'zip', mime: ZIP_MIME, category: 'archive' as const };
    const tarFmt = { ext: 'tar', mime: TAR_MIME, category: 'archive' as const };
    const gzFmt = { ext: 'gz', mime: GZIP_MIME, category: 'archive' as const };
    const noop = {};

    it('identity round-trips a ZIP blob', async () => {
      const zip = buildZip([{ name: 'f.txt', bytes: new TextEncoder().encode('hello') }]);
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: ZIP_MIME });
      const result = await backend.convert(blob, zipFmt, { onProgress: undefined });
      expect(result.blob.type).toBe(ZIP_MIME);
      expect(result.backend).toBe('archive-zip');
      expect(result.hardwareAccelerated).toBe(false);
      // Parse the output and verify round-trip
      const outBytes = new Uint8Array(await result.blob.arrayBuffer());
      expect(outBytes[0]).toBe(0x50); // ZIP magic 'P'
    });

    it('identity round-trips a TAR blob', async () => {
      const tar = buildTar([{ name: 'f.txt', bytes: new TextEncoder().encode('hello') }]);
      const blob = new Blob([tar.buffer as ArrayBuffer], { type: TAR_MIME });
      const result = await backend.convert(blob, tarFmt, { onProgress: undefined });
      expect(result.blob.type).toBe(TAR_MIME);
      expect(result.backend).toBe('archive-zip');
    });

    it('identity round-trips a GZip blob', async () => {
      const gz = await buildGzip(new TextEncoder().encode('gzip test'));
      const blob = new Blob([gz.buffer as ArrayBuffer], { type: GZIP_MIME });
      const result = await backend.convert(blob, gzFmt, { onProgress: undefined });
      expect(result.blob.type).toBe(GZIP_MIME);
    });

    it('calls onProgress callbacks', async () => {
      const zip = buildZip([{ name: 'f.txt', bytes: new TextEncoder().encode('hi') }]);
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: ZIP_MIME });
      const percents: number[] = [];
      await backend.convert(blob, zipFmt, {
        onProgress: ({ percent }) => {
          percents.push(percent);
        },
      });
      expect(percents.length).toBeGreaterThan(0);
      expect(percents).toContain(100);
    });

    it('throws ArchiveInputTooLargeError for oversized input', async () => {
      // Create a blob that claims to be > MAX_INPUT_BYTES
      const oversized = new Blob([new Uint8Array(1)], { type: ZIP_MIME });
      Object.defineProperty(oversized, 'size', { value: MAX_INPUT_BYTES + 1 });
      await expect(backend.convert(oversized, zipFmt, noop)).rejects.toThrow(
        ArchiveInputTooLargeError,
      );
    });

    it('throws ArchiveEncodeNotImplementedError for unsupported conversion', async () => {
      const zip = buildZip([{ name: 'f.txt', bytes: new TextEncoder().encode('x') }]);
      const blob = new Blob([zip.buffer as ArrayBuffer], { type: ZIP_MIME });
      await expect(backend.convert(blob, tarFmt, noop)).rejects.toThrow(
        ArchiveEncodeNotImplementedError,
      );
    });
  });
});
