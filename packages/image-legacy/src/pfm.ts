/**
 * PFM (Portable Float Map) parser/serializer.
 *
 * Key implementation notes:
 *   Trap §4: scale sign → endianness; scale === 0 rejected with PfmBadScaleError.
 *   Trap §5: PFM stores rows BOTTOM-UP; we flip to top-down on parse, flip back on serialize.
 *   TextEncoder hoisted at module scope.
 */

import { MAX_DIM, MAX_INPUT_BYTES, MAX_PIXELS, MAX_PIXEL_BYTES } from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  PfmBadMagicError,
  PfmBadScaleError,
} from './errors.ts';
import { readNetpbmHeader } from './netpbm.ts';

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export interface PfmFile {
  format: 'pfm';
  width: number;
  height: number;
  channels: 1 | 3;
  bitDepth: 32;
  endianness: 'big' | 'little';
  /** Absolute value of the scale token; preserved for round-trip. */
  scaleAbs: number;
  /** Row-major TOP-DOWN floats (parser flipped on read). */
  pixelData: Float32Array;
}

// ---------------------------------------------------------------------------
// Module-scope TextEncoder (hoisted — Lesson 2)
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// PFM parser
// ---------------------------------------------------------------------------

export function parsePfm(input: Uint8Array): PfmFile {
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  // PFM header: magic, width, height, scale (signed float)
  const header = readNetpbmHeader(input, true);
  const { magic, width, height, thirdToken, headerEndOffset } = header;

  if (magic !== 'Pf' && magic !== 'PF') throw new PfmBadMagicError(magic);

  const channels: 1 | 3 = magic === 'PF' ? 3 : 1;

  // Parse scale — Trap §4
  const scaleRaw = Number(thirdToken ?? '');
  if (!Number.isFinite(scaleRaw) || scaleRaw === 0) {
    throw new PfmBadScaleError(thirdToken ?? '');
  }

  const endianness: 'big' | 'little' = scaleRaw < 0 ? 'little' : 'big';
  const scaleAbs = Math.abs(scaleRaw);

  // Validate dimensions before allocation — Trap §10
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `PFM: dimensions ${width}×${height} out of range [1, ${MAX_DIM}].`,
    );
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `PFM: pixel count ${pixelCount} exceeds MAX_PIXELS ${MAX_PIXELS}.`,
    );
  }
  const pixelBytes = pixelCount * channels * 4;
  if (pixelBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `PFM: pixel byte count ${pixelBytes} exceeds MAX_PIXEL_BYTES ${MAX_PIXEL_BYTES}.`,
    );
  }

  // Sec-H-1: validate input has enough bytes for the declared raster BEFORE
  // allocation + DataView reads. Without this, a truncated PFM throws an
  // untyped RangeError from DataView, violating the typed-error contract.
  const availableBytes = input.length - headerEndOffset;
  if (availableBytes < pixelBytes) {
    throw new ImagePixelCapError(
      `PFM: declared raster requires ${pixelBytes} bytes but only ${availableBytes} bytes remain after header.`,
    );
  }

  const pixelData = new Float32Array(pixelCount * channels);
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const littleEndian = endianness === 'little';

  // Trap §5: rows are bottom-up on disk. srcRow 0 = bottom row of image.
  // We map srcRow → dstRow = height - 1 - srcRow.
  for (let srcRow = 0; srcRow < height; srcRow++) {
    const dstRow = height - 1 - srcRow;
    for (let c = 0; c < width; c++) {
      for (let k = 0; k < channels; k++) {
        const off = headerEndOffset + (srcRow * width + c) * channels * 4 + k * 4;
        const value = dv.getFloat32(off, littleEndian);
        pixelData[(dstRow * width + c) * channels + k] = value;
      }
    }
  }

  return { format: 'pfm', width, height, channels, bitDepth: 32, endianness, scaleAbs, pixelData };
}

// ---------------------------------------------------------------------------
// PFM serializer
// ---------------------------------------------------------------------------

export function serializePfm(file: PfmFile): Uint8Array {
  const { width, height, channels, endianness, scaleAbs, pixelData } = file;

  const magic = channels === 3 ? 'PF' : 'Pf';
  const signedScale = endianness === 'little' ? -scaleAbs : scaleAbs;

  // Format scale as minimal decimal: avoid trailing zeros (e.g. "1" not "1.000000")
  const scaleStr = formatScale(signedScale);

  const headerStr = `${magic}\n${width} ${height}\n${scaleStr}\n`;
  const header = TEXT_ENCODER.encode(headerStr);

  const bodyBytes = width * height * channels * 4;
  const body = new Uint8Array(bodyBytes);
  const dv = new DataView(body.buffer);
  const littleEndian = endianness === 'little';

  // Trap §5 inverse: in-memory is top-down (dstRow), write bottom-up (srcRow on disk).
  for (let dstRow = 0; dstRow < height; dstRow++) {
    const srcRow = height - 1 - dstRow; // disk row index
    for (let c = 0; c < width; c++) {
      for (let k = 0; k < channels; k++) {
        const memIdx = (dstRow * width + c) * channels + k;
        const off = (srcRow * width + c) * channels * 4 + k * 4;
        dv.setFloat32(off, pixelData[memIdx] ?? 0, littleEndian);
      }
    }
  }

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

// ---------------------------------------------------------------------------
// Scale formatter: minimal decimal representation
// ---------------------------------------------------------------------------

function formatScale(value: number): string {
  // Use toPrecision to avoid excess trailing zeros, then strip them.
  // e.g. -1.0 → '-1', 1.5 → '1.5', -2.25 → '-2.25'
  const s = value.toString();
  return s;
}
