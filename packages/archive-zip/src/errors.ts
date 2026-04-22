/**
 * Typed error classes for @catlabtech/webcvt-archive-zip.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw bare Error or WebcvtError from archive-zip — always use
 * a typed subclass from this file.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

// ---------------------------------------------------------------------------
// Shared archive errors
// ---------------------------------------------------------------------------

/** Thrown when the input exceeds the 200 MiB size cap. */
export class ArchiveInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'ARCHIVE_INPUT_TOO_LARGE',
      `Archive input is ${size} bytes; maximum supported is ${max} bytes (200 MiB).`,
    );
    this.name = 'ArchiveInputTooLargeError';
  }
}

/** Thrown when an entry name fails path-traversal validation. */
export class ArchiveInvalidEntryNameError extends WebcvtError {
  constructor(name: string, reason: string) {
    super('ARCHIVE_INVALID_ENTRY_NAME', `Entry name "${name}" is invalid: ${reason}`);
    this.name = 'ArchiveInvalidEntryNameError';
  }
}

/** Thrown when an entry's uncompressed size exceeds the per-entry cap. */
export class ArchiveEntrySizeCapError extends WebcvtError {
  constructor(name: string, size: number, cap: number) {
    super(
      'ARCHIVE_ENTRY_SIZE_CAP',
      `Entry "${name}" uncompressed size ${size} exceeds the per-entry cap of ${cap} bytes (256 MiB).`,
    );
    this.name = 'ArchiveEntrySizeCapError';
  }
}

/** Thrown when the cumulative uncompressed size across all entries exceeds the cap. */
export class ArchiveTotalSizeCapError extends WebcvtError {
  constructor(total: number, cap: number) {
    super(
      'ARCHIVE_TOTAL_SIZE_CAP',
      `Cumulative uncompressed size ${total} exceeds the total cap of ${cap} bytes (512 MiB).`,
    );
    this.name = 'ArchiveTotalSizeCapError';
  }
}

/** Thrown when bzip2 magic is detected. Signals BackendRegistry to route to backend-wasm. */
export class ArchiveBz2NotSupportedError extends WebcvtError {
  constructor() {
    super(
      'ARCHIVE_BZ2_NOT_SUPPORTED',
      'bzip2 archives are not natively supported. Install @catlabtech/webcvt-backend-wasm for bzip2 support.',
    );
    this.name = 'ArchiveBz2NotSupportedError';
  }
}

/** Thrown when xz magic is detected. Signals BackendRegistry to route to backend-wasm. */
export class ArchiveXzNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'ARCHIVE_XZ_NOT_SUPPORTED',
      'xz archives are not natively supported. Install @catlabtech/webcvt-backend-wasm for xz support.',
    );
    this.name = 'ArchiveXzNotSupportedError';
  }
}

// ---------------------------------------------------------------------------
// ZIP-specific errors
// ---------------------------------------------------------------------------

/** Thrown when the input is too short to contain a valid ZIP EOCD. */
export class ZipTooShortError extends WebcvtError {
  constructor(size: number) {
    super('ZIP_TOO_SHORT', `Input is ${size} bytes; minimum ZIP size is 22 bytes (EOCD only).`);
    this.name = 'ZipTooShortError';
  }
}

/** Thrown when no EOCD signature is found within the search bound. */
export class ZipNoEocdError extends WebcvtError {
  constructor() {
    super(
      'ZIP_NO_EOCD',
      'No ZIP End-of-Central-Directory (EOCD) signature found. Not a valid ZIP file, or comment exceeds 4 KiB.',
    );
    this.name = 'ZipNoEocdError';
  }
}

/** Thrown when the ZIP comment exceeds 4 KiB (bounds the EOCD backward search). */
export class ZipCommentTooLargeError extends WebcvtError {
  constructor(commentLength: number) {
    super(
      'ZIP_COMMENT_TOO_LARGE',
      `ZIP file comment is ${commentLength} bytes; maximum supported is 4096 bytes.`,
    );
    this.name = 'ZipCommentTooLargeError';
  }
}

/** Thrown when ZIP64 EOCD signature is detected (deferred to Phase 4.5). */
export class ZipNotZip64SupportedError extends WebcvtError {
  constructor() {
    super(
      'ZIP_NOT_ZIP64_SUPPORTED',
      'ZIP64 archives are not supported in first pass. Support is planned for Phase 4.5.',
    );
    this.name = 'ZipNotZip64SupportedError';
  }
}

/** Thrown when a multi-disk ZIP is encountered (disk numbers != 0). */
export class ZipMultiDiskNotSupportedError extends WebcvtError {
  constructor(diskNumber: number) {
    super(
      'ZIP_MULTI_DISK_NOT_SUPPORTED',
      `Multi-disk ZIP archives are not supported (disk number = ${diskNumber}).`,
    );
    this.name = 'ZipMultiDiskNotSupportedError';
  }
}

/** Thrown when the central directory signature is invalid. */
export class ZipBadCentralDirectoryError extends WebcvtError {
  constructor(offset: number, sig: number) {
    super(
      'ZIP_BAD_CENTRAL_DIRECTORY',
      `Expected central directory signature 0x02014b50 at offset ${offset}, got 0x${sig.toString(16)}.`,
    );
    this.name = 'ZipBadCentralDirectoryError';
  }
}

/** Thrown when the local file header signature is invalid. */
export class ZipBadLocalHeaderError extends WebcvtError {
  constructor(offset: number, sig: number) {
    super(
      'ZIP_BAD_LOCAL_HEADER',
      `Expected local file header signature 0x04034b50 at offset ${offset}, got 0x${sig.toString(16)}.`,
    );
    this.name = 'ZipBadLocalHeaderError';
  }
}

/** Thrown when a ZIP entry has the encryption flag set (bit 0 of general purpose flag). */
export class ZipEncryptedNotSupportedError extends WebcvtError {
  constructor(name: string) {
    super(
      'ZIP_ENCRYPTED_NOT_SUPPORTED',
      `ZIP entry "${name}" is encrypted. Encrypted ZIP entries are not supported in first pass.`,
    );
    this.name = 'ZipEncryptedNotSupportedError';
  }
}

/** Thrown when a ZIP entry uses a compression method other than 0 (stored) or 8 (deflate). */
export class ZipUnsupportedMethodError extends WebcvtError {
  constructor(name: string, method: number) {
    super(
      'ZIP_UNSUPPORTED_METHOD',
      `ZIP entry "${name}" uses compression method ${method}. Only methods 0 (stored) and 8 (deflate) are supported.`,
    );
    this.name = 'ZipUnsupportedMethodError';
  }
}

/** Thrown when CRC-32 of decompressed ZIP entry data does not match. */
export class ZipChecksumError extends WebcvtError {
  constructor(name: string, expected: number, got: number) {
    super(
      'ZIP_CHECKSUM_ERROR',
      `CRC-32 mismatch for ZIP entry "${name}": expected 0x${expected.toString(16).padStart(8, '0')}, got 0x${got.toString(16).padStart(8, '0')}.`,
    );
    this.name = 'ZipChecksumError';
  }
}

/** Thrown when a ZIP entry's compression ratio exceeds 1000:1. */
export class ZipCompressionRatioError extends WebcvtError {
  constructor(name: string, ratio: number) {
    super(
      'ZIP_COMPRESSION_RATIO_ERROR',
      `ZIP entry "${name}" has a compression ratio of ${ratio}:1, which exceeds the maximum of 1000:1. Potential zip bomb rejected.`,
    );
    this.name = 'ZipCompressionRatioError';
  }
}

/** Thrown when the ZIP archive entry count exceeds MAX_ZIP_ENTRIES. */
export class ZipTooManyEntriesError extends WebcvtError {
  constructor(count: number, max: number) {
    super('ZIP_TOO_MANY_ENTRIES', `ZIP archive has ${count} entries; maximum supported is ${max}.`);
    this.name = 'ZipTooManyEntriesError';
  }
}

/** Thrown when an empty ZIP returns zero entries from non-empty input. */
export class ZipCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('ZIP_CORRUPT_STREAM', `ZIP stream is corrupt: ${reason}`);
    this.name = 'ZipCorruptStreamError';
  }
}

/** Thrown when a ZIP entry's payload extends past the end of the input buffer. */
export class ZipTruncatedEntryError extends WebcvtError {
  constructor(name: string, payloadOffset: number, compressedSize: number, inputLength: number) {
    super(
      'ZIP_TRUNCATED_ENTRY',
      `ZIP entry "${name}" payload at offset ${payloadOffset} with compressed size ${compressedSize} extends past input end (${inputLength} bytes).`,
    );
    this.name = 'ZipTruncatedEntryError';
  }
}

// ---------------------------------------------------------------------------
// TAR-specific errors
// ---------------------------------------------------------------------------

/** Thrown when the TAR input length is not a multiple of 512. */
export class TarMisalignedInputError extends WebcvtError {
  constructor(size: number) {
    super(
      'TAR_MISALIGNED_INPUT',
      `TAR input size ${size} is not a multiple of 512. Not a valid TAR archive.`,
    );
    this.name = 'TarMisalignedInputError';
  }
}

/** Thrown when the TAR input is too short (less than 1024 bytes). */
export class TarTooShortError extends WebcvtError {
  constructor(size: number) {
    super(
      'TAR_TOO_SHORT',
      `TAR input is ${size} bytes; minimum is 1024 bytes (end-of-archive marker).`,
    );
    this.name = 'TarTooShortError';
  }
}

/** Thrown when a TAR header's checksum is wrong. */
export class TarChecksumError extends WebcvtError {
  constructor(offset: number, expected: number, got: number) {
    super(
      'TAR_CHECKSUM_ERROR',
      `TAR header checksum mismatch at offset ${offset}: expected ${expected}, got ${got}.`,
    );
    this.name = 'TarChecksumError';
  }
}

/** Thrown when a TAR header does not have the "ustar\0" magic (V7 or non-ustar format). */
export class TarNonUstarNotSupportedError extends WebcvtError {
  constructor(offset: number, magic: string) {
    super(
      'TAR_NON_USTAR_NOT_SUPPORTED',
      `TAR header at offset ${offset} does not have ustar magic (got "${magic}"). Only POSIX ustar format is supported.`,
    );
    this.name = 'TarNonUstarNotSupportedError';
  }
}

/** Thrown when a TAR header has GNU tar's "ustar  \0" magic variant. */
export class TarGnuVariantNotSupportedError extends WebcvtError {
  constructor(offset: number) {
    super(
      'TAR_GNU_VARIANT_NOT_SUPPORTED',
      `TAR header at offset ${offset} uses GNU tar format ("ustar  " variant). Only POSIX ustar is supported.`,
    );
    this.name = 'TarGnuVariantNotSupportedError';
  }
}

/** Thrown when a TAR entry typeflag is not '0', '\0', or '5'. */
export class TarUnsupportedTypeflagError extends WebcvtError {
  constructor(typeflag: string, entryName: string) {
    super(
      'TAR_UNSUPPORTED_TYPEFLAG',
      `TAR entry "${entryName}" has unsupported typeflag '${typeflag}'. Only regular files ('0'/NUL) and directories ('5') are supported.`,
    );
    this.name = 'TarUnsupportedTypeflagError';
  }
}

/** Thrown when PAX extended headers are encountered (typeflag 'x' or 'g'). */
export class TarPaxNotSupportedError extends WebcvtError {
  constructor(typeflag: string) {
    super(
      'TAR_PAX_NOT_SUPPORTED',
      `TAR PAX extended header (typeflag '${typeflag}') is not supported in first pass.`,
    );
    this.name = 'TarPaxNotSupportedError';
  }
}

/** Thrown when a TAR entry count exceeds MAX_TAR_ENTRIES. */
export class TarTooManyEntriesError extends WebcvtError {
  constructor(max: number) {
    super('TAR_TOO_MANY_ENTRIES', `TAR archive entry count exceeds maximum of ${max}.`);
    this.name = 'TarTooManyEntriesError';
  }
}

/** Thrown when a TAR size field uses GNU base-256 encoding (high bit set). */
export class TarBase256SizeNotSupportedError extends WebcvtError {
  constructor(entryName: string) {
    super(
      'TAR_BASE256_SIZE_NOT_SUPPORTED',
      `TAR entry "${entryName}" uses GNU base-256 size encoding (file > 8 GiB). Not supported in first pass.`,
    );
    this.name = 'TarBase256SizeNotSupportedError';
  }
}

/** Thrown when a TAR entry name exceeds 100 bytes and prefix splitting is needed. */
export class TarLongNameNotSupportedError extends WebcvtError {
  constructor(name: string, length: number) {
    super(
      'TAR_LONG_NAME_NOT_SUPPORTED',
      `TAR entry name "${name}" is ${length} bytes; names over 100 bytes require PAX/GNU extensions (deferred to Phase 4.5).`,
    );
    this.name = 'TarLongNameNotSupportedError';
  }
}

/** Thrown when a non-empty TAR input produces zero entries. */
export class TarCorruptStreamError extends WebcvtError {
  constructor(reason: string) {
    super('TAR_CORRUPT_STREAM', `TAR stream is corrupt: ${reason}`);
    this.name = 'TarCorruptStreamError';
  }
}

/** Thrown when a TAR octal field contains non-octal characters. */
export class TarInvalidOctalFieldError extends WebcvtError {
  constructor(field: string) {
    super('TAR_INVALID_OCTAL_FIELD', `TAR header field "${field}" contains non-octal characters.`);
    this.name = 'TarInvalidOctalFieldError';
  }
}

/** Thrown when the cumulative uncompressed size across TAR entries exceeds the cap. */
export class TarCumulativeSizeCapError extends WebcvtError {
  constructor(total: number, cap: number) {
    super(
      'TAR_CUMULATIVE_SIZE_CAP',
      `Cumulative uncompressed size ${total} exceeds the total cap of ${cap} bytes (512 MiB).`,
    );
    this.name = 'TarCumulativeSizeCapError';
  }
}

// ---------------------------------------------------------------------------
// GZip-specific errors
// ---------------------------------------------------------------------------

/** Thrown when the gzip magic bytes are wrong. */
export class GzipInvalidMagicError extends WebcvtError {
  constructor() {
    super('GZIP_INVALID_MAGIC', 'Not a valid gzip stream: wrong magic bytes.');
    this.name = 'GzipInvalidMagicError';
  }
}

/** Thrown when gzip compression method is not 8 (Deflate). */
export class GzipUnsupportedMethodError extends WebcvtError {
  constructor(method: number) {
    super(
      'GZIP_UNSUPPORTED_METHOD',
      `Gzip uses unsupported compression method ${method}; only method 8 (Deflate) is supported.`,
    );
    this.name = 'GzipUnsupportedMethodError';
  }
}

/** Thrown when a multi-member gzip file is detected (deferred to Phase 4.5). */
export class GzipMultiMemberNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'GZIP_MULTI_MEMBER_NOT_SUPPORTED',
      'Multi-member gzip files are not supported in first pass. Support is planned for Phase 4.5.',
    );
    this.name = 'GzipMultiMemberNotSupportedError';
  }
}

/** Thrown when encode is requested for a path not supported by this backend. */
export class ArchiveEncodeNotImplementedError extends WebcvtError {
  constructor(reason: string) {
    super(
      'ARCHIVE_ENCODE_NOT_IMPLEMENTED',
      `Archive encode not implemented: ${reason}. Install @catlabtech/webcvt-backend-wasm for transcode support.`,
    );
    this.name = 'ArchiveEncodeNotImplementedError';
  }
}
