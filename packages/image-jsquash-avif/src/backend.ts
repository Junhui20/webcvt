/**
 * AvifBackend — webcvt Backend implementation for AVIF decode/encode.
 *
 * Capabilities:
 * - AVIF → AVIF: re-encode (decode + encode, no pixel bridge needed)
 * - AVIF → {PNG, JPEG, WebP}: jsquash decode → pixel bridge → canvas blob
 * - {PNG, JPEG, WebP} → AVIF: canvas blob → pixel bridge → jsquash encode
 *
 * Node.js guard: when OffscreenCanvas is unavailable, returns false for
 * all pixel-bridge paths. AVIF→AVIF works without canvas.
 *
 * Key invariants:
 * - canHandle() NEVER triggers wasm load (Trap §1).
 * - AbortSignal is checked between every async phase (Trap §5).
 * - MAX_INPUT_BYTES checked before wasm (AvifInputTooLargeError).
 * - MAX_PIXELS checked after decode and before encode (AvifDimensionsTooLargeError).
 *
 * Routing invariant (HIGH-6 fix):
 * - convert() routing uses input FormatDescriptor.mime (not Blob.type) to decide
 *   the conversion path. Blob.type may be empty ('') if the caller did not set it.
 *   The FormatDescriptor passed to convert() is the authoritative source of format truth.
 */

import type {
  Backend,
  BackendRegistry,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { AVIF_MIME, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { decodeAvif } from './decode.ts';
import { encodeAvif } from './encode.ts';
import type { AvifEncodeOptions } from './encode.ts';
import { AvifDimensionsTooLargeError, AvifInputTooLargeError } from './errors.ts';
import { AVIF_FORMAT } from './format.ts';
import { blobToImageData, hasPixelBridge, imageDataToBlob } from './pixel-bridge.ts';

// ---------------------------------------------------------------------------
// Supported MIME sets
// ---------------------------------------------------------------------------

/** MIME types that the browser canvas can decode (for non-AVIF input paths). */
const CANVAS_DECODABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** MIME types we can output via pixel bridge (canvas-native). */
const CANVAS_ENCODABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ---------------------------------------------------------------------------
// AvifBackendOptions
// ---------------------------------------------------------------------------

export interface AvifBackendOptions {
  /** Default AVIF encode options. Per-call quality from ConvertOptions.quality overrides. */
  readonly encode?: AvifEncodeOptions;
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
// AvifBackend
// ---------------------------------------------------------------------------

/**
 * Backend that decodes and encodes AVIF images using @jsquash/avif.
 *
 * The wasm module is lazy-loaded on the first convert() call.
 * Import of this package does NOT trigger any network activity.
 */
export class AvifBackend implements Backend {
  readonly name = 'image-jsquash-avif';

  private readonly encodeDefaults: AvifEncodeOptions | undefined;
  private readonly maxInputBytes: number;
  private readonly maxPixels: number;

  constructor(opts?: AvifBackendOptions) {
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
   * - AVIF → AVIF: always yes
   * - AVIF → {PNG, JPEG, WebP}: yes when pixel bridge is available
   * - {PNG, JPEG, WebP} → AVIF: yes when pixel bridge is available
   * - Everything else: no
   *
   * In Node.js (no OffscreenCanvas), bridge paths return false.
   */
  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    const isAvifIn = input.mime === AVIF_MIME;
    const isAvifOut = output.mime === AVIF_MIME;

    // Both sides must have AVIF involved
    if (!isAvifIn && !isAvifOut) return false;

    // AVIF → AVIF: no pixel bridge needed
    if (isAvifIn && isAvifOut) return true;

    // Any other path requires the pixel bridge
    if (!hasPixelBridge()) return false;

    // AVIF → {PNG, JPEG, WebP}
    if (isAvifIn && CANVAS_ENCODABLE_MIMES.has(output.mime)) return true;

    // {PNG, JPEG, WebP} → AVIF
    if (isAvifOut && CANVAS_DECODABLE_MIMES.has(input.mime)) return true;

    return false;
  }

  // -------------------------------------------------------------------------
  // convert
  // -------------------------------------------------------------------------

  /**
   * Converts input Blob to the requested output format.
   *
   * Routing is based on the FormatDescriptor arguments (not Blob.type), so AVIF
   * blobs with empty Blob.type are correctly handled. The FormatDescriptor passed
   * by the orchestrator is the authoritative source of format truth.
   *
   * @param input       - Input blob to convert.
   * @param inputFormat - Format descriptor for the input (authoritative MIME source).
   * @param output      - Target format descriptor.
   * @param options     - Convert options (quality, signal, progress callback).
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
      throw new AvifInputTooLargeError(input.size, this.maxInputBytes);
    }

    const { signal } = options;

    // Check abort before any async work
    throwIfAborted(signal);
    options.onProgress?.({ percent: 5, phase: 'load' });

    // Use FormatDescriptor.mime for routing (authoritative); Blob.type may be '' when
    // the caller did not set it (HIGH-6 fix). Fall back to Blob.type only if no
    // inputFormat is provided (backward-compat with callers using the 3-arg signature).
    const resolvedInputMime = inputFormat?.mime ?? input.type;
    const isAvifIn = resolvedInputMime === AVIF_MIME;
    const isAvifOut = output.mime === AVIF_MIME;

    // Merge quality: ConvertOptions.quality (0–1 range) overrides encode defaults
    const encodeOpts = this.resolveEncodeOptions(options.quality);

    if (isAvifIn && isAvifOut) {
      return this.convertAvifToAvif(input, output, options, encodeOpts, startMs);
    }

    if (isAvifIn) {
      return this.convertAvifToCanvas(input, output, options, startMs);
    }

    // isAvifOut must be true here (canHandle enforces at least one side is AVIF)
    return this.convertCanvasToAvif(input, output, options, encodeOpts, startMs);
  }

  // -------------------------------------------------------------------------
  // Private: AVIF → AVIF
  // -------------------------------------------------------------------------

  private async convertAvifToAvif(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: AvifEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeAvif(bytes);
    throwIfAborted(signal);

    // Pixel count check post-decode (defense-in-depth on top of decodeAvif's own check)
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeAvif(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: AVIF_MIME });
    return {
      blob,
      format: output,
      durationMs: Date.now() - startMs,
      backend: this.name,
      hardwareAccelerated: false,
    };
  }

  // -------------------------------------------------------------------------
  // Private: AVIF → PNG/JPEG/WebP
  // -------------------------------------------------------------------------

  private async convertAvifToCanvas(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'decode' });
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfAborted(signal);

    const imageData = await decodeAvif(bytes);
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
  // Private: PNG/JPEG/WebP → AVIF
  // -------------------------------------------------------------------------

  private async convertCanvasToAvif(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
    encodeOpts: AvifEncodeOptions,
    startMs: number,
  ): Promise<ConvertResult> {
    const { signal } = options;

    options.onProgress?.({ percent: 10, phase: 'bridge' });
    const imageData = await blobToImageData(input);
    throwIfAborted(signal);

    // Pixel count check after bridge decode
    this.assertPixelCount(imageData.width, imageData.height);

    options.onProgress?.({ percent: 50, phase: 'encode' });
    const encoded = await encodeAvif(imageData, encodeOpts);
    throwIfAborted(signal);

    options.onProgress?.({ percent: 100, phase: 'done' });

    const blob = new Blob([encoded.buffer as ArrayBuffer], { type: AVIF_FORMAT.mime });
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

  private resolveEncodeOptions(qualityRatio?: number): AvifEncodeOptions {
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
      throw new AvifDimensionsTooLargeError(width, height, this.maxPixels);
    }
  }
}

// ---------------------------------------------------------------------------
// registerAvifBackend — explicit opt-in (no auto-register on import)
// ---------------------------------------------------------------------------

/**
 * Registers an AvifBackend instance with the given registry (or the
 * process-wide defaultRegistry when omitted).
 *
 * Must be called explicitly by the application. No auto-registration
 * happens on import (Trap §1: preserves tree-shaking / sideEffects: false).
 *
 * @example
 * ```ts
 * import { registerAvifBackend } from '@catlabtech/webcvt-image-jsquash-avif';
 * registerAvifBackend();
 * ```
 *
 * @param registry - Target registry. Defaults to core's defaultRegistry.
 * @param opts     - Backend constructor options.
 * @throws {Error} if a backend with the same name is already registered in the registry.
 *   Double-registration is intentionally rejected — see BackendRegistry.register contract.
 *   If you need to replace a backend, create a new registry or call register on a fresh one.
 */
export function registerAvifBackend(
  registry: BackendRegistry = defaultRegistry,
  opts?: AvifBackendOptions,
): void {
  const backend = new AvifBackend(opts);
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
