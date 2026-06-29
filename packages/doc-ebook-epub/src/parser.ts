/**
 * `parseEpub` — read-only EPUB (OCF + OPF) reader.
 *
 * Pipeline (all security delegated to the composed packages):
 *   1. archive-zip `parseZip` (zip-slip + decompression-bomb caps).
 *   2. Validate the OCF `mimetype` entry (tolerant of absence).
 *   3. Read `META-INF/container.xml` → OPF path (ocf.ts).
 *   4. Read + parse the OPF package document (opf.ts) via data-text `parseXml`
 *      (DOCTYPE / ENTITY / XXE rejection).
 *   5. Resolve the spine to ordered content documents, with each href resolved
 *      RELATIVE TO THE OPF DIRECTORY and rejected if it escapes the ZIP root.
 *
 * Note: `parseEpub` is async because archive-zip exposes entry payloads through
 * an async `data()` accessor (Deflate decompression uses DecompressionStream).
 *
 * Clean-room from the W3C EPUB 3.3 OCF + Packages specifications.
 */

import { type ZipEntry, parseZip } from '@catlabtech/webcvt-archive-zip';
import { CONTAINER_PATH, EPUB_MIME, MAX_INPUT_BYTES, MIMETYPE_ENTRY } from './constants.ts';
import {
  EpubInputTooLargeError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubMissingContainerError,
  EpubMissingContentError,
  EpubMissingOpfError,
  EpubPathTraversalError,
} from './errors.ts';
import type { EpubBook, EpubChapter } from './model.ts';
import { parseContainerXml } from './ocf.ts';
import { parseOpf } from './opf.ts';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

/** Best-effort percent-decoding; malformed escapes pass through untouched. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Resolve a manifest/OPF href against a base directory (an array of zip-root
 * segments), normalising `.`/`..` and percent-encoding. Throws
 * {@link EpubPathTraversalError} if the result escapes the container root.
 */
export function resolveHref(baseDir: readonly string[], href: string): string {
  let raw = href;
  const hash = raw.indexOf('#');
  if (hash >= 0) raw = raw.slice(0, hash);
  const query = raw.indexOf('?');
  if (query >= 0) raw = raw.slice(0, query);

  const absolute = raw.startsWith('/');
  const stack: string[] = absolute ? [] : [...baseDir];

  for (const part of raw.split('/')) {
    const segment = safeDecode(part);
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) throw new EpubPathTraversalError(href);
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  if (stack.length === 0) throw new EpubPathTraversalError(href);
  return stack.join('/');
}

/** The directory segments of a zip-root-relative path (the path minus its file). */
function directoryOf(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  return segments.filter((s) => s.length > 0 && s !== '.');
}

/** Validate the OCF mimetype entry. Absence is tolerated; a wrong value is not. */
async function validateMimetype(entry: ZipEntry | undefined): Promise<void> {
  if (entry === undefined) return; // tolerated per OCF leniency
  const declared = UTF8_DECODER.decode(await entry.data()).trim();
  if (declared !== EPUB_MIME) {
    throw new EpubInvalidMimetypeError(declared, EPUB_MIME);
  }
}

/**
 * Parse a read-only EPUB from its raw container bytes.
 *
 * @throws {@link EpubInputTooLargeError}, the archive-zip / data-text typed
 *         errors, and the EPUB-specific typed errors in `errors.ts`.
 */
export async function parseEpub(input: Uint8Array): Promise<EpubBook> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new EpubInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  const zip = parseZip(input);
  const byName = new Map<string, ZipEntry>();
  for (const entry of zip.entries) byName.set(entry.name, entry);

  await validateMimetype(byName.get(MIMETYPE_ENTRY));

  const containerEntry = byName.get(CONTAINER_PATH);
  if (containerEntry === undefined) {
    throw new EpubMissingContainerError(CONTAINER_PATH);
  }
  const declaredOpfPath = parseContainerXml(await containerEntry.data());

  // Normalise the OPF path itself and reject any traversal in it.
  const opfPath = resolveHref([], declaredOpfPath);
  const opfEntry = byName.get(opfPath);
  if (opfEntry === undefined) {
    throw new EpubMissingOpfError(opfPath);
  }
  const parsed = parseOpf(await opfEntry.data());

  const opfDir = directoryOf(opfPath);
  const itemById = new Map(parsed.manifest.map((item) => [item.id, item]));

  const spine: EpubChapter[] = [];
  for (const idref of parsed.spineIdrefs) {
    const item = itemById.get(idref);
    if (item === undefined) {
      throw new EpubInvalidOpfError(`spine references unknown manifest id "${idref}".`);
    }
    const resolved = resolveHref(opfDir, item.href);
    const entry = byName.get(resolved);
    if (entry === undefined) {
      throw new EpubMissingContentError(resolved);
    }
    spine.push({ href: resolved, mediaType: item.mediaType, bytes: await entry.data() });
  }

  return {
    version: parsed.version,
    metadata: parsed.metadata,
    opfPath,
    spine,
    manifest: parsed.manifest,
  };
}
