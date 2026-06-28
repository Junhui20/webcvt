/**
 * JPEG XL encode helpers for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Validates and clamps all encode options, then delegates to @jsquash/jxl.
 * All boundary checking happens before the wasm call so errors are typed
 * WebcvtError subclasses, not raw wasm panics.
 *
 * Option mapping note:
 * - Our `quality` (0-100) maps directly to jsquash `quality` (0-100, higher = better).
 *   Unlike AVIF (which uses an inverted cqLevel), JPEG XL's quality scale is direct.
 * - `lossless: true` requests mathematically-lossless encoding (jsquash ignores quality).
 * - `effort` (1-9) maps to jsquash `effort` (encoder effort; higher = slower/smaller).
 */

import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { JxlDimensionsTooLargeError, JxlEncodeError } from './errors.ts';
import type { JsquashJxlEncodeOptions } from './loader.ts';
import { ensureLoaded } from './loader.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** v1 encode option surface. Deferred: epf, photonNoiseIso, decodingSpeedTier, etc. */
export interface JxlEncodeOptions {
  /** Encode quality, 0 (worst) – 100 (best). 100 ≈ visually lossless. Default: 75. */
  readonly quality?: number;
  /** Encoder effort, 1 (fastest) – 9 (slowest / best compression). Default: 7. */
  readonly effort?: number;
  /** Encode mathematically losslessly. When true, `quality` is ignored. Default: false. */
  readonly lossless?: boolean;
  /** Enable progressive decoding. Default: false. */
  readonly progressive?: boolean;
}

// ---------------------------------------------------------------------------
// Clamp helper
// ---------------------------------------------------------------------------

/**
 * Clamps value to [min, max].
 * Throws JxlEncodeError if value is not finite (NaN, Infinity, -Infinity) —
 * forwarding such values to wasm causes undefined behaviour.
 */
function clamp(value: number, min: number, max: number, optionName: string): number {
  if (!Number.isFinite(value)) {
    throw new JxlEncodeError(
      `Option '${optionName}' must be a finite number, got ${String(value)}.`,
    );
  }
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// encodeJxl
// ---------------------------------------------------------------------------

/**
 * Encodes an ImageData object to a JPEG XL byte array.
 *
 * All numeric options are clamped/validated before passing to jsquash.
 *
 * Input is validated before wasm is called:
 * - image.width × image.height must be ≤ MAX_PIXELS
 * - image.data.byteLength must equal image.width × image.height × 4
 *
 * @param image - Source pixel data. Only 8-bit RGBA is supported.
 * @param opts  - Encode options (see JxlEncodeOptions).
 * @returns Encoded JPEG XL bytes as Uint8Array.
 * @throws {JxlLoadError} if @jsquash/jxl is not installed or fails to load.
 * @throws {JxlEncodeError} if encode fails, options are invalid, or ImageData is malformed.
 * @throws {JxlDimensionsTooLargeError} if image.width × image.height exceeds MAX_PIXELS.
 */
export async function encodeJxl(image: ImageData, opts?: JxlEncodeOptions): Promise<Uint8Array> {
  // Pixel count guard — matches decodeJxl's MAX_PIXELS check
  const pixels = image.width * image.height;
  if (pixels > MAX_PIXELS) {
    throw new JxlDimensionsTooLargeError(image.width, image.height, MAX_PIXELS);
  }

  // Data-length sanity check: corrupted ImageData could trigger OOB reads in wasm
  const expectedBytes = image.width * image.height * 4;
  if (image.data.byteLength !== expectedBytes) {
    throw new JxlEncodeError(
      `ImageData.data.byteLength (${String(image.data.byteLength)}) does not match ` +
        `width × height × 4 (${String(expectedBytes)}). The ImageData appears corrupted.`,
    );
  }

  const resolved = resolveOptions(opts);
  const mod = await ensureLoaded();

  let result: ArrayBuffer;
  try {
    result = await mod.encode(image, resolved);
  } catch (err) {
    throw new JxlEncodeError('JXL encode failed — see error.cause for details.', { cause: err });
  }

  return new Uint8Array(result);
}

// ---------------------------------------------------------------------------
// Internal: option resolution + validation
// ---------------------------------------------------------------------------

/**
 * Resolves and validates JxlEncodeOptions, clamping numeric bounds.
 * Returns a partial JsquashJxlEncodeOptions suitable for passing to jsquash encode().
 *
 * Reads defaults from DEFAULT_ENCODE (single source of truth — see constants.ts).
 *
 * @internal
 */
export function resolveOptions(opts?: JxlEncodeOptions): Partial<JsquashJxlEncodeOptions> {
  const quality =
    opts?.quality !== undefined
      ? clamp(Math.round(opts.quality), 0, 100, 'quality')
      : DEFAULT_ENCODE.quality;
  const effort =
    opts?.effort !== undefined
      ? clamp(Math.round(opts.effort), 1, 9, 'effort')
      : DEFAULT_ENCODE.effort;
  const lossless = opts?.lossless ?? DEFAULT_ENCODE.lossless;
  const progressive = opts?.progressive ?? DEFAULT_ENCODE.progressive;

  return {
    quality,
    effort,
    lossless,
    progressive,
  };
}
