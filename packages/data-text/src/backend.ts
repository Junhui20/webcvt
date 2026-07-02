/**
 * DataTextBackend — webcvt Backend implementation for the ten text formats.
 *
 * canHandle covers two routes:
 *   1. Identity — input.mime === output.mime AND the MIME belongs to a
 *      supported format. Byte-for-byte parse → serialize of the same kind.
 *   2. Cross-format — both MIMEs map to a supported format AND the pair is
 *      bridgeable (canBridge). json↔yaml, csv↔json, toml→jsonl, … all route
 *      here; XML and FWF are excluded from bridging (see bridge.ts).
 *
 * There is NO magic-byte sniffing on either route: these formats have no
 * reliable signatures and overlap heavily, so callers MUST route by explicit
 * MIME/descriptor. See parseDataText for the per-format parse API.
 *
 * text/plain hazard: ENV's MIME is text/plain, shared with arbitrary text (and
 * FWF). The identity route keeps its historical behaviour, but the cross-format
 * route refuses to treat a text/plain side as ENV unless the descriptor
 * explicitly declares `ext === 'env'` — otherwise a plain-text blob could be
 * silently reinterpreted as key=value pairs.
 */

import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { bridge, canBridge } from './bridge.ts';
import {
  CSV_MIME,
  ENV_MIME,
  FWF_MIME,
  INI_MIME,
  JSONL_MIME,
  JSONL_MIME_ALIAS,
  JSON_MIME,
  MAX_INPUT_BYTES,
  TOML_MIME,
  TSV_MIME,
  XML_MIME,
  YAML_MIME,
  YAML_MIME_ALIAS_TEXT,
  YAML_MIME_ALIAS_TEXT_X,
  YAML_MIME_ALIAS_X,
} from './constants.ts';
import { DataTextUnsupportedFormatError, InputTooLargeError } from './errors.ts';
import { type DataTextFormat, parseDataText } from './parser.ts';
import { serializeDataText } from './serializer.ts';

/** DataTextFormat variants that are routable via MIME (excludes FWF — see FWF_MIME note). */
type RoutableFormat = Exclude<DataTextFormat, 'fwf'>; // 'xml' and 'yaml' are routable via their MIMEs

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
/**
 * Map from MIME type string to routable format.
 *
 * Note: FWF is deliberately excluded — it shares text/plain with ENV and cannot
 * be disambiguated by MIME alone. FWF is only reachable via the direct API.
 */
const MIME_TO_FORMAT = new Map<string, RoutableFormat>([
  [JSON_MIME, 'json'],
  [CSV_MIME, 'csv'],
  [TSV_MIME, 'tsv'],
  [INI_MIME, 'ini'],
  [ENV_MIME, 'env'],
  [JSONL_MIME, 'jsonl'],
  [JSONL_MIME_ALIAS, 'jsonl'],
  [TOML_MIME, 'toml'],
  [XML_MIME, 'xml'],
  [YAML_MIME, 'yaml'],
  [YAML_MIME_ALIAS_X, 'yaml'],
  [YAML_MIME_ALIAS_TEXT, 'yaml'],
  [YAML_MIME_ALIAS_TEXT_X, 'yaml'],
]);

// ---------------------------------------------------------------------------
// DataTextBackend
// ---------------------------------------------------------------------------

export class DataTextBackend implements Backend {
  readonly name = 'data-text';

  /**
   * Returns true for two routes (see class doc):
   *   - identity: input.mime === output.mime AND the MIME is supported.
   *   - cross-format: both MIMEs map to supported formats AND the pair is
   *     bridgeable, subject to the text/plain (ENV) opt-in below.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    const inFmt = MIME_TO_FORMAT.get(input.mime);
    const outFmt = MIME_TO_FORMAT.get(output.mime);
    if (inFmt === undefined || outFmt === undefined) return false;

    // Identity route: unchanged historical behaviour (keeps text/plain ENV
    // identity working without an ext check).
    if (input.mime === output.mime) return true;

    // Cross-format route: the pair must be bridgeable (excludes xml/fwf).
    if (!canBridge(inFmt, outFmt)) return false;

    // text/plain hazard: only trust a text/plain side as ENV when the
    // descriptor explicitly says so. Applied to both sides so we neither parse
    // arbitrary text as ENV nor emit ENV for a generic text/plain request.
    if (input.mime === ENV_MIME && input.ext !== 'env') return false;
    if (output.mime === ENV_MIME && output.ext !== 'env') return false;

    return true;
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

    const inFmt = MIME_TO_FORMAT.get(input.type);
    if (inFmt === undefined) {
      throw new DataTextUnsupportedFormatError(input.type);
    }
    const outFmt = MIME_TO_FORMAT.get(output.mime);
    if (outFmt === undefined) {
      throw new DataTextUnsupportedFormatError(output.mime);
    }

    options.onProgress?.({ percent: 5, phase: 'demux' });

    const text = await input.text();

    options.onProgress?.({ percent: 40, phase: 'parse' });
    let parsed = parseDataText(text, inFmt);

    // Cross-format re-projection. The identity path (inFmt === outFmt) skips
    // the bridge entirely so its output stays byte-for-byte as before.
    if (inFmt !== outFmt) {
      options.onProgress?.({ percent: 55, phase: 'bridge' });
      parsed = bridge(parsed, outFmt);
    }

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

export const JSONL_FORMAT: FormatDescriptor = {
  ext: 'jsonl',
  mime: JSONL_MIME,
  category: 'data',
  description: 'JSON Lines',
};

export const TOML_FORMAT: FormatDescriptor = {
  ext: 'toml',
  mime: TOML_MIME,
  category: 'data',
  description: "Tom's Obvious Minimal Language",
};

/**
 * FWF format descriptor.
 *
 * IMPORTANT — MIME disambiguation:
 * FWF shares `text/plain` with ENV. The DataTextBackend.canHandle MIME routing
 * CANNOT distinguish them, so FWF_FORMAT is NOT registered in MIME_TO_FORMAT.
 * FWF is reachable ONLY via direct parseFwf / serializeFwf API or via
 * parseDataText(input, 'fwf', { columns }).
 */
export const FWF_FORMAT: FormatDescriptor = {
  ext: 'fwf',
  mime: FWF_MIME,
  category: 'data',
  description: 'Fixed-Width Format',
};

export const XML_FORMAT: FormatDescriptor = {
  ext: 'xml',
  mime: XML_MIME,
  category: 'data',
  description: 'Extensible Markup Language',
};

export const YAML_FORMAT: FormatDescriptor = {
  ext: 'yaml',
  mime: YAML_MIME,
  category: 'data',
  description: 'YAML Aint Markup Language 1.2 Core',
};
