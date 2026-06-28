/**
 * HEIC/HEIF decode for @catlabtech/webcvt-image-heic.
 *
 * Validates input bounds, decodes the first image via libheif, checks decoded
 * dimensions against MAX_PIXELS, renders to RGBA, and frees the wasm image memory.
 */

import { MAX_INPUT_BYTES, MAX_PIXELS } from './constants.ts';
import { HeicDecodeError, HeicDimensionsTooLargeError, HeicInputTooLargeError } from './errors.ts';
import type { HeifImage } from './loader.ts';
import { ensureLoaded } from './loader.ts';

/**
 * Decode a HEIC/HEIF byte stream to ImageData (first image only).
 *
 * @param bytes - HEIC/HEIF data as Uint8Array or ArrayBuffer.
 * @returns Decoded pixel data as ImageData (RGBA, 8-bit).
 * @throws {HeicInputTooLargeError} if input exceeds MAX_INPUT_BYTES.
 * @throws {HeicLoadError} if libheif-js fails to load.
 * @throws {HeicDecodeError} if the input is not a decodable HEIF/HEIC file.
 * @throws {HeicDimensionsTooLargeError} if the decoded image exceeds MAX_PIXELS.
 */
export async function decodeHeic(bytes: Uint8Array | ArrayBuffer): Promise<ImageData> {
  const byteLength = bytes.byteLength;
  if (byteLength > MAX_INPUT_BYTES) {
    throw new HeicInputTooLargeError(byteLength, MAX_INPUT_BYTES);
  }

  const lib = await ensureLoaded();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  let images: HeifImage[];
  try {
    images = new lib.HeifDecoder().decode(u8);
  } catch (err) {
    throw new HeicDecodeError('HEIC decode failed — see error.cause for details.', { cause: err });
  }

  // libheif returns an empty array for unparseable input (it does not throw).
  if (!images || images.length === 0) {
    throw new HeicDecodeError('Not a valid HEIF/HEIC file (libheif decoded no images).');
  }
  const image = images[0];
  if (!image) {
    throw new HeicDecodeError('HEIC decoded image handle is missing.');
  }

  try {
    const width = image.get_width();
    const height = image.get_height();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new HeicDecodeError('HEIC reports invalid dimensions.');
    }
    if (width * height > MAX_PIXELS) {
      throw new HeicDimensionsTooLargeError(width, height, MAX_PIXELS);
    }

    const target = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;

    return await new Promise<ImageData>((resolve, reject) => {
      try {
        image.display(target, (filled) => {
          if (filled == null) {
            reject(new HeicDecodeError('libheif failed to render the HEIC pixels.'));
          } else {
            resolve(filled as unknown as ImageData);
          }
        });
      } catch (err) {
        reject(
          new HeicDecodeError('HEIC pixel render threw — see error.cause for details.', {
            cause: err,
          }),
        );
      }
    });
  } finally {
    // Release all wasm-backed image handles (the pixels are already copied into JS).
    for (const img of images) {
      img.free?.();
    }
  }
}
