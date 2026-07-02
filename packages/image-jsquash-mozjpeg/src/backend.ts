/**
 * MozjpegBackend — webcvt Backend implementation for high-quality JPEG via MozJPEG.
 *
 * Capabilities:
 * - JPEG → JPEG: re-encode (MozJPEG decode + encode — useful for recompression)
 * - JPEG → {PNG, WebP}: jsquash decode → pixel bridge → canvas blob
 * - {PNG, WebP} → JPEG: canvas blob → pixel bridge → MozJPEG encode
 *
 * NOTE: `image/jpeg` is also handled by `@catlabtech/webcvt-image-canvas`. Register
 * only one of the two for a given registry, or this backend's registration will
 * collide / shadow. This backend is for callers who specifically want MozJPEG's
 * better compression.
 *
 * Key invariants:
 * - canHandle() NEVER triggers wasm load (Trap §1).
 * - AbortSignal is checked between every async phase (Trap §5).
 * - MAX_INPUT_BYTES checked before wasm; MAX_PIXELS after decode / before encode.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, MAX_PIXELS, MOZJPEG_MIME } from './constants.ts';
import { decodeMozjpeg } from './decode.ts';
import { encodeMozjpeg } from './encode.ts';
import type { MozjpegEncodeOptions } from './encode.ts';
import { MozjpegDimensionsTooLargeError, MozjpegInputTooLargeError } from './errors.ts';
import { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

/** Canvas-native formats on the non-JPEG side of a conversion. */
const CANVAS_DECODABLE_MIMES = new Set(['image/png', 'image/webp']);
const CANVAS_ENCODABLE_MIMES = new Set(['image/png', 'image/webp']);

export interface MozjpegBackendOptions {
  /** Default JPEG encode options. Per-call quality from ConvertOptions.quality overrides. */
  readonly encode?: MozjpegEncodeOptions;
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
  /** Override for MAX_PIXELS. Defaults to 25 MP. */
  readonly maxPixels?: number;
}

/**
 * Backend that decodes and encodes JPEG images using @jsquash/jpeg (MozJPEG).
 * The wasm module is lazy-loaded on the first convert() call.
 */
export class MozjpegBackend implements Backend {
  readonly name = 'image-jsquash-mozjpeg';
  /** Specialized JPEG codec — outrank generic any-in/any-out backends (Canvas, wasm). */
  readonly priority = 10;

  private readonly encodeDefaults: MozjpegEncodeOptions | undefined;
  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: MozjpegBackendOptions) {
    this.encodeDefaults = opts?.encode;
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  }

  /**
   * Returns true when the backend can handle this input→output pair.
   * JPEG must be on at least one side. Cross-format paths need the pixel bridge.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    const isJpegIn = input.mime === MOZJPEG_MIME;
    const isJpegOut = output.mime === MOZJPEG_MIME;

    if (!isJpegIn && !isJpegOut) return false;
    if (isJpegIn && isJpegOut) return true;
    if (!hasPixelBridge()) return false;
    if (isJpegIn && CANVAS_ENCODABLE_MIMES.has(output.mime)) return true;
    if (isJpegOut && CANVAS_DECODABLE_MIMES.has(input.mime)) return true;

    return false;
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    inputFormat?: FormatDescriptor,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > this.maxInputBytes) {
      throw new MozjpegInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    const resolvedInputMime = inputFormat?.mime ?? input.type;
    const isJpegIn = resolvedInputMime === MOZJPEG_MIME;
    const isJpegOut = output.mime === MOZJPEG_MIME;

    const encodeOpts = this.resolveEncodeOptions(options.quality);

    if (isJpegIn && isJpegOut) {
      return this.convertJpegToJpeg(input, output, options, encodeOpts, startMs);
    }
    if (isJpegIn) {
      return this.convertJpegToCanvas(input, output, options, startMs);
    }
    return this.convertCanvasToJpeg(input, output, options, encodeOpts, startMs);
  }

  private async convertJpegToJpeg(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: MozjpegEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeMozjpeg(bytes);
    throwIfAborted(signal);
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeMozjpeg(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: MOZJPEG_MIME });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  private async convertJpegToCanvas(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeMozjpeg(bytes);
    throwIfAborted(signal);
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 60, phase: 'bridge' });
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

  private async convertCanvasToJpeg(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: MozjpegEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'bridge' });
    const imageData = await blobToImageData(input);
    throwIfAborted(signal);
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeMozjpeg(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: MOZJPEG_MIME });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  private resolveEncodeOptions(qualityRatio?: number): MozjpegEncodeOptions {
    const base = this.encodeDefaults ?? {};
    if (qualityRatio === undefined) {
      return base;
    }
    const quality = Math.round(clampFinite(qualityRatio, 0, 1) * 100);
    return { ...base, quality };
  }

  private assertPixelCount(width: number, height: number): void {
    const pixels = width * height;
    if (pixels > this.maxPixels) {
      throw new MozjpegDimensionsTooLargeError(width, height, this.maxPixels);
    }
  }
}

/**
 * Registers a MozjpegBackend instance with the given registry (or the
 * process-wide defaultRegistry when omitted). No auto-registration on import.
 *
 * @throws {Error} if a backend with the same name is already registered.
 */
export function registerMozjpegBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: MozjpegBackendOptions,
): void {
  const backend = new MozjpegBackend(opts);
  registry.register(backend);
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}
