/**
 * DocPdfBackend — a webcvt Backend that reads a PDF and emits its light
 * structural info (version, page count, /Info metadata) as JSON.
 *
 * Capability: `pdf → json`. Multi-page image→PDF lives in the standalone
 * `imagesToPdf` function (used programmatically, e.g. by a cbz→PDF pipeline);
 * single-image→PDF already lives in @catlabtech/webcvt-image-pdf. This backend
 * deliberately does NOT auto-register itself — wire it in explicitly.
 *
 * It never extracts text: the JSON describes the document, it does not contain
 * its words.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { UnsupportedFormatError, defaultRegistry } from '@catlabtech/webcvt-core';
import { JSON_MIME, MAX_INPUT_BYTES, PDF_MIME } from './constants.ts';
import { DocPdfInputTooLargeError } from './errors.ts';
import { parsePdfInfo } from './pdf-info.ts';

export interface DocPdfBackendOptions {
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
}

function isPdfInput(input: FormatDescriptor): boolean {
  return input.mime === PDF_MIME || input.ext === 'pdf';
}

function isJsonOutput(output: FormatDescriptor): boolean {
  return output.mime === JSON_MIME || output.ext === 'json';
}

/** Backend that converts a PDF into a JSON description of its structure. */
export class DocPdfBackend implements Backend {
  readonly name = 'doc-pdf';

  private readonly maxInputBytes: number;

  constructor(opts?: DocPdfBackendOptions) {
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
  }

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return isPdfInput(input) && isJsonOutput(output);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > this.maxInputBytes) {
      throw new DocPdfInputTooLargeError(input.size, this.maxInputBytes);
    }
    if (!isJsonOutput(output)) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    options.onProgress?.({ percent: 5, phase: 'load' });
    const bytes = new Uint8Array(await input.arrayBuffer());

    options.onProgress?.({ percent: 50, phase: 'parse' });
    const info = parsePdfInfo(bytes, { maxInputBytes: this.maxInputBytes });

    options.onProgress?.({ percent: 90, phase: 'serialize' });
    const json = JSON.stringify(info, null, 2);

    options.onProgress?.({ percent: 100, phase: 'done' });
    return {
      blob: new Blob([json], { type: output.mime }),
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

/**
 * Registers a DocPdfBackend instance with the given registry (or the
 * process-wide defaultRegistry when omitted). No auto-registration on import.
 *
 * @throws {Error} if a backend with the same name is already registered.
 */
export function registerDocPdfBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: DocPdfBackendOptions,
): void {
  registry.register(new DocPdfBackend(opts));
}
