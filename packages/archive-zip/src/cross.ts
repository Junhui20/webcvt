/**
 * Cross-container projection for @catlabtech/webcvt-archive-zip.
 *
 * The package already ships a ZIP reader+writer, a TAR reader+writer, and a
 * gzip wrapper, all reachable through the identity paths in backend.ts
 * (zip→zip, tar→tar, gz→gz). This module adds the missing edge — the ability
 * to read entries from one *container* and re-emit them into the other —
 * without introducing any new container logic. It mirrors the data-text
 * value-bridge (`data-text/src/bridge.ts`): a small projection layer wired into
 * the backend, gated in `canHandle` alongside the untouched identity route.
 *
 * ## Scope: zip ↔ tar only
 * gzip is deliberately excluded. gzip is a single-stream *compression wrapper*
 * (RFC 1952), not a multi-entry archive container — it carries at most one
 * payload and no entry table — so there is no entry set to project to/from a
 * container. gz therefore stays identity-only (see `canCrossContainers`).
 *
 * ## What is preserved
 * - Entry **paths** (names) — copied verbatim; both readers have already run
 *   them through `validateEntryName` (zip-slip / path-traversal guard).
 * - **Directory** entries vs regular files — the discriminant maps directly
 *   (`ZipEntry.isDirectory` ↔ `TarEntry.type`).
 * - **mtimes** — carried across as `Date`. Note the ZIP side stores MS-DOS
 *   timestamps at **2-second** resolution, so a tar→zip projection rounds odd
 *   mtimes down to the even second (a property of the ZIP format, not of this
 *   projection).
 * - **File contents** — via the source entry's lazy `data()` accessor, which is
 *   reused as-is. This is load-bearing for security: every decompression cap
 *   (per-entry, cumulative, compression-ratio) and CRC check lives inside that
 *   accessor, so the read side of the cross path enforces exactly the same caps
 *   as the identity path. The write side then re-applies the target writer's own
 *   caps (`MAX_ZIP_ENTRIES` / `MAX_TAR_ENTRIES`, TAR's 100-byte name limit).
 *
 * ## What is lossy (documented, by direction)
 * - **zip → tar**: Unix mode/permissions are defaulted (the ZIP reader does not
 *   surface external-attribute permission bits, so `serializeTar`'s defaults —
 *   0o755 dir / 0o644 file — apply). Owner user/group names are empty (ZIP has
 *   no owner concept). The ZIP archive-level comment is dropped (TAR has none).
 *   Per-entry CRC-32 is validated on read then discarded (TAR has no per-entry
 *   CRC). Entry names longer than 100 bytes are rejected by `serializeTar`
 *   (`TarLongNameNotSupportedError`) — POSIX ustar's name limit; this writer
 *   does not emit PAX/GNU long-name records.
 * - **tar → zip**: Unix mode/permissions are dropped (the `ZipEntry` model
 *   carries no per-entry mode; the ZIP writer emits fixed external attributes).
 *   Owner user/group names (`uname`/`gname`) are dropped (ZIP has no owner
 *   concept). mtimes are quantised to the even second (MS-DOS 2-second grid).
 *
 * ## Rejections (typed errors)
 * Both rejections the task cares about are enforced *upstream* by the readers,
 * before an entry ever reaches this projection, and both are typed subclasses
 * of core `WebcvtError`:
 * - **Encrypted ZIP entries** → `parseZip` throws `ZipEncryptedNotSupportedError`.
 * - **Entry types neither container here can express** (symlinks, hardlinks,
 *   char/block devices, FIFOs, PAX/GNU records) → `parseTar` throws
 *   `TarUnsupportedTypeflagError` / `TarPaxNotSupportedError`; the ZIP reader
 *   only ever surfaces regular files and directories. Because both readers
 *   surface *exactly* the {file, directory} set — and both writers express that
 *   set — the projection itself is total and needs no additional entry-type
 *   gate. (This is the "check what the existing parsers surface" outcome.)
 */

import { TAR_MIME, ZIP_MIME } from './constants.ts';
import type { TarEntry, TarFile } from './tar-parser.ts';
import type { ZipEntry, ZipFile } from './zip-parser.ts';

// ---------------------------------------------------------------------------
// Cross-container gate
// ---------------------------------------------------------------------------

/**
 * Whether an `input → output` pair is a supported cross-*container* projection.
 *
 * True iff the pair is exactly zip↔tar (in either direction). Same-MIME pairs
 * are the identity route and are handled upstream in the backend, so this gate
 * intentionally returns false for them. gzip never participates — it is a
 * compression wrapper, not a container (see module doc).
 */
export function canCrossContainers(inputMime: string, outputMime: string): boolean {
  return (
    (inputMime === ZIP_MIME && outputMime === TAR_MIME) ||
    (inputMime === TAR_MIME && outputMime === ZIP_MIME)
  );
}

// ---------------------------------------------------------------------------
// zip → tar
// ---------------------------------------------------------------------------

/**
 * Project a parsed ZIP archive into a `TarFile` for `serializeTar`.
 *
 * The source `data()` accessor is reused verbatim so all decompression caps and
 * CRC validation still run on read. See module doc for what is lossy.
 */
export function zipToTar(zip: ZipFile): TarFile {
  const entries: TarEntry[] = zip.entries.map(
    (entry): TarEntry => ({
      name: entry.name,
      type: entry.isDirectory ? 'directory' : 'file',
      size: entry.uncompressedSize,
      // ZIP reader does not surface Unix mode; 0 lets serializeTar apply its
      // per-type default (0o755 dir / 0o644 file).
      mode: 0,
      modified: entry.modified,
      // ZIP has no owner user/group concept.
      uname: '',
      gname: '',
      data: entry.data,
    }),
  );
  return { entries };
}

// ---------------------------------------------------------------------------
// tar → zip
// ---------------------------------------------------------------------------

/**
 * Project a parsed TAR archive into a `ZipFile` for `serializeZip`.
 *
 * `serializeZip` recomputes `method`, `crc32`, `compressedSize`, and
 * `localHeaderOffset` from the resolved bytes, so those fields are placeholders
 * here. `stream()` is part of the `ZipEntry` contract but is unused on the write
 * path; it is implemented faithfully (over the shared `data()`) for completeness.
 */
export function tarToZip(tar: TarFile): ZipFile {
  const entries: ZipEntry[] = tar.entries.map((entry): ZipEntry => {
    const data = entry.data;
    return {
      name: entry.name,
      // Placeholders — serializeZip derives the real values from the bytes.
      method: 0,
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: entry.size,
      modified: entry.modified,
      isDirectory: entry.type === 'directory',
      localHeaderOffset: 0,
      data,
      stream: () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(await data());
            controller.close();
          },
        }),
    };
  });
  // TAR has no archive-level comment; ZIP writer emits an empty one.
  return { entries, comment: '' };
}
