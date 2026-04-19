/**
 * Lazy entry iterator with on-demand decompression and cap enforcement.
 *
 * Provides async iteration helpers for ZIP and TAR archives.
 * Used by consumers that want to process entries one at a time without
 * eagerly decompressing all of them into memory.
 */

import type { TarEntry, TarFile } from './tar-parser.ts';
import type { ZipEntry, ZipFile } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// ZIP entry iterator
// ---------------------------------------------------------------------------

/**
 * Async iterable over ZIP entries.
 *
 * Usage:
 *   for await (const { entry, data } of iterateZip(file)) {
 *     console.log(entry.name, data.length);
 *   }
 */
export async function* iterateZip(
  file: ZipFile,
): AsyncGenerator<{ entry: ZipEntry; data: Uint8Array }, void, unknown> {
  for (const entry of file.entries) {
    if (entry.isDirectory) continue;
    const data = await entry.data();
    yield { entry, data };
  }
}

/**
 * Async iterable over ZIP entries including directories.
 */
export async function* iterateZipAll(
  file: ZipFile,
): AsyncGenerator<{ entry: ZipEntry; data: Uint8Array | null }, void, unknown> {
  for (const entry of file.entries) {
    if (entry.isDirectory) {
      yield { entry, data: null };
    } else {
      const data = await entry.data();
      yield { entry, data };
    }
  }
}

// ---------------------------------------------------------------------------
// TAR entry iterator
// ---------------------------------------------------------------------------

/**
 * Async iterable over TAR file entries (skips directories).
 */
export async function* iterateTar(
  file: TarFile,
): AsyncGenerator<{ entry: TarEntry; data: Uint8Array }, void, unknown> {
  for (const entry of file.entries) {
    if (entry.type === 'directory') continue;
    const data = await entry.data();
    yield { entry, data };
  }
}

/**
 * Async iterable over all TAR entries including directories.
 */
export async function* iterateTarAll(
  file: TarFile,
): AsyncGenerator<{ entry: TarEntry; data: Uint8Array | null }, void, unknown> {
  for (const entry of file.entries) {
    if (entry.type === 'directory') {
      yield { entry, data: null };
    } else {
      const data = await entry.data();
      yield { entry, data };
    }
  }
}
