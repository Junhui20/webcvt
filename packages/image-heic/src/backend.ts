/**
 * HeicBackend — webcvt Backend that decodes HEIC/HEIF (e.g. iPhone photos) to a
 * canvas-native format (PNG/JPEG/WebP) via libheif (wasm) + the canvas bridge.
 *
 * HEIC is INPUT-only here — there is no HEIC encoder (libheif-js exposes only a
 * decoder), so PDF/canvas formats are the only outputs.
 *
 * Key invariants:
 * - canHandle() never loads wasm (Trap §1).
 * - AbortSignal is checked between async phases (Trap §5).
 * - MAX_INPUT_BYTES checked before wasm; MAX_PIXELS after decode.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import {
  CANVAS_ENCODABLE_MIMES,
  HEIC_MIME,
  HEIF_MIME,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
} from './constants.ts';
import { decodeHeic } from './decode.ts';
import { HeicDimensionsTooLargeError, HeicInputTooLargeError } from './errors.ts';
import { hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

const HEIC_INPUT_MIMES: ReadonlySet<string> = new Set([HEIC_MIME, HEIF_MIME]);

export interface HeicBackendOptions {
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
  /** Override for MAX_PIXELS. Defaults to 40 MP. */
  readonly maxPixels?: number;
}

/** Backend that decodes HEIC/HEIF to PNG/JPEG/WebP using libheif (wasm). */
export class HeicBackend implements Backend {
  readonly name = 'image-heic';

  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: HeicBackendOptions) {
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  }

  /** True when the input is HEIC/HEIF, the output is a canvas format, and a bridge exists. */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (!HEIC_INPUT_MIMES.has(input.mime)) return false;
    if (!CANVAS_ENCODABLE_MIMES.has(output.mime)) return false;
    return hasPixelBridge();
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > this.maxInputBytes) {
      throw new HeicInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    options.onProgress?.({ percent: 30, phase: 'decode' });
    const imageData = await decodeHeic(bytes);
    throwIfAborted(signal);

    const pixels = imageData.width * imageData.height;
    if (pixels > this.maxPixels) {
      throw new HeicDimensionsTooLargeError(imageData.width, imageData.height, this.maxPixels);
    }

    options.onProgress?.({ percent: 70, phase: 'bridge' });
    const blob = await imageDataToBlob(imageData, output.mime, options.quality);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }
}

/**
 * Registers a HeicBackend instance with the given registry (or the process-wide
 * defaultRegistry when omitted). No auto-registration on import.
 *
 * @throws {Error} if a backend with the same name is already registered.
 */
export function registerHeicBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: HeicBackendOptions,
): void {
  registry.register(new HeicBackend(opts));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}
