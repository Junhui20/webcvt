/**
 * Minimal clean-room PNG → PDF image embedder (no decoding, no dependencies).
 *
 * A PNG's IDAT payload is a zlib stream of scanlines, each prefixed with a
 * PNG filter-type byte (0–4). PDF's `FlateDecode` filter with
 * `/Predictor 15` (PNG "optimum") consumes *exactly* that layout, so an
 * opaque grayscale or truecolour PNG can be embedded losslessly by passing its
 * concatenated IDAT bytes straight through — no inflate/deflate round-trip and
 * therefore fully synchronous.
 *
 * Supported (the common comic-page subset): non-interlaced PNG, colour type 0
 * (grayscale) or 2 (truecolour RGB), bit depth 8 or 16. Everything else
 * (palette/indexed, any alpha channel, interlaced, exotic bit depths) needs a
 * real decode + alpha split, which a sync no-dependency writer cannot do, so it
 * is rejected with a typed error suggesting pre-transcoding.
 */

import { MAX_PIXELS, MAX_PNG_CHUNKS } from './constants.ts';
import {
  DocPdfDecodeError,
  DocPdfDimensionsTooLargeError,
  DocPdfUnsupportedSourceError,
} from './errors.ts';
import type { PreparedPageImage } from './pdf-writer.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Read a big-endian unsigned 32-bit integer at `off`. */
function readU32BE(bytes: Uint8Array, off: number): number {
  const b0 = bytes[off] ?? 0;
  const b1 = bytes[off + 1] ?? 0;
  const b2 = bytes[off + 2] ?? 0;
  const b3 = bytes[off + 3] ?? 0;
  return (b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3) >>> 0;
}

/** Decode a 4-byte ASCII chunk type (e.g. "IHDR", "IDAT"). */
function chunkType(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(
    bytes[off] ?? 0,
    bytes[off + 1] ?? 0,
    bytes[off + 2] ?? 0,
    bytes[off + 3] ?? 0,
  );
}

/** Returns true when `bytes` begins with the 8-byte PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Parse a PNG and produce a `PreparedPageImage` whose stream is the PNG's own
 * IDAT zlib data, embedded via FlateDecode with a PNG predictor.
 *
 * @throws {DocPdfDecodeError} on a malformed/truncated PNG.
 * @throws {DocPdfUnsupportedSourceError} for colour models this writer cannot embed.
 * @throws {DocPdfDimensionsTooLargeError} when width × height exceeds `maxPixels`.
 */
export function pngToPdfImage(
  bytes: Uint8Array,
  maxPixels: number = MAX_PIXELS,
): PreparedPageImage {
  if (!isPng(bytes)) {
    throw new DocPdfDecodeError('Not a PNG (missing 8-byte signature).');
  }

  // IHDR must be the first chunk: 4-byte length, "IHDR", 13-byte body, 4-byte CRC.
  let off = 8;
  if (off + 8 + 13 + 4 > bytes.length) {
    throw new DocPdfDecodeError('Truncated PNG: header chunk does not fit.');
  }
  const ihdrLen = readU32BE(bytes, off);
  off += 4;
  if (chunkType(bytes, off) !== 'IHDR' || ihdrLen !== 13) {
    throw new DocPdfDecodeError('Malformed PNG: first chunk is not a 13-byte IHDR.');
  }
  off += 4;

  const width = readU32BE(bytes, off);
  const height = readU32BE(bytes, off + 4);
  const bitDepth = bytes[off + 8] ?? 0;
  const colorType = bytes[off + 9] ?? 0;
  const compression = bytes[off + 10] ?? 0;
  const filterMethod = bytes[off + 11] ?? 0;
  const interlace = bytes[off + 12] ?? 0;
  off += 13 + 4; // body + CRC

  if (width === 0 || height === 0) {
    throw new DocPdfDecodeError('PNG reports zero width or height.');
  }
  if (width * height > maxPixels) {
    throw new DocPdfDimensionsTooLargeError(width, height, maxPixels);
  }
  if (compression !== 0 || filterMethod !== 0) {
    throw new DocPdfDecodeError(
      `PNG uses non-standard compression/filter method (${compression}/${filterMethod}); only method 0 is defined.`,
    );
  }
  if (interlace !== 0) {
    throw new DocPdfUnsupportedSourceError(
      'Interlaced (Adam7) PNG is not supported; re-save without interlacing or transcode to JPEG.',
    );
  }
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new DocPdfUnsupportedSourceError(
      `PNG bit depth ${bitDepth} is not supported; only 8 and 16 bits per component can be embedded directly.`,
    );
  }

  let colorSpace: 'DeviceRGB' | 'DeviceGray';
  let colors: number;
  if (colorType === 0) {
    colorSpace = 'DeviceGray';
    colors = 1;
  } else if (colorType === 2) {
    colorSpace = 'DeviceRGB';
    colors = 3;
  } else {
    throw new DocPdfUnsupportedSourceError(
      `PNG colour type ${colorType} (palette/indexed or with an alpha channel) cannot be embedded directly; flatten transparency / expand the palette (e.g. via a canvas) or transcode to JPEG first.`,
    );
  }

  // Concatenate every IDAT chunk in order — that is the FlateDecode stream.
  const idatParts: Uint8Array[] = [];
  let idatLen = 0;
  let chunks = 0;
  let sawIend = false;
  while (off + 8 <= bytes.length) {
    if (++chunks > MAX_PNG_CHUNKS) {
      throw new DocPdfDecodeError(`PNG exceeds the ${MAX_PNG_CHUNKS}-chunk cap.`);
    }
    const len = readU32BE(bytes, off);
    const type = chunkType(bytes, off + 4);
    const dataStart = off + 8;
    if (dataStart + len + 4 > bytes.length) {
      if (type === 'IEND') {
        sawIend = true;
        break;
      }
      throw new DocPdfDecodeError(`Truncated PNG chunk "${type}".`);
    }
    if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataStart + len));
      idatLen += len;
    }
    off = dataStart + len + 4; // skip data + CRC
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }

  if (idatLen === 0) {
    throw new DocPdfDecodeError('PNG contains no IDAT image data.');
  }
  // sawIend is informational; a missing IEND on otherwise-complete IDAT is tolerated.
  void sawIend;

  const data = concat(idatParts, idatLen);
  const decodeParms = `<< /Predictor 15 /Colors ${colors} /BitsPerComponent ${bitDepth} /Columns ${width} >>`;

  return {
    width,
    height,
    colorSpace,
    bitsPerComponent: bitDepth,
    filter: 'FlateDecode',
    data,
    decodeParms,
  };
}

/** Concatenate byte parts into one buffer of the given total length. */
function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
