/**
 * @catlabtech/webcvt-archive-zip — Public API
 *
 * Archive format support:
 *   - ZIP (stored + Deflate, PKWARE APPNOTE.TXT 6.3.10)
 *   - TAR (POSIX ustar, IEEE Std 1003.1-2017)
 *   - GZip (single-member, RFC 1952)
 *   - tar.gz / .tgz (gzip-wrapped TAR)
 *
 * Deferred to Phase 4.5:
 *   - ZIP64, encryption, methods other than 0+8, multi-disk
 *   - PAX/GNU tar extensions, symlinks/hardlinks
 *   - Multi-member gzip
 *   - Native bzip2/xz (routes to backend-wasm)
 *
 * Internal helpers (CRC-32, MS-DOS time, octal parse, path validator)
 * are NOT exported from this index — internal use only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ZipEntry, ZipFile } from './zip-parser.ts';
export type { TarEntry, TarFile } from './tar-parser.ts';
export type { ArchiveFile } from './parser.ts';

// ---------------------------------------------------------------------------
// ZIP API
// ---------------------------------------------------------------------------

export { parseZip } from './zip-parser.ts';
export { serializeZip } from './zip-serializer.ts';

// ---------------------------------------------------------------------------
// TAR API
// ---------------------------------------------------------------------------

export { parseTar } from './tar-parser.ts';
export { serializeTar } from './tar-serializer.ts';

// ---------------------------------------------------------------------------
// GZip API
// ---------------------------------------------------------------------------

export { decompressGzip, compressGzip } from './serializer.ts';

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export { parseArchive } from './parser.ts';

// ---------------------------------------------------------------------------
// Entry iterators
// ---------------------------------------------------------------------------

export { iterateZip, iterateZipAll, iterateTar, iterateTarAll } from './entry-iterator.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export { ArchiveBackend, ZIP_FORMAT, TAR_FORMAT, GZIP_FORMAT, TGZ_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  ArchiveInputTooLargeError,
  ArchiveInvalidEntryNameError,
  ArchiveEntrySizeCapError,
  ArchiveTotalSizeCapError,
  ArchiveBz2NotSupportedError,
  ArchiveXzNotSupportedError,
  ArchiveEncodeNotImplementedError,
  ZipTooShortError,
  ZipNoEocdError,
  ZipCommentTooLargeError,
  ZipNotZip64SupportedError,
  ZipMultiDiskNotSupportedError,
  ZipBadCentralDirectoryError,
  ZipBadLocalHeaderError,
  ZipEncryptedNotSupportedError,
  ZipUnsupportedMethodError,
  ZipChecksumError,
  ZipCompressionRatioError,
  ZipTooManyEntriesError,
  ZipCorruptStreamError,
  ZipTruncatedEntryError,
  TarMisalignedInputError,
  TarTooShortError,
  TarChecksumError,
  TarNonUstarNotSupportedError,
  TarGnuVariantNotSupportedError,
  TarUnsupportedTypeflagError,
  TarPaxNotSupportedError,
  TarTooManyEntriesError,
  TarBase256SizeNotSupportedError,
  TarLongNameNotSupportedError,
  TarCorruptStreamError,
  TarInvalidOctalFieldError,
  TarCumulativeSizeCapError,
  GzipInvalidMagicError,
  GzipUnsupportedMethodError,
  GzipMultiMemberNotSupportedError,
} from './errors.ts';
