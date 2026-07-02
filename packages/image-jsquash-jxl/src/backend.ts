/**
 * JxlBackend — webcvt Backend implementation for JPEG XL decode/encode.
 *
 * Capabilities:
 * - JXL → JXL: re-encode (decode + encode, no pixel bridge needed)
 * - JXL → {PNG, JPEG, WebP}: jsquash decode → pixel bridge → canvas blob
 * - {PNG, JPEG, WebP} → JXL: canvas blob → pixel bridge → jsquash encode
 *
 * Node.js guard: when OffscreenCanvas is unavailable, returns false for
 * all pixel-bridge paths. JXL→JXL works without canvas.
 *
 * Key invariants:
 * - canHandle() NEVER triggers wasm load (Trap §1).
 * - AbortSignal is checked between every async phase (Trap §5).
 * - MAX_INPUT_BYTES checked before wasm (JxlInputTooLargeError).
 * - MAX_PIXELS checked after decode and before encode (JxlDimensionsTooLargeError).
 *
 * Routing invariant:
 * - convert() routing uses input FormatDescriptor.mime (not Blob.type) to decide
 *   the conversion path. The FormatDescriptor passed to convert() is the
 *   authoritative source of format truth.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { JXL_MIME, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { decodeJxl } from './decode.ts';
import { encodeJxl } from './encode.ts';
import type { JxlEncodeOptions } from './encode.ts';
import { JxlDimensionsTooLargeError, JxlInputTooLargeError } from './errors.ts';
import { JXL_FORMAT } from './format.ts';
import { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

// ---------------------------------------------------------------------------
// Supported MIME sets
// ---------------------------------------------------------------------------

/** MIME types that the browser canvas can decode (for non-JXL input paths). */
const CANVAS_DECODABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** MIME types we can output via pixel bridge (canvas-native). */
const CANVAS_ENCODABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ---------------------------------------------------------------------------
// JxlBackendOptions
// ---------------------------------------------------------------------------

export interface JxlBackendOptions {
  /** Default JXL encode options. Per-call quality from ConvertOptions.quality overrides. */
  readonly encode?: JxlEncodeOptions;
  /** Override for MAX_INPUT_BYTES. Defaults to 256 MiB. */
  readonly maxInputBytes?: number;
  /**
   * Override for MAX_PIXELS. Defaults to 25 MP.
   *
   * Note: the pixel check fires AFTER wasm decode (jsquash ^1.3.0 has no pre-decode
   * dimension API). At 25 MP the worst-case allocation is ~100 MB. See decode.ts for
   * the full decode-bomb mitigation note.
   */
  readonly maxPixels?: number;
}

// ---------------------------------------------------------------------------
// JxlBackend
// ---------------------------------------------------------------------------

/**
 * Backend that decodes and encodes JPEG XL images using @jsquash/jxl.
 *
 * The wasm module is lazy-loaded on the first convert() call.
 * Import of this package does NOT trigger any network activity.
 */
export class JxlBackend implements Backend {
  readonly name = 'image-jsquash-jxl';
  /** Specialized JPEG XL codec — outrank generic any-in/any-out backends (Canvas, wasm). */
  readonly priority = 10;

  private readonly encodeDefaults: JxlEncodeOptions | undefined;
  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: JxlBackendOptions) {
    this.encodeDefaults = opts?.encode;
    this.maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  }

  // -------------------------------------------------------------------------
  // canHandle — NEVER loads wasm (Trap §1)
  // -------------------------------------------------------------------------

  /**
   * Returns true when the backend can handle this input→output pair.
   *
   * Matrix:
   * - JXL → JXL: always yes
   * - JXL → {PNG, JPEG, WebP}: yes when pixel bridge is available
   * - {PNG, JPEG, WebP} → JXL: yes when pixel bridge is available
   * - Everything else: no
   *
   * In Node.js (no OffscreenCanvas), bridge paths return false.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    const isJxlIn = input.mime === JXL_MIME;
    const isJxlOut = output.mime === JXL_MIME;

    // Both sides must have JXL involved
    if (!isJxlIn && !isJxlOut) return false;

    // JXL → JXL: no pixel bridge needed
    if (isJxlIn && isJxlOut) return true;

    // Any other path requires the pixel bridge
    if (!hasPixelBridge()) return false;

    // JXL → {PNG, JPEG, WebP}
    if (isJxlIn && CANVAS_ENCODABLE_MIMES.has(output.mime)) return true;

    // {PNG, JPEG, WebP} → JXL
    if (isJxlOut && CANVAS_DECODABLE_MIMES.has(input.mime)) return true;

    return false;
  }

  // -------------------------------------------------------------------------
  // convert
  // -------------------------------------------------------------------------

  /**
   * Converts input Blob to the requested output format.
   *
   * Routing is based on the FormatDescriptor arguments (not Blob.type), so JXL
   * blobs with empty Blob.type are correctly handled.
   *
   * @param input       - Input blob to convert.
   * @param output      - Target format descriptor.
   * @param options     - Convert options (quality, signal, progress callback).
   * @param inputFormat - Format descriptor for the input (authoritative MIME source).
   */
  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    inputFormat?: FormatDescriptor,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    // Boundary: input size (checked before any wasm call)
    if (input.size > this.maxInputBytes) {
      throw new JxlInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;

    // Check abort before any async work
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    // Use FormatDescriptor.mime for routing (authoritative); Blob.type may be '' when
    // the caller did not set it. Fall back to Blob.type only if no inputFormat is provided.
    const resolvedInputMime = inputFormat?.mime ?? input.type;
    const isJxlIn = resolvedInputMime === JXL_MIME;
    const isJxlOut = output.mime === JXL_MIME;

    // Merge quality: ConvertOptions.quality (0–1 range) overrides encode defaults
    const encodeOpts = this.resolveEncodeOptions(options.quality);

    if (isJxlIn && isJxlOut) {
      return this.convertJxlToJxl(input, output, options, encodeOpts, startMs);
    }

    if (isJxlIn) {
      return this.convertJxlToCanvas(input, output, options, startMs);
    }

    // isJxlOut must be true here (canHandle enforces at least one side is JXL)
    return this.convertCanvasToJxl(input, output, options, encodeOpts, startMs);
  }

  // -------------------------------------------------------------------------
  // Private: JXL → JXL
  // -------------------------------------------------------------------------

  private async convertJxlToJxl(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: JxlEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeJxl(bytes);
    throwIfAborted(signal);

    // Pixel count check post-decode (defense-in-depth on top of decodeJxl's own check)
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeJxl(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: JXL_MIME });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  // -------------------------------------------------------------------------
  // Private: JXL → PNG/JPEG/WebP
  // -------------------------------------------------------------------------

  private async convertJxlToCanvas(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeJxl(bytes);
    throwIfAborted(signal);

    // Pixel count check post-decode (defense-in-depth)
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 60, phase: 'bridge' });
    const quality = options.quality;
    const blob = await imageDataToBlob(imageData, output.mime, quality);
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

  // -------------------------------------------------------------------------
  // Private: PNG/JPEG/WebP → JXL
  // -------------------------------------------------------------------------

  private async convertCanvasToJxl(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: JxlEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'bridge' });
    const imageData = await blobToImageData(input);
    throwIfAborted(signal);

    // Pixel count check after bridge decode
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeJxl(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: JXL_FORMAT.mime });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private resolveEncodeOptions(qualityRatio?: number): JxlEncodeOptions {
    const base = this.encodeDefaults ?? {};
    if (qualityRatio === undefined) {
      return base;
    }
    // Map 0–1 range to 0–100 (ConvertOptions.quality convention). clampFinite guards NaN/Inf.
    const quality = Math.round(clampFinite(qualityRatio, 0, 1) * 100);
    return { ...base, quality };
  }

  private assertPixelCount(width: number, height: number): void {
    const pixels = width * height;
    if (pixels > this.maxPixels) {
      throw new JxlDimensionsTooLargeError(width, height, this.maxPixels);
    }
  }
}

// ---------------------------------------------------------------------------
// registerJxlBackend — explicit opt-in (no auto-register on import)
// ---------------------------------------------------------------------------

/**
 * Registers a JxlBackend instance with the given registry (or the
 * process-wide defaultRegistry when omitted).
 *
 * Must be called explicitly by the application. No auto-registration
 * happens on import (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerJxlBackend } from '@catlabtech/webcvt-image-jsquash-jxl';
 * registerJxlBackend();
 * ```
 *
 * @param registry - Target registry. Defaults to core's defaultRegistry.
 * @param opts     - Backend constructor options.
 * @throws {Error} if a backend with the same name is already registered in the registry.
 */
export function registerJxlBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: JxlBackendOptions,
): void {
  const backend = new JxlBackend(opts);
  registry.register(backend);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamps value to [min, max]. Silently returns min for NaN (qualityRatio internal use only).
 * For user-facing numeric options use encode.ts clamp() which throws on non-finite input.
 */
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
