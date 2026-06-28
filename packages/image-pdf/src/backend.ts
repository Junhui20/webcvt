/**
 * PdfBackend — webcvt Backend that wraps a single image into a one-page PDF.
 *
 * Capabilities (PDF is always the OUTPUT):
 * - JPEG → PDF: embedded byte-for-byte via DCTDecode (lossless, no canvas needed)
 * - {PNG, WebP, BMP, GIF} → PDF: canvas bridge decode → Flate-compressed image
 *   (+ alpha soft mask), so transparency is preserved
 *
 * Zero runtime dependencies — the PDF is assembled from scratch (clean-room).
 *
 * Key invariants:
 * - canHandle() never touches the canvas or allocates buffers (Trap §1).
 * - AbortSignal is checked between async phases (Trap §5).
 * - MAX_INPUT_BYTES checked before decode; MAX_PIXELS after parse / bridge.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { imageDataToPdf, jpegToPdf } from './build-pdf.ts';
import {
  CANVAS_SOURCE_MIMES,
  JPEG_MIME,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  PDF_MIME,
} from './constants.ts';
import { PdfInputTooLargeError } from './errors.ts';
import { blobToImageData, hasPixelBridge } from './pixel-bridge.ts';

export interface PdfBackendOptions {
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
  /** Override for MAX_PIXELS. Defaults to 25 MP. */
  readonly maxPixels?: number;
}

/** Backend that wraps images into a one-page PDF (clean-room PDF writer). */
export class PdfBackend implements Backend {
  readonly name = 'image-pdf';

  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: PdfBackendOptions) {
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  }

  /**
   * Returns true when output is PDF and the input is a supported image. JPEG needs
   * no canvas; other sources require the pixel bridge.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (output.mime !== PDF_MIME) return false;
    if (input.mime === JPEG_MIME) return true;
    if (!hasPixelBridge()) return false;
    return CANVAS_SOURCE_MIMES.has(input.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    inputFormat?: FormatDescriptor,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > this.maxInputBytes) {
      throw new PdfInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    const resolvedInputMime = inputFormat?.mime ?? input.type;
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    let pdf: Uint8Array;
    if (resolvedInputMime === JPEG_MIME) {
      options.onProgress?.({ percent: 40, phase: 'encode' });
      pdf = jpegToPdf(bytes, { maxPixels: this.maxPixels });
    } else {
      options.onProgress?.({ percent: 20, phase: 'bridge' });
      const imageData = await blobToImageData(input, this.maxPixels);
      throwIfAborted(signal);
      options.onProgress?.({ percent: 60, phase: 'encode' });
      pdf = await imageDataToPdf(imageData, { maxPixels: this.maxPixels });
    }
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    return {
      blob: new Blob([pdf.buffer as ArrayBuffer], { type: PDF_MIME }),
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

/**
 * Registers a PdfBackend instance with the given registry (or the process-wide
 * defaultRegistry when omitted). No auto-registration on import.
 *
 * @throws {Error} if a backend with the same name is already registered.
 */
export function registerPdfBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: PdfBackendOptions,
): void {
  registry.register(new PdfBackend(opts));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}
