/**
 * PNG optimise/encode helpers for @catlabtech/webcvt-image-jsquash-oxipng.
 *
 * `optimisePng` accepts either an existing PNG (Uint8Array / ArrayBuffer) — which
 * OxiPNG losslessly re-compresses — or raw pixels (ImageData), which it encodes
 * to a freshly-optimised PNG. All boundary checks happen before the wasm call so
 * errors are typed WebcvtError subclasses, not raw wasm panics.
 */

import { DEFAULT_OPTIONS, MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import {
  OxipngDimensionsTooLargeError,
  OxipngInputTooLargeError,
  OxipngOptimiseError,
} from './errors.ts';
import type { JsquashOxipngOptions } from './loader.ts';
import { ensureLoaded } from './loader.ts';

/** v1 optimise option surface — maps directly to @jsquash/oxipng OptimiseOptions. */
export interface OxipngOptions {
  /** Optimisation level, 0 (fastest) – 6 (slowest / smallest). Default: 2. */
  readonly level?: number;
  /** Produce an interlaced (Adam7) PNG. Default: false. */
  readonly interlace?: boolean;
  /** Allow lossy alpha-channel optimisation for fully-transparent pixels. Default: false. */
  readonly optimiseAlpha?: boolean;
}

function clamp(value: number, min: number, max: number, optionName: string): number {
  if (!Number.isFinite(value)) {
    throw new OxipngOptimiseError(
      `Option '${optionName}' must be a finite number, got ${String(value)}.`,
    );
  }
  return Math.max(min, Math.min(max, value));
}

/** Returns true for byte inputs (existing PNG), false for ImageData (raw pixels). */
function isBytes(input: Uint8Array | ArrayBuffer | ImageData): input is Uint8Array | ArrayBuffer {
  return input instanceof Uint8Array || input instanceof ArrayBuffer;
}

/**
 * Losslessly optimise / encode a PNG.
 *
 * @param input - An existing PNG (Uint8Array | ArrayBuffer) to re-compress, or
 *                ImageData (8-bit RGBA) to encode to a freshly-optimised PNG.
 * @param opts  - Optimise options (see OxipngOptions).
 * @returns Optimised PNG bytes as Uint8Array.
 * @throws {OxipngLoadError} if @jsquash/oxipng is not installed or fails to load.
 * @throws {OxipngInputTooLargeError} if a byte input exceeds MAX_INPUT_BYTES.
 * @throws {OxipngDimensionsTooLargeError} if an ImageData input exceeds MAX_PIXELS.
 * @throws {OxipngOptimiseError} if optimisation fails or the ImageData is malformed.
 */
export async function optimisePng(
  input: Uint8Array | ArrayBuffer | ImageData,
  opts?: OxipngOptions,
): Promise<Uint8Array> {
  const resolved = resolveOptions(opts);

  let data: ArrayBuffer | ImageData;
  if (isBytes(input)) {
    const byteLength = input.byteLength;
    if (byteLength > MAX_INPUT_BYTES) {
      throw new OxipngInputTooLargeError(byteLength, MAX_INPUT_BYTES);
    }
    data =
      input instanceof ArrayBuffer
        ? input
        : (input.buffer.slice(
            input.byteOffset,
            input.byteOffset + input.byteLength,
          ) as ArrayBuffer);
  } else {
    const pixels = input.width * input.height;
    if (pixels > MAX_PIXELS) {
      throw new OxipngDimensionsTooLargeError(input.width, input.height, MAX_PIXELS);
    }
    const expectedBytes = input.width * input.height * 4;
    if (input.data.byteLength !== expectedBytes) {
      throw new OxipngOptimiseError(
        `ImageData.data.byteLength (${String(input.data.byteLength)}) does not match ` +
          `width × height × 4 (${String(expectedBytes)}). The ImageData appears corrupted.`,
      );
    }
    data = input;
  }

  const mod = await ensureLoaded();

  let result: ArrayBuffer;
  try {
    result = await mod.optimise(data, resolved);
  } catch (err) {
    throw new OxipngOptimiseError('PNG optimisation failed — see error.cause for details.', {
      cause: err,
    });
  }

  return new Uint8Array(result);
}

/**
 * Resolves and validates OxipngOptions, clamping numeric bounds.
 *
 * @internal
 */
export function resolveOptions(opts?: OxipngOptions): Partial<JsquashOxipngOptions> {
  const level =
    opts?.level !== undefined
      ? clamp(Math.round(opts.level), 0, 6, 'level')
      : DEFAULT_OPTIONS.level;
  const interlace = opts?.interlace ?? DEFAULT_OPTIONS.interlace;
  const optimiseAlpha = opts?.optimiseAlpha ?? DEFAULT_OPTIONS.optimiseAlpha;

  return {
    level,
    interlace,
    optimiseAlpha,
  };
}
