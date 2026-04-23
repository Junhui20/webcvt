/**
 * ArchiveBackend — webcvt Backend implementation for ZIP / TAR / GZip archives.
 *
 * First-pass capability:
 * - canHandle: identity round-trip for application/zip, application/x-tar,
 *   application/gzip only.
 * - canHandle: non-identity → returns false (routes to backend-wasm via registry).
 * - convert (identity): parse → re-serialize (semantic round-trip).
 *
 * Identity-only gate (Lesson 1 from prior containers): only exact input.mime === output.mime
 * passes canHandle. Cross-MIME relabel returns false.
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
   * Identity-only canHandle (first pass).
   *
   * Returns true ONLY when input MIME === output MIME and both are in the
   * supported set. bz2/xz return false so BackendRegistry routes to backend-wasm.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (input.mime === BZ2_MIME || input.mime === XZ_MIME) return false;
    if (output.mime === BZ2_MIME || output.mime === XZ_MIME) return false;
    return (
      SUPPORTED_MIMES.has(input.mime) &&
      SUPPORTED_MIMES.has(output.mime) &&
      input.mime === output.mime
    );
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
