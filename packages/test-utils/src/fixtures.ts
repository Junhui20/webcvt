import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the path to a fixture file under `tests/fixtures/`.
 *
 * Fixtures are stored at the repository root and referenced by relative path
 * (e.g., `audio/sine-1s-44100.wav`). They are committed to git but excluded
 * from the published npm package via `.npmignore`.
 *
 * @param relativePath Path relative to `tests/fixtures/`
 * @returns Absolute filesystem path
 */
export function fixturePath(relativePath: string): string {
  // This file lives at packages/test-utils/src/fixtures.ts.
  // Repo root is three levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'tests', 'fixtures', relativePath);
}

/**
 * Load a fixture file as raw bytes.
 *
 * @param relativePath Path relative to `tests/fixtures/`
 * @returns The file contents as a Uint8Array
 */
export async function loadFixture(relativePath: string): Promise<Uint8Array> {
  const buf = await readFile(fixturePath(relativePath));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Load a fixture file as a Blob (matches the browser API surface that
 * webcvt's public `convert()` function accepts).
 */
export async function loadFixtureBlob(relativePath: string, type = ''): Promise<Blob> {
  const bytes = await loadFixture(relativePath);
  // Cast to ArrayBuffer to satisfy TS5.7+ which narrows Uint8Array.buffer
  // to ArrayBufferLike (potentially SharedArrayBuffer). loadFixture always
  // returns a Uint8Array backed by a plain ArrayBuffer.
  return new Blob([bytes.buffer as ArrayBuffer], { type });
}
