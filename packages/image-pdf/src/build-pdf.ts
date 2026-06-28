/**
 * Build a one-page PDF from an image: JPEG is embedded losslessly (DCTDecode),
 * everything else is supplied as raw RGBA pixels and embedded as a Flate-compressed
 * DeviceRGB image plus an optional DeviceGray alpha soft-mask.
 */

import { MAX_PIXELS } from './constants.ts';
import { deflate } from './deflate.ts';
import { PdfDimensionsTooLargeError, PdfUnsupportedSourceError } from './errors.ts';
import { parseJpegInfo } from './jpeg-info.ts';
import { assemblePdf } from './pdf-writer.ts';

export interface ImagePdfOptions {
  /** Override the maximum pixel count (default 25 MP). */
  readonly maxPixels?: number;
}

/**
 * Wrap a JPEG byte stream into a one-page PDF, embedding it byte-for-byte via the
 * PDF DCTDecode filter (no re-encoding, fully lossless).
 *
 * @throws {PdfDecodeError} if the bytes are not a parseable JPEG.
 * @throws {PdfUnsupportedSourceError} if the JPEG is not grayscale or RGB/YCbCr.
 * @throws {PdfDimensionsTooLargeError} if width × height exceeds the pixel cap.
 */
export function jpegToPdf(jpegBytes: Uint8Array, opts?: ImagePdfOptions): Uint8Array {
  const maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  const { width, height, components } = parseJpegInfo(jpegBytes);
  if (width * height > maxPixels) {
    throw new PdfDimensionsTooLargeError(width, height, maxPixels);
  }

  let colorSpace: 'DeviceRGB' | 'DeviceGray';
  if (components === 1) {
    colorSpace = 'DeviceGray';
  } else if (components === 3) {
    colorSpace = 'DeviceRGB';
  } else {
    throw new PdfUnsupportedSourceError(
      `JPEG has ${components} colour components; only grayscale (1) and RGB/YCbCr (3) are supported (CMYK is not).`,
    );
  }

  return assemblePdf({ width, height, colorSpace, filter: 'DCTDecode', data: jpegBytes });
}

/**
 * Wrap raw RGBA pixels into a one-page PDF. The RGB planes are Flate-compressed
 * as a DeviceRGB image; if any pixel is non-opaque, the alpha plane is attached
 * as a DeviceGray soft mask so transparency is preserved.
 *
 * @throws {PdfUnsupportedSourceError} if the ImageData byte length is inconsistent.
 * @throws {PdfDimensionsTooLargeError} if width × height exceeds the pixel cap.
 * @throws {PdfEncodeError} if CompressionStream is unavailable.
 */
export async function imageDataToPdf(
  image: ImageData,
  opts?: ImagePdfOptions,
): Promise<Uint8Array> {
  const maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  const { width, height } = image;
  if (width * height > maxPixels) {
    throw new PdfDimensionsTooLargeError(width, height, maxPixels);
  }

  const px = width * height;
  if (image.data.byteLength !== px * 4) {
    throw new PdfUnsupportedSourceError(
      `ImageData.data.byteLength (${String(image.data.byteLength)}) does not match ` +
        `width × height × 4 (${String(px * 4)}). The ImageData appears corrupted.`,
    );
  }

  const src = image.data;
  const rgb = new Uint8Array(px * 3);
  const alpha = new Uint8Array(px);
  let hasAlpha = false;
  for (let i = 0, j = 0; i < px; i++) {
    const s = i * 4;
    rgb[j++] = src[s] ?? 0;
    rgb[j++] = src[s + 1] ?? 0;
    rgb[j++] = src[s + 2] ?? 0;
    const a = src[s + 3] ?? 255;
    alpha[i] = a;
    if (a !== 255) hasAlpha = true;
  }

  const data = await deflate(rgb);
  const smask = hasAlpha ? await deflate(alpha) : undefined;
  return assemblePdf({
    width,
    height,
    colorSpace: 'DeviceRGB',
    filter: 'FlateDecode',
    data,
    smask,
  });
}
