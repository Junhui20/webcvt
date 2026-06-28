/**
 * JPEG encode helpers for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Validates and clamps all encode options, then delegates to @jsquash/jpeg
 * (MozJPEG). All boundary checking happens before the wasm call so errors are
 * typed WebcvtError subclasses, not raw wasm panics.
 *
 * Option mapping note:
 * - Our `quality` (0-100) maps directly to MozJPEG `quality` (0-100, higher = better).
 * - `progressive` / `baseline` map to the corresponding MozJPEG booleans. All other
 *   MozJPEG options (trellis, chroma subsample, etc.) use jsquash defaults.
 */

import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { MozjpegDimensionsTooLargeError, MozjpegEncodeError } from './errors.ts';
import type { JsquashMozjpegEncodeOptions } from './loader.ts';
import { ensureLoaded } from './loader.ts';

/** v1 encode option surface. Deferred: trellis, chroma subsample, smoothing, etc. */
export interface MozjpegEncodeOptions {
  /** Encode quality, 0 (worst) – 100 (best). Default: 75. */
  readonly quality?: number;
  /** Produce a progressive JPEG. Default: false. */
  readonly progressive?: boolean;
  /** Force a baseline (non-optimised) JPEG. Default: false. */
  readonly baseline?: boolean;
}

/**
 * Clamps value to [min, max].
 * Throws MozjpegEncodeError if value is not finite (NaN, Infinity, -Infinity).
 */
function clamp(value: number, min: number, max: number, optionName: string): number {
  if (!Number.isFinite(value)) {
    throw new MozjpegEncodeError(
      `Option '${optionName}' must be a finite number, got ${String(value)}.`,
    );
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Encodes an ImageData object to a JPEG byte array via MozJPEG.
 *
 * @param image - Source pixel data. Only 8-bit RGBA is supported.
 * @param opts  - Encode options (see MozjpegEncodeOptions).
 * @returns Encoded JPEG bytes as Uint8Array.
 * @throws {MozjpegLoadError} if @jsquash/jpeg is not installed or fails to load.
 * @throws {MozjpegEncodeError} if encode fails, options are invalid, or ImageData is malformed.
 * @throws {MozjpegDimensionsTooLargeError} if image.width × image.height exceeds MAX_PIXELS.
 */
export async function encodeMozjpeg(
  image: ImageData,
  opts?: MozjpegEncodeOptions,
): Promise<Uint8Array> {
  const pixels = image.width * image.height;
  if (pixels > MAX_PIXELS) {
    throw new MozjpegDimensionsTooLargeError(image.width, image.height, MAX_PIXELS);
  }

  const expectedBytes = image.width * image.height * 4;
  if (image.data.byteLength !== expectedBytes) {
    throw new MozjpegEncodeError(
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
    throw new MozjpegEncodeError('JPEG encode failed — see error.cause for details.', {
      cause: err,
    });
  }

  return new Uint8Array(result);
}

/**
 * Resolves and validates MozjpegEncodeOptions, clamping numeric bounds.
 * Returns a partial JsquashMozjpegEncodeOptions suitable for jsquash encode().
 *
 * @internal
 */
export function resolveOptions(opts?: MozjpegEncodeOptions): Partial<JsquashMozjpegEncodeOptions> {
  const quality =
    opts?.quality !== undefined
      ? clamp(Math.round(opts.quality), 0, 100, 'quality')
      : DEFAULT_ENCODE.quality;
  const progressive = opts?.progressive ?? DEFAULT_ENCODE.progressive;
  const baseline = opts?.baseline ?? DEFAULT_ENCODE.baseline;

  return {
    quality,
    progressive,
    baseline,
  };
}
