/**
 * Typed error classes for @catlabtech/webcvt-font.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching.
 * Never throw a bare Error or a bare WebcvtError from this package — always use
 * one of the typed subclasses below.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';

/** Thrown when the raw input exceeds MAX_INPUT_BYTES (64 MiB). */
export class FontInputTooLargeError extends WebcvtError {
  constructor(size: number, max: number) {
    super(
      'FONT_INPUT_TOO_LARGE',
      `Font input is ${size} bytes; maximum supported is ${max} bytes (64 MiB).`,
    );
    this.name = 'FontInputTooLargeError';
  }
}

/**
 * Thrown when the leading magic bytes match neither an sfnt flavor nor a WOFF
 * signature (i.e. the input is not a recognised font container).
 */
export class FontInvalidSignatureError extends WebcvtError {
  constructor(detail: string) {
    super('FONT_INVALID_SIGNATURE', `Not a recognised sfnt/WOFF font container: ${detail}.`);
    this.name = 'FontInvalidSignatureError';
  }
}

/**
 * Thrown when a WOFF 2.0 file (`wOF2`) is encountered. WOFF2 requires Brotli
 * (unavailable in DecompressionStream) and glyf-table transform reconstruction,
 * both out of scope for this self-written repackaging backend.
 */
export class FontWoff2NotSupportedError extends WebcvtError {
  constructor() {
    super(
      'FONT_WOFF2_NOT_SUPPORTED',
      'WOFF 2.0 (wOF2) is not supported: it requires Brotli decompression (unavailable in ' +
        'DecompressionStream) and glyf-table transform reconstruction. Only WOFF 1.0 (wOFF) is supported.',
    );
    this.name = 'FontWoff2NotSupportedError';
  }
}

/**
 * Thrown for a TrueType/OpenType Collection (`ttcf`). Collections bundle
 * multiple fonts sharing tables and are out of scope for single-font sfnt↔WOFF
 * repackaging.
 */
export class FontCollectionNotSupportedError extends WebcvtError {
  constructor() {
    super(
      'FONT_COLLECTION_NOT_SUPPORTED',
      'TrueType/OpenType Collections (ttcf) are not supported; only single-font sfnt containers ' +
        'and WOFF 1.0 are handled.',
    );
    this.name = 'FontCollectionNotSupportedError';
  }
}

/**
 * Thrown when the table count exceeds MAX_TABLES or the directory cannot fit
 * within the input (truncated header / absurd numTables).
 */
export class FontTooManyTablesError extends WebcvtError {
  constructor(numTables: number, max: number) {
    super(
      'FONT_TOO_MANY_TABLES',
      `Font declares ${numTables} tables which exceeds the cap of ${max}.`,
    );
    this.name = 'FontTooManyTablesError';
  }
}

/**
 * Thrown when a structure (header, directory, or a table's data) extends beyond
 * the bounds of the input buffer, or a table overlaps the header/directory.
 */
export class FontMalformedError extends WebcvtError {
  constructor(detail: string) {
    super('FONT_MALFORMED', `Malformed font container: ${detail}.`);
    this.name = 'FontMalformedError';
  }
}

/**
 * Thrown when a single table's (declared decompressed) size exceeds
 * MAX_TABLE_BYTES, or when cumulative decompressed output exceeds
 * MAX_TOTAL_DECOMPRESSED_BYTES (decompression-bomb guard).
 */
export class FontTableTooLargeError extends WebcvtError {
  constructor(detail: string) {
    super('FONT_TABLE_TOO_LARGE', `Font table size cap exceeded: ${detail}.`);
    this.name = 'FontTableTooLargeError';
  }
}

/**
 * Thrown when a WOFF table fails to decompress, or its decompressed length does
 * not match the declared `origLength`.
 */
export class FontDecompressionError extends WebcvtError {
  constructor(tag: string, detail: string) {
    super('FONT_DECOMPRESSION_FAILED', `Failed to decompress WOFF table "${tag}": ${detail}.`);
    this.name = 'FontDecompressionError';
  }
}

/**
 * Thrown when the host runtime lacks CompressionStream / DecompressionStream,
 * which this backend needs for WOFF (de)compression.
 */
export class FontCompressionUnavailableError extends WebcvtError {
  constructor(which: 'CompressionStream' | 'DecompressionStream') {
    super(
      'FONT_COMPRESSION_UNAVAILABLE',
      `${which} is unavailable in this environment; WOFF (de)compression is not possible.`,
    );
    this.name = 'FontCompressionUnavailableError';
  }
}
