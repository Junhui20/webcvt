/**
 * JPEG XL decode helpers for @catlabtech/webcvt-image-jsquash-jxl.
 *
 * Validates input bounds before calling jsquash, checks decoded dimensions
 * against MAX_PIXELS, and wraps all jsquash errors as typed WebcvtError subclasses.
 *
 * DECODE-BOMB DESIGN NOTE:
 * jsquash ^1.3.0 exposes no public JXL-header inspection API, so the MAX_PIXELS
 * check fires AFTER mod.decode() has already allocated width×height×4 bytes inside
 * wasm linear memory. MAX_INPUT_BYTES (256 MiB) is therefore the real first line of
 * defence. The post-decode pixel check (MAX_PIXELS = 25 MP ≈ 100 MB worst-case) is
 * defense-in-depth, not the primary guard.
 */

import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { JxlDecodeError, JxlDimensionsTooLargeError, JxlInputTooLargeError } from './errors.ts';
import { ensureLoaded } from './loader.ts';

// ---------------------------------------------------------------------------
// decodeJxl
// ---------------------------------------------------------------------------

/**
 * Decodes a JPEG XL byte stream to ImageData.
 *
 * Boundary checks:
 * 1. Input byte length must be ≤ MAX_INPUT_BYTES (256 MiB) — checked BEFORE wasm call.
 * 2. Decoded pixel count (width × height) must be ≤ MAX_PIXELS (25 MP) — checked AFTER
 *    wasm decode (jsquash ^1.3.0 has no pre-decode dimension API; see module-level note).
 *
 * @param bytes - JXL-encoded data as Uint8Array or ArrayBuffer.
 * @returns Decoded pixel data as ImageData (RGBA, 8-bit).
 * @throws {JxlInputTooLargeError} if input exceeds MAX_INPUT_BYTES.
 * @throws {JxlLoadError} if @jsquash/jxl fails to load.
 * @throws {JxlDecodeError} if @jsquash/jxl cannot decode the data.
 * @throws {JxlDimensionsTooLargeError} if decoded image exceeds MAX_PIXELS.
 */
export async function decodeJxl(bytes: Uint8Array | ArrayBuffer): Promise<ImageData> {
  // Boundary check 1: input size
  const byteLength = bytes.byteLength;
  if (byteLength > MAX_INPUT_BYTES) {
    throw new JxlInputTooLargeError(byteLength, MAX_INPUT_BYTES);
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
    throw new JxlDecodeError('JXL decode failed — see error.cause for details.', { cause: err });
  }

  // Boundary check 2: decoded pixel count
  const pixels = imageData.width * imageData.height;
  if (pixels > MAX_PIXELS) {
    throw new JxlDimensionsTooLargeError(imageData.width, imageData.height, MAX_PIXELS);
  }

  return imageData;
}
