/**
 * Synthetic PCX fixture builder for @catlabtech/webcvt-image-legacy tests.
 *
 * Constructs minimal but spec-valid PCX byte sequences in memory.
 * NO binary fixtures are committed to disk — all test inputs are built here.
 *
 * Implements the 128-byte header, per-scanline RLE pixel data, and optional
 * 769-byte VGA palette footer (0x0C sentinel + 768 RGB bytes).
 *
 * All multi-byte fields written little-endian (Trap #1).
 */

import {
  PCX_EGA_PALETTE_SIZE,
  PCX_ENCODING_RLE,
  PCX_HEADER_SIZE,
  PCX_MAGIC,
  PCX_MAX_RUN,
  PCX_PALETTE_FOOTER_SIZE,
  PCX_PALETTE_SENTINEL,
  PCX_VGA_PALETTE_SIZE,
} from '../constants.ts';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BuildPcxOptions {
  version?: number; // default 5
  encoding?: number; // default 1 (RLE); set to 0 to test error path
  bitsPerPixel?: number; // default 8
  xMin?: number; // default 0
  yMin?: number; // default 0
  xMax: number; // required: width = xMax - xMin + 1
  yMax: number; // required: height = yMax - yMin + 1
  hDpi?: number; // default 96
  vDpi?: number; // default 96
  /** 48 EGA palette bytes; default all-zero. */
  egaPalette?: Uint8Array;
  reservedByte64?: number; // default 0
  nPlanes?: number; // default 1
  bytesPerLine?: number; // default auto-computed (even minimum)
  paletteInfo?: number; // default 1
  hScreenSize?: number; // default 0
  vScreenSize?: number; // default 0
  /** 54 reserved bytes at offsets 74-127; default all-zero. */
  reserved54?: Uint8Array;
  /**
   * Pre-encoded RLE body bytes (already RLE-compressed, planar if needed).
   * If omitted, `rawPixelPlanes` is used to auto-encode.
   */
  rleBody?: Uint8Array;
  /**
   * Raw un-encoded pixel planes, indexed as [scanline][plane][byteIndex].
   * Auto-RLE-encoded when `rleBody` is not given.
   * For NPlanes=1 just use [[plane0bytes], [plane0bytes], ...] per scanline.
   */
  rawPixelPlanes?: Uint8Array[][];
  /** 768-byte VGA palette data (RGB triplets); triggers 769-byte footer. */
  vgaPalette?: Uint8Array;
  /** manufacturer byte; default 0x0A. Set to something else to test errors. */
  manufacturer?: number;
}

/**
 * Build a raw PCX byte sequence from the given options.
 * All multi-byte fields written little-endian (Trap #1).
 */
export function buildPcx(opts: BuildPcxOptions): Uint8Array {
  const version = opts.version ?? 5;
  const encoding = opts.encoding ?? PCX_ENCODING_RLE;
  const bitsPerPixel = opts.bitsPerPixel ?? 8;
  const xMin = opts.xMin ?? 0;
  const yMin = opts.yMin ?? 0;
  const hDpi = opts.hDpi ?? 96;
  const vDpi = opts.vDpi ?? 96;
  const nPlanes = opts.nPlanes ?? 1;
  const paletteInfo = opts.paletteInfo ?? 1;
  const hScreenSize = opts.hScreenSize ?? 0;
  const vScreenSize = opts.vScreenSize ?? 0;
  const manufacturer = opts.manufacturer ?? PCX_MAGIC;

  const width = opts.xMax - xMin + 1;
  const minBpl = Math.ceil((width * bitsPerPixel) / 8);
  const bytesPerLine = opts.bytesPerLine ?? (minBpl % 2 === 0 ? minBpl : minBpl + 1);

  const egaPalette = opts.egaPalette ?? new Uint8Array(PCX_EGA_PALETTE_SIZE);
  const reserved54 = opts.reserved54 ?? new Uint8Array(54);
  const reservedByte64 = opts.reservedByte64 ?? 0;

  // Build or use provided RLE body
  let rleBody: Uint8Array;
  if (opts.rleBody !== undefined) {
    rleBody = opts.rleBody;
  } else if (opts.rawPixelPlanes !== undefined) {
    rleBody = encodePlanarRle(opts.rawPixelPlanes, bytesPerLine);
  } else {
    // Default: encode empty scanlines (all zeros)
    const height = opts.yMax - yMin + 1;
    rleBody = buildDefaultRleBody(height, nPlanes, bytesPerLine);
  }

  const hasVgaPalette = opts.vgaPalette !== undefined;
  const footerSize = hasVgaPalette ? PCX_PALETTE_FOOTER_SIZE : 0;
  const totalSize = PCX_HEADER_SIZE + rleBody.length + footerSize;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // Write 128-byte header
  dv.setUint8(0, manufacturer);
  dv.setUint8(1, version);
  dv.setUint8(2, encoding);
  dv.setUint8(3, bitsPerPixel);
  dv.setUint16(4, xMin, true); // Trap #1: LE
  dv.setUint16(6, yMin, true);
  dv.setUint16(8, opts.xMax, true);
  dv.setUint16(10, opts.yMax, true);
  dv.setUint16(12, hDpi, true);
  dv.setUint16(14, vDpi, true);
  out.set(egaPalette.subarray(0, PCX_EGA_PALETTE_SIZE), 16);
  dv.setUint8(64, reservedByte64);
  dv.setUint8(65, nPlanes);
  dv.setUint16(66, bytesPerLine, true); // Trap #1: LE
  dv.setUint16(68, paletteInfo, true);
  dv.setUint16(70, hScreenSize, true);
  dv.setUint16(72, vScreenSize, true);
  out.set(reserved54.subarray(0, 54), 74);

  // Write RLE body
  out.set(rleBody, PCX_HEADER_SIZE);

  // Write optional VGA palette footer
  if (hasVgaPalette && opts.vgaPalette !== undefined) {
    const footerOffset = PCX_HEADER_SIZE + rleBody.length;
    dv.setUint8(footerOffset, PCX_PALETTE_SENTINEL);
    out.set(opts.vgaPalette.subarray(0, PCX_VGA_PALETTE_SIZE), footerOffset + 1);
  }

  return out;
}

// ---------------------------------------------------------------------------
// RLE encoder for test fixture construction
// ---------------------------------------------------------------------------

/**
 * Encode planar scanline data into a PCX RLE body.
 * rawPixelPlanes[scanline][plane] = bytesPerLine bytes of raw plane data.
 */
export function encodePlanarRle(scanlinePlanes: Uint8Array[][], bytesPerLine: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const planes of scanlinePlanes) {
    for (const plane of planes) {
      const padded = new Uint8Array(bytesPerLine);
      padded.set(plane.subarray(0, Math.min(plane.length, bytesPerLine)));
      chunks.push(encodeScanlineRle(padded));
    }
  }
  return concatArrays(chunks);
}

/**
 * RLE-encode a single sequence of bytes (one plane of one scanline).
 * Trap #5: bytes ≥ 0xC0 must always be wrapped as RUN even when count=1.
 */
export function encodeScanlineRle(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const val = bytes[i] ?? 0;
    let runLen = 1;
    while (runLen < PCX_MAX_RUN && i + runLen < bytes.length && (bytes[i + runLen] ?? 0) === val) {
      runLen++;
    }
    if (runLen > 1 || val >= 0xc0) {
      // Trap #5: RUN form
      out.push(0xc0 | runLen, val);
      i += runLen;
    } else {
      out.push(val);
      i++;
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Helpers for building specific pixel formats
// ---------------------------------------------------------------------------

/**
 * Build raw 8-bit plane bytes for a single scanline.
 * pixels: array of pixel values (0-255), length = width.
 * bytesPerLine may be > width (padding with zeros).
 */
export function buildGray8Scanline(pixels: number[], bytesPerLine: number): Uint8Array {
  const out = new Uint8Array(bytesPerLine);
  for (let i = 0; i < Math.min(pixels.length, bytesPerLine); i++) {
    out[i] = pixels[i] ?? 0;
  }
  return out;
}

/**
 * Build planar scanlines for a 24-bit truecolor image.
 * rgbRows: height × width array of [R,G,B] triples.
 * Returns rawPixelPlanes in the format expected by buildPcx().
 */
export function buildTruecolorPlanes(
  rgbRows: Array<Array<[number, number, number]>>,
  bytesPerLine: number,
): Uint8Array[][] {
  return rgbRows.map((row) => {
    const rPlane = new Uint8Array(bytesPerLine);
    const gPlane = new Uint8Array(bytesPerLine);
    const bPlane = new Uint8Array(bytesPerLine);
    for (let x = 0; x < Math.min(row.length, bytesPerLine); x++) {
      const px = row[x] ?? [0, 0, 0];
      rPlane[x] = px[0];
      gPlane[x] = px[1];
      bPlane[x] = px[2];
    }
    return [rPlane, gPlane, bPlane];
  });
}

/**
 * Build raw 1-bit bilevel plane bytes for a single scanline.
 * pixels: array of 0/1 values, length = width.
 * MSB of each byte is the leftmost pixel (bit 7 = pixel 0).
 */
export function build1BitScanline(pixels: number[], bytesPerLine: number): Uint8Array {
  const out = new Uint8Array(bytesPerLine);
  for (let x = 0; x < pixels.length; x++) {
    const byteIdx = Math.floor(x / 8);
    const bitIdx = 7 - (x % 8);
    out[byteIdx] = (out[byteIdx] ?? 0) | (((pixels[x] ?? 0) & 1) << bitIdx);
  }
  return out;
}

/**
 * Build raw 4-bit EGA-packed plane bytes for a single scanline.
 * pixels: array of 0–15 values, length = width.
 * High nibble = even pixel, low nibble = odd pixel.
 */
export function build4BitPackedScanline(pixels: number[], bytesPerLine: number): Uint8Array {
  const out = new Uint8Array(bytesPerLine);
  for (let x = 0; x < pixels.length; x++) {
    const byteIdx = Math.floor(x / 2);
    const val = (pixels[x] ?? 0) & 0x0f;
    if (x % 2 === 0) {
      out[byteIdx] = (out[byteIdx] ?? 0) | (val << 4);
    } else {
      out[byteIdx] = (out[byteIdx] ?? 0) | val;
    }
  }
  return out;
}

/**
 * Build raw 4-bit EGA-planar scanline (4 planes × bytesPerLine each).
 * pixels: array of 0–15 EGA index values, length = width.
 * Returns 4 planes as [plane0, plane1, plane2, plane3].
 */
export function build4BitPlanarScanline(pixels: number[], bytesPerLine: number): Uint8Array[] {
  const planes = [
    new Uint8Array(bytesPerLine),
    new Uint8Array(bytesPerLine),
    new Uint8Array(bytesPerLine),
    new Uint8Array(bytesPerLine),
  ] as const;
  for (let x = 0; x < pixels.length; x++) {
    const idx = pixels[x] ?? 0;
    const byteIdx = Math.floor(x / 8);
    const bitIdx = 7 - (x % 8);
    for (let p = 0; p < 4; p++) {
      const bit = (idx >> p) & 1;
      const plane = planes[p] as Uint8Array;
      plane[byteIdx] = (plane[byteIdx] ?? 0) | (bit << bitIdx);
    }
  }
  return [...planes];
}

/**
 * Build a default all-zero RLE body for height × nPlanes × bytesPerLine raw bytes.
 * Each plane is encoded as repeated RUN(63, 0) packets + remainder.
 */
function buildDefaultRleBody(height: number, nPlanes: number, bytesPerLine: number): Uint8Array {
  const zeroScanline = new Uint8Array(bytesPerLine); // all-zero
  const encodedScanline = encodeScanlineRle(zeroScanline);
  const totalPlanes = height * nPlanes;
  const out = new Uint8Array(encodedScanline.length * totalPlanes);
  for (let i = 0; i < totalPlanes; i++) {
    out.set(encodedScanline, i * encodedScanline.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal concat helper
// ---------------------------------------------------------------------------

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
