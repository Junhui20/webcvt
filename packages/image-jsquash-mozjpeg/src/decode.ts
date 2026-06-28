/**
 * JPEG decode helpers for @catlabtech/webcvt-image-jsquash-mozjpeg.
 *
 * Validates input bounds before calling jsquash, checks decoded dimensions
 * against MAX_PIXELS, and wraps all jsquash errors as typed WebcvtError subclasses.
 */

import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import {
  MozjpegDecodeError,
  MozjpegDimensionsTooLargeError,
  MozjpegInputTooLargeError,
} from './errors.ts';
import { ensureLoaded } from './loader.ts';

/**
 * Decodes a JPEG byte stream to ImageData.
 *
 * @param bytes - JPEG-encoded data as Uint8Array or ArrayBuffer.
 * @returns Decoded pixel data as ImageData (RGBA, 8-bit).
 * @throws {MozjpegInputTooLargeError} if input exceeds MAX_INPUT_BYTES.
 * @throws {MozjpegLoadError} if @jsquash/jpeg fails to load.
 * @throws {MozjpegDecodeError} if @jsquash/jpeg cannot decode the data.
 * @throws {MozjpegDimensionsTooLargeError} if decoded image exceeds MAX_PIXELS.
 */
export async function decodeMozjpeg(bytes: Uint8Array | ArrayBuffer): Promise<ImageData> {
  const byteLength = bytes.byteLength;
  if (byteLength > MAX_INPUT_BYTES) {
    throw new MozjpegInputTooLargeError(byteLength, MAX_INPUT_BYTES);
  }

  const mod = await ensureLoaded();

  const buffer =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  let imageData: ImageData;
  try {
    imageData = await mod.decode(buffer as ArrayBuffer);
  } catch (err) {
    throw new MozjpegDecodeError('JPEG decode failed — see error.cause for details.', {
      cause: err,
    });
  }

  const pixels = imageData.width * imageData.height;
  if (pixels > MAX_PIXELS) {
    throw new MozjpegDimensionsTooLargeError(imageData.width, imageData.height, MAX_PIXELS);
  }

  return imageData;
}
