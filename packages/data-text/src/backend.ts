/**
 * DataTextBackend — webcvt Backend implementation for the five text formats.
 *
 * canHandle: identity-within-format only (input.mime === output.mime AND
 * the MIME belongs to one of the five supported formats). No cross-format
 * conversion, no magic-byte sniffing.
 *
 * Identity-only gate (Lesson 1 from prior packages): canHandle returns true
 * ONLY for the explicitly supported identity paths listed below.
 *
 * Note: These five text formats (JSON, CSV, TSV, INI, ENV) have no reliable
 * magic-byte signatures and overlap heavily with each other. Format detection
 * is intentionally absent — callers MUST pass an explicit format hint to the
 * dispatcher. See parseDataText for the per-format parse API.
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import { CSV_MIME, ENV_MIME, INI_MIME, JSON_MIME, MAX_INPUT_BYTES, TSV_MIME } from './constants.ts';
import { InputTooLargeError, UnsupportedFormatError } from './errors.ts';
import { type DataTextFormat, parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';

// ---------------------------------------------------------------------------
// MIME → DataTextFormat mapping
// ---------------------------------------------------------------------------

/**
 * Map from MIME type string to DataTextFormat string.
 * Used in canHandle and convert to route dispatches.
 *
 * Note: ENV uses text/plain as its MIME (there is no IANA registration for
 * .env files). text/plain is also used by plain-text files. The backend only
 * handles text/plain when input.mime === output.mime AND the caller has opted
 * in by registering this backend.
 */
const MIME_TO_FORMAT = new Map<string, DataTextFormat>([
  [JSON_MIME, 'json'],
  [CSV_MIME, 'csv'],
  [TSV_MIME, 'tsv'],
  [INI_MIME, 'ini'],
  [ENV_MIME, 'env'],
]);

// ---------------------------------------------------------------------------
// DataTextBackend
// ---------------------------------------------------------------------------

export class DataTextBackend implements Backend {
  readonly name = 'data-text';

  /**
   * Returns true only when input MIME === output MIME AND both map to one of
   * the five supported text formats. No cross-format conversion.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (input.mime !== output.mime) return false;
    return MIME_TO_FORMAT.has(input.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > MAX_INPUT_BYTES) {
      throw new InputTooLargeError(input.size, MAX_INPUT_BYTES, 'data-text');
    }

    const format = MIME_TO_FORMAT.get(input.type);
    if (format === undefined) {
      throw new UnsupportedFormatError(input.type);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const text = await input.text();

    options.onProgress?.({ percent: 40, phase: 'parse' });
    const parsed = parseDataText(text, format);

    options.onProgress?.({ percent: 70, phase: 'serialize' });
    const serialized = serializeDataText(parsed);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([serialized], { type: output.mime });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Format descriptors
// ---------------------------------------------------------------------------

export const JSON_FORMAT: FormatDescriptor = {
  ext: 'json',
  mime: JSON_MIME,
  category: 'data',
  description: 'JavaScript Object Notation',
};

export const CSV_FORMAT: FormatDescriptor = {
  ext: 'csv',
  mime: CSV_MIME,
  category: 'data',
  description: 'Comma-Separated Values',
};

export const TSV_FORMAT: FormatDescriptor = {
  ext: 'tsv',
  mime: TSV_MIME,
  category: 'data',
  description: 'Tab-Separated Values',
};

export const INI_FORMAT: FormatDescriptor = {
  ext: 'ini',
  mime: INI_MIME,
  category: 'data',
  description: 'INI Configuration File',
};

export const ENV_FORMAT: FormatDescriptor = {
  ext: 'env',
  mime: ENV_MIME,
  category: 'data',
  description: 'Environment Variables File',
};
