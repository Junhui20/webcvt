/**
 * ArchiveBackend — webcvt Backend implementation for ZIP / TAR / GZip archives.
 *
 * Capabilities:
 * - canHandle (identity): application/zip, application/x-tar, application/gzip
 *   round-trips (input.mime === output.mime).
 * - canHandle (cross-container): zip↔tar re-containering (see cross.ts). gzip is
 *   a compression wrapper, not a multi-entry container, so it stays identity-only.
 * - canHandle: everything else → false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (semantic round-trip).
 * - convert (cross): parse source container → project entries → serialize target.
 *
 * The identity route is byte-for-byte unchanged from the first pass. The cross
 * route follows the data-text Task 2 pattern: an explicit `canCrossContainers`
 * gate in canHandle sitting beside the untouched identity check, with the entry
 * projection isolated in cross.ts. Security caps are inherited unchanged — each
 * source entry's lazy `data()` accessor enforces the decompression-bomb / CRC
 * caps on read, and the target serializer re-applies its own caps on write.
 *
 * bz2/xz detection: canHandle returns false (routes to backend-wasm).
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import {
  BZ2_MIME,
  GZIP_MIME,
  MAX_INPUT_BYTES,
  TAR_MIME,
  TGZ_MIME,
  XZ_MIME,
  ZIP_MIME,
} from './constants.ts';
import { canCrossContainers, tarToZip, zipToTar } from './cross.ts';
import { ArchiveEncodeNotImplementedError, ArchiveInputTooLargeError } from './errors.ts';
import { compressGzip, decompressGzip } from './serializer.ts';
import { parseTar } from './tar-parser.ts';
import { serializeTar } from './tar-serializer.ts';
import { parseZip } from './zip-parser.ts';
import { serializeZip } from './zip-serializer.ts';

// ---------------------------------------------------------------------------
// Supported identity MIMEs
// ---------------------------------------------------------------------------

const SUPPORTED_MIMES = new Set([ZIP_MIME, TAR_MIME, GZIP_MIME]);

// ---------------------------------------------------------------------------
// ArchiveBackend
// ---------------------------------------------------------------------------

export class ArchiveBackend implements Backend {
  readonly name = 'archive-zip';

  /**
   * Returns true for two routes (mirrors data-text Task 2):
   *   - identity: input.mime === output.mime AND the MIME is in the supported
   *     set. Byte-for-byte unchanged from the first pass.
   *   - cross-container: zip↔tar (canCrossContainers). gz never cross-converts.
   *
   * bz2/xz return false so BackendRegistry routes to backend-wasm.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (input.mime === BZ2_MIME || input.mime === XZ_MIME) return false;
    if (output.mime === BZ2_MIME || output.mime === XZ_MIME) return false;
    if (!SUPPORTED_MIMES.has(input.mime) || !SUPPORTED_MIMES.has(output.mime)) return false;

    // Identity route — unchanged.
    if (input.mime === output.mime) return true;

    // Cross-container route — zip↔tar only (gz stays identity-only).
    return canCrossContainers(input.mime, output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new ArchiveInputTooLargeError(input.size, MAX_INPUT_BYTES);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const inputBytes = new Uint8Array(await input.arrayBuffer());

    // Identity / round-trip paths
    if (output.mime === ZIP_MIME && input.type === ZIP_MIME) {
      const zipFile = parseZip(inputBytes);
      options.onProgress?.({ percent: 50, phase: 'mux' });
      const outputBytes = await serializeZip(zipFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    if (output.mime === TAR_MIME && input.type === TAR_MIME) {
      const tarFile = parseTar(inputBytes);
      options.onProgress?.({ percent: 50, phase: 'mux' });
      const outputBytes = await serializeTar(tarFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // TGZ_MIME === GZIP_MIME (same constant); a single check covers both tgz and gz
    if (output.mime === GZIP_MIME && input.type === GZIP_MIME) {
      const decompressed = await decompressGzip(inputBytes);
      options.onProgress?.({ percent: 50, phase: 'compress' });
      const outputBytes = await compressGzip(decompressed);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Cross-container: zip → tar. parseZip enforces read-side caps + rejects
    // encrypted entries; serializeTar re-applies its write-side caps.
    if (output.mime === TAR_MIME && input.type === ZIP_MIME) {
      const zipFile = parseZip(inputBytes);
      options.onProgress?.({ percent: 45, phase: 'remux' });
      const tarFile = zipToTar(zipFile);
      const outputBytes = await serializeTar(tarFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    // Cross-container: tar → zip. parseTar rejects unsupported entry types
    // (symlinks/hardlinks/PAX); serializeZip re-applies its write-side caps.
    if (output.mime === ZIP_MIME && input.type === TAR_MIME) {
      const tarFile = parseTar(inputBytes);
      options.onProgress?.({ percent: 45, phase: 'remux' });
      const zipFile = tarToZip(tarFile);
      const outputBytes = await serializeZip(zipFile);
      options.onProgress?.({ percent: 100, phase: 'done' });
      const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime });
      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }

    throw new ArchiveEncodeNotImplementedError(
      `output MIME "${output.mime}" from input "${input.type}" is not supported; only identity round-trips are implemented`,
    );
  }
}

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

export const ZIP_FORMAT: FormatDescriptor = {
  ext: 'zip',
  mime: ZIP_MIME,
  category: 'archive',
  description: 'ZIP Archive (stored + Deflate)',
};

export const TAR_FORMAT: FormatDescriptor = {
  ext: 'tar',
  mime: TAR_MIME,
  category: 'archive',
  description: 'POSIX ustar TAR Archive',
};

export const GZIP_FORMAT: FormatDescriptor = {
  ext: 'gz',
  mime: GZIP_MIME,
  category: 'archive',
  description: 'GZip Compressed File',
};

export const TGZ_FORMAT: FormatDescriptor = {
  ext: 'tgz',
  mime: TGZ_MIME,
  category: 'archive',
  description: 'GZip-compressed TAR Archive',
};
