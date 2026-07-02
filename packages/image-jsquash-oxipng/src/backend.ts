/**
 * OxipngBackend — webcvt Backend for lossless PNG optimisation / encoding via OxiPNG.
 *
 * Capabilities (PNG is always the OUTPUT — OxiPNG only produces PNG):
 * - PNG → PNG: losslessly re-compress the existing PNG (no decode, no pixel bridge)
 * - {JPEG, WebP} → PNG: canvas bridge decode → OxiPNG encode (smaller than canvas PNG)
 *
 * NOTE: `image/png` is also handled by `@catlabtech/webcvt-image-canvas`. Register
 * only one of the two per registry. This backend is for callers who want OxiPNG's
 * smaller, losslessly-optimised PNG output.
 *
 * Key invariants:
 * - canHandle() NEVER triggers wasm load (Trap §1).
 * - AbortSignal is checked between every async phase (Trap §5).
 * - MAX_INPUT_BYTES checked before wasm; MAX_PIXELS after a bridge decode.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { MAX_INPUT_BYTES, MAX_PIXELS, OXIPNG_MIME } from './constants.ts';
import { OxipngDimensionsTooLargeError, OxipngInputTooLargeError } from './errors.ts';
import { optimisePng } from './optimise.ts';
import type { OxipngOptions } from './optimise.ts';
import { blobToImageData, hasPixelBridge } from './pixel-bridge.ts';

/** Non-PNG source formats we can decode to pixels via the canvas bridge. */
const CANVAS_DECODABLE_MIMES = new Set(['image/jpeg', 'image/webp']);

export interface OxipngBackendOptions {
  /** Default optimise options (level / interlace / optimiseAlpha). */
  readonly optimise?: OxipngOptions;
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
  /** Override for MAX_PIXELS. Defaults to 25 MP. */
  readonly maxPixels?: number;
}

/**
 * Backend that optimises / encodes PNG images using @jsquash/oxipng.
 * The wasm module is lazy-loaded on the first convert() call.
 */
export class OxipngBackend implements Backend {
  readonly name = 'image-jsquash-oxipng';
  /** Specialized PNG optimizer — outrank generic any-in/any-out backends (Canvas, wasm). */
  readonly priority = 10;

  private readonly optimiseDefaults: OxipngOptions | undefined;
  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: OxipngBackendOptions) {
    this.optimiseDefaults = opts?.optimise;
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  }

  /**
   * Returns true when the backend can handle this input→output pair.
   * PNG must be the OUTPUT. PNG input optimises directly; other inputs need the bridge.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (output.mime !== OXIPNG_MIME) return false;
    if (input.mime === OXIPNG_MIME) return true;
    if (!hasPixelBridge()) return false;
    return CANVAS_DECODABLE_MIMES.has(input.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    inputFormat?: FormatDescriptor,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    if (input.size > this.maxInputBytes) {
      throw new OxipngInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    const resolvedInputMime = inputFormat?.mime ?? input.type;
    const isPngIn = resolvedInputMime === OXIPNG_MIME;

    if (isPngIn) {
      return this.optimisePngToPng(input, output, options, startMs);
    }
    return this.convertCanvasToPng(input, output, options, startMs);
  }

  private async optimisePngToPng(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 20, phase: 'optimise' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const optimised = await optimisePng(bytes, this.optimiseDefaults);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    return this.result(optimised, output, startMs);
  }

  private async convertCanvasToPng(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'bridge' });
    const imageData = await blobToImageData(input);
    throwIfAborted(signal);
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'optimise' });
    const optimised = await optimisePng(imageData, this.optimiseDefaults);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });
    return this.result(optimised, output, startMs);
  }

  private result(bytes: Uint8Array, output: FormatDescriptor, startMs: number): ConvertResult {
    return {
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: OXIPNG_MIME }),
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  private assertPixelCount(width: number, height: number): void {
    const pixels = width * height;
    if (pixels > this.maxPixels) {
      throw new OxipngDimensionsTooLargeError(width, height, this.maxPixels);
    }
  }
}

/**
 * Registers an OxipngBackend instance with the given registry (or the
 * process-wide defaultRegistry when omitted). No auto-registration on import.
 *
 * @throws {Error} if a backend with the same name is already registered.
 */
export function registerOxipngBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: OxipngBackendOptions,
): void {
  const backend = new OxipngBackend(opts);
  registry.register(backend);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}
