/**
 * imagesToPdf — the core deliverable: wrap an ordered list of images into a
 * single multi-page PDF, one page per image, each page sized to its image.
 *
 * - JPEG sources are embedded byte-for-byte via DCTDecode (lossless).
 * - PNG sources are embedded losslessly via FlateDecode + a PNG predictor
 *   (see png-image.ts).
 *
 * The function is synchronous and dependency-free: it never touches a canvas or
 * CompressionStream, which is what lets it run unchanged in Node, a worker, or
 * the main thread — and exactly what a cbz→PDF batch needs. Source formats that
 * would require an async pixel decode (WebP, GIF, BMP, RGBA/indexed PNG, …) are
 * out of scope here; transcode them to JPEG or opaque RGB/grayscale PNG first.
 *
 * JPEG header parsing is delegated to @catlabtech/webcvt-image-pdf's
 * `parseJpegInfo` (reused, not re-implemented).
 */

import { parseJpegInfo } from '@catlabtech/webcvt-image-pdf';
import {
  DEFAULT_PRODUCER,
  JPEG_MIME,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  MAX_PIXELS,
  PNG_MIME,
} from './constants.ts';
import {
  DocPdfDecodeError,
  DocPdfDimensionsTooLargeError,
  DocPdfInputTooLargeError,
  DocPdfNoImagesError,
  DocPdfTooManyPagesError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';
import { type PreparedPageImage, writeMultiPagePdf } from './pdf-writer.ts';
import { isPng, pngToPdfImage } from './png-image.ts';

/** One source image: raw encoded bytes plus its MIME type (best-effort hint). */
export interface ImageInput {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** Options for {@link imagesToPdf}. All caps default to the package constants. */
export interface ImagesToPdfOptions {
  /** Override the per-image pixel cap (default 25 MP). */
  readonly maxPixels?: number;
  /** Override the page-count cap (default 10 000). */
  readonly maxPages?: number;
  /** Override the cumulative input-bytes cap (default 256 MiB). */
  readonly maxInputBytes?: number;
  /** `/Producer` string recorded in the PDF Info dictionary. */
  readonly producer?: string;
}

/** Returns true when `bytes` begins with the JPEG SOI marker (FF D8). */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Parse a JPEG header and produce a DCTDecode `PreparedPageImage`.
 *
 * @throws {DocPdfDecodeError} if the bytes are not a parseable JPEG.
 * @throws {DocPdfUnsupportedSourceError} for CMYK (4-component) JPEG.
 * @throws {DocPdfDimensionsTooLargeError} when the pixel cap is exceeded.
 */
function jpegToPdfImage(bytes: Uint8Array, maxPixels: number): PreparedPageImage {
  let info: { width: number; height: number; components: number };
  try {
    info = parseJpegInfo(bytes);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new DocPdfDecodeError(`Invalid JPEG: ${message}`, { cause });
  }

  const { width, height, components } = info;
  if (width * height > maxPixels) {
    throw new DocPdfDimensionsTooLargeError(width, height, maxPixels);
  }

  let colorSpace: 'DeviceRGB' | 'DeviceGray';
  if (components === 1) {
    colorSpace = 'DeviceGray';
  } else if (components === 3) {
    colorSpace = 'DeviceRGB';
  } else {
    throw new DocPdfUnsupportedSourceError(
      `JPEG has ${components} colour components; only grayscale (1) and RGB/YCbCr (3) are supported (CMYK is not).`,
    );
  }

  return { width, height, colorSpace, bitsPerComponent: 8, filter: 'DCTDecode', data: bytes };
}

/**
 * Reduce one source image to a `PreparedPageImage`, dispatching on the content
 * signature first (more trustworthy than the MIME hint) and the MIME second.
 */
function prepareImage(bytes: Uint8Array, mime: string, maxPixels: number): PreparedPageImage {
  if (isJpeg(bytes) || mime === JPEG_MIME) {
    return jpegToPdfImage(bytes, maxPixels);
  }
  if (isPng(bytes) || mime === PNG_MIME) {
    return pngToPdfImage(bytes, maxPixels);
  }
  throw new DocPdfUnsupportedSourceError(
    `Unsupported image type "${mime || 'unknown'}". imagesToPdf embeds JPEG (DCTDecode) and opaque grayscale/RGB PNG (FlateDecode) only; transcode WebP, GIF, BMP, or alpha/indexed PNG first.`,
  );
}

/**
 * Wrap `images` into a single multi-page PDF (one page per image, in order).
 *
 * @throws {DocPdfNoImagesError} when `images` is empty.
 * @throws {DocPdfTooManyPagesError} when `images.length` exceeds the page cap.
 * @throws {DocPdfInputTooLargeError} when the cumulative byte size exceeds the cap.
 * @throws {DocPdfDecodeError | DocPdfUnsupportedSourceError | DocPdfDimensionsTooLargeError}
 *         for an individual image that cannot be embedded.
 */
export function imagesToPdf(images: readonly ImageInput[], opts?: ImagesToPdfOptions): Uint8Array {
  const maxPixels = opts?.maxPixels ?? MAX_PIXELS;
  const maxPages = opts?.maxPages ?? MAX_PAGES;
  const maxInputBytes = opts?.maxInputBytes ?? MAX_INPUT_BYTES;
  const producer = opts?.producer ?? DEFAULT_PRODUCER;

  if (images.length === 0) {
    throw new DocPdfNoImagesError();
  }
  if (images.length > maxPages) {
    throw new DocPdfTooManyPagesError(images.length, maxPages);
  }

  let total = 0;
  const prepared: PreparedPageImage[] = [];
  for (const image of images) {
    total += image.bytes.length;
    if (total > maxInputBytes) {
      throw new DocPdfInputTooLargeError(total, maxInputBytes);
    }
    prepared.push(prepareImage(image.bytes, image.mime, maxPixels));
  }

  return writeMultiPagePdf(prepared, producer);
}
