/**
 * AVIF encode helpers for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Validates and clamps all encode options, then delegates to @jsquash/avif.
 * All boundary checking happens before the wasm call so errors are typed
 * WebcvtError subclasses, not raw wasm panics.
 *
 * Option mapping note:
 * - Our `quality` (0-100 scale) maps to jsquash `cqLevel` (0-62 constant quantizer;
 *   lower = better quality, higher = worse). quality 100 → cqLevel 0 (lossless),
 *   quality 0 → cqLevel 62 (worst).
 * - Our `qualityAlpha` (-1=use quality, 0-100) maps to jsquash `cqAlphaLevel` (-1 to 62).
 * - jsquash does NOT have a `bitDepth` parameter in ^1.3.0 (always 8-bit from canvas).
 */

import { DEFAULT_ENCODE, MAX_PIXELS } from './constants.ts';
import { AvifDimensionsTooLargeError, AvifEncodeError } from './errors.ts';
import type { JsquashEncodeOptions } from './loader.ts';
import { ensureLoaded } from './loader.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** v1 encode option surface. Deferred: denoiseLevel, tile params, chromaDeltaQ, etc. */
export interface AvifEncodeOptions {
  /** Encode quality, 0 (worst) – 100 (best). Default: 50. */
  readonly quality?: number;
  /** Encode speed (effort), 0 (slowest/best) – 10 (fastest/worst). Default: 6. */
  readonly speed?: number;
  /**
   * Chroma subsampling:
   * - 0 = YUV 4:4:4 (no subsampling)
   * - 1 = YUV 4:2:2 (default)
   * - 2 = YUV 4:2:0
   * - 3 = YUV 4:0:0 (monochrome)
   */
  readonly subsample?: 0 | 1 | 2 | 3;
  /**
   * Alpha channel quality, -1 (use main quality) – 100 (best). Default: -1.
   * Note: even full-opaque images encode alpha channel; see design-note Trap §3.
   */
  readonly qualityAlpha?: number;
  /**
   * Bit depth. v1 supports 8 only; 10/12 throw AvifEncodeError.
   * Canvas getImageData always returns 8-bit data. See design-note Trap §7.
   * Note: @jsquash/avif ^1.3.0 does not expose bitDepth as an encode param;
   * this option is validated/rejected at the wrapper layer.
   */
  readonly bitDepth?: 8 | 10 | 12;
}

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

/**
 * Clamps value to [min, max].
 * Throws AvifEncodeError with code 'invalidNumericOption' if value is not finite
 * (NaN, Infinity, -Infinity) — forwarding such values to wasm causes undefined behaviour.
 *
 * @param value      - The numeric value to clamp.
 * @param min        - Lower bound (inclusive).
 * @param max        - Upper bound (inclusive).
 * @param optionName - Human-readable option name for the error message.
 */
function clamp(value: number, min: number, max: number, optionName: string): number {
  if (!Number.isFinite(value)) {
    throw new AvifEncodeError(
      `Option '${optionName}' must be a finite number, got ${String(value)}.`,
      // Use a sub-code embedded in message; AvifEncodeError uses 'AVIF_ENCODE_FAILED' code.
    );
  }
  return Math.max(min, Math.min(max, value));
}

const VALID_SUBSAMPLE = new Set<number>([0, 1, 2, 3]);
const VALID_BIT_DEPTH = new Set<number>([8, 10, 12]);

/**
 * Maps our 0-100 quality scale to jsquash's cqLevel (0-62).
 * quality 100 → cqLevel 0 (best), quality 0 → cqLevel 62 (worst).
 */
function qualityToCqLevel(quality: number): number {
  return Math.round((1 - quality / 100) * 62);
}

/**
 * Maps our qualityAlpha (-1..100) to jsquash's cqAlphaLevel (-1..62).
 * -1 means "use main cqLevel". 0..100 maps to 62..0.
 */
function qualityAlphaToCqAlphaLevel(qualityAlpha: number): number {
  if (qualityAlpha === -1) return -1;
  return Math.round((1 - qualityAlpha / 100) * 62);
}

// ---------------------------------------------------------------------------
// encodeAvif
// ---------------------------------------------------------------------------

/**
 * Encodes an ImageData object to an AVIF byte array.
 *
 * All numeric options are clamped/validated before passing to jsquash.
 * bitDepth must be 8 in v1 — 10/12 throw AvifEncodeError (see Trap §7).
 *
 * Input is validated before wasm is called:
 * - image.width × image.height must be ≤ MAX_PIXELS
 * - image.data.byteLength must equal image.width × image.height × 4
 *
 * @param image - Source pixel data. Only 8-bit RGBA is supported.
 * @param opts  - Encode options (see AvifEncodeOptions).
 * @returns Encoded AVIF bytes as Uint8Array.
 * @throws {AvifLoadError} if @jsquash/avif is not installed or fails to load.
 * @throws {AvifEncodeError} if encode fails, options are invalid, or ImageData is malformed.
 * @throws {AvifDimensionsTooLargeError} if image.width × image.height exceeds MAX_PIXELS.
 */
export async function encodeAvif(image: ImageData, opts?: AvifEncodeOptions): Promise<Uint8Array> {
  // Pixel count guard — matches decodeAvif's MAX_PIXELS check
  const pixels = image.width * image.height;
  if (pixels > MAX_PIXELS) {
    throw new AvifDimensionsTooLargeError(image.width, image.height, MAX_PIXELS);
  }

  // Data-length sanity check: corrupted ImageData could trigger OOB reads in wasm
  const expectedBytes = image.width * image.height * 4;
  if (image.data.byteLength !== expectedBytes) {
    throw new AvifEncodeError(
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
    throw new AvifEncodeError('AVIF encode failed — see error.cause for details.', { cause: err });
  }

  return new Uint8Array(result);
}

// ---------------------------------------------------------------------------
// Internal: option resolution + validation
// ---------------------------------------------------------------------------

/**
 * Resolves and validates AvifEncodeOptions, clamping numeric bounds.
 * Returns a partial JsquashEncodeOptions suitable for passing to jsquash encode().
 *
 * Reads defaults from DEFAULT_ENCODE (single source of truth — see constants.ts).
 *
 * @internal
 */
export function resolveOptions(opts?: AvifEncodeOptions): Partial<JsquashEncodeOptions> {
  const quality =
    opts?.quality !== undefined
      ? clamp(Math.round(opts.quality), 0, 100, 'quality')
      : DEFAULT_ENCODE.quality;
  const speed =
    opts?.speed !== undefined
      ? clamp(Math.round(opts.speed), 0, 10, 'speed')
      : DEFAULT_ENCODE.speed;
  const qualityAlpha =
    opts?.qualityAlpha !== undefined
      ? clamp(Math.round(opts.qualityAlpha), -1, 100, 'qualityAlpha')
      : DEFAULT_ENCODE.qualityAlpha;

  const subsample = opts?.subsample ?? DEFAULT_ENCODE.subsample;
  if (!VALID_SUBSAMPLE.has(subsample)) {
    throw new AvifEncodeError(
      `Invalid subsample value: ${String(subsample)}. Must be 0, 1, 2, or 3.`,
    );
  }

  const bitDepth = opts?.bitDepth ?? DEFAULT_ENCODE.bitDepth;
  if (!VALID_BIT_DEPTH.has(bitDepth)) {
    throw new AvifEncodeError(`Invalid bitDepth value: ${String(bitDepth)}. Must be 8, 10, or 12.`);
  }
  if (bitDepth !== 8) {
    throw new AvifEncodeError(
      `bitDepth ${String(bitDepth)} is not supported in v1. Canvas getImageData always produces 8-bit data; encoding as ${String(bitDepth)}-bit would produce incorrect HDR output. See design-note Trap §7. Open an issue to track 10/12-bit support.`,
    );
  }

  return {
    cqLevel: qualityToCqLevel(quality),
    speed,
    subsample,
    cqAlphaLevel: qualityAlphaToCqAlphaLevel(qualityAlpha),
  };
}
