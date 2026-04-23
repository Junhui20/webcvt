/**
 * AVIF decode helpers for @catlabtech/webcvt-image-jsquash-avif.
 *
 * Validates input bounds before calling jsquash, checks decoded dimensions
 * against MAX_PIXELS, and wraps all jsquash errors as typed WebcvtError subclasses.
 *
 * DECODE-BOMB DESIGN NOTE:
 * jsquash ^1.3.0 exposes no public AVIF-header inspection API, so the MAX_PIXELS
 * check fires AFTER mod.decode() has already allocated width×height×4 bytes inside
 * wasm linear memory. MAX_INPUT_BYTES (256 MiB) is therefore the real first line of
 * defence — AVIF compression ratios are bounded, so a 256 MiB payload cannot
 * decompress to arbitrarily many pixels. The post-decode pixel check (MAX_PIXELS =
 * 25 MP ≈ 100 MB worst-case) is defense-in-depth, not the primary guard.
 * Callers who need higher pixel limits may pass maxPixels to AvifBackend({ maxPixels }).
 */

import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { AvifDecodeError, AvifDimensionsTooLargeError, AvifInputTooLargeError } from './errors.ts';
import { ensureLoaded } from './loader.ts';

// ---------------------------------------------------------------------------
// decodeAvif
// ---------------------------------------------------------------------------

/**
 * Decodes an AVIF byte stream to ImageData.
 *
 * Boundary checks:
 * 1. Input byte length must be ≤ MAX_INPUT_BYTES (256 MiB) — checked BEFORE wasm call.
 * 2. Decoded pixel count (width × height) must be ≤ MAX_PIXELS (25 MP) — checked AFTER
 *    wasm decode (jsquash ^1.3.0 has no pre-decode dimension API; see module-level note).
 *
 * @param bytes - AVIF-encoded data as Uint8Array or ArrayBuffer.
 * @returns Decoded pixel data as ImageData (RGBA, 8-bit).
 * @throws {AvifInputTooLargeError} if input exceeds MAX_INPUT_BYTES.
 * @throws {AvifLoadError} if @jsquash/avif fails to load.
 * @throws {AvifDecodeError} if @jsquash/avif cannot decode the data.
 * @throws {AvifDimensionsTooLargeError} if decoded image exceeds MAX_PIXELS.
 */
export async function decodeAvif(bytes: Uint8Array | ArrayBuffer): Promise<ImageData> {
  // Boundary check 1: input size
  const byteLength = bytes.byteLength;
  if (byteLength > MAX_INPUT_BYTES) {
    throw new AvifInputTooLargeError(byteLength, MAX_INPUT_BYTES);
  }

  const mod = await ensureLoaded();

  // Normalise to ArrayBuffer for jsquash (decode() only accepts ArrayBuffer)
  const buffer =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  let imageData: ImageData;
  try {
    imageData = await mod.decode(buffer as ArrayBuffer);
  } catch (err) {
    // Generic message avoids leaking internal paths from jsquash error messages.
    // Full error details are available via error.cause.
    throw new AvifDecodeError('AVIF decode failed — see error.cause for details.', { cause: err });
  }

  // Boundary check 2: decoded pixel count (Trap §4)
  const pixels = imageData.width * imageData.height;
  if (pixels > MAX_PIXELS) {
    throw new AvifDimensionsTooLargeError(imageData.width, imageData.height, MAX_PIXELS);
  }

  return imageData;
}
