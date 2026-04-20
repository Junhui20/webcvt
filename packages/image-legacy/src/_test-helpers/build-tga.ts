/**
 * Synthetic TGA fixture builder for @webcvt/image-legacy tests.
 *
 * Constructs minimal but spec-valid TGA byte sequences in memory.
 * NO binary fixtures are committed to disk — all test inputs are built here.
 *
 * Implements the 18-byte header, optional Image ID, optional Color Map,
 * raw or RLE pixel data, and optional TGA 2.0 footer.
 */

import { TGA_FOOTER_SIGNATURE, TGA_FOOTER_SIZE, TGA_HEADER_SIZE } from '../constants.ts';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type BuildTgaImageType = 1 | 2 | 3 | 9 | 10 | 11;
export type BuildTgaPixelDepth = 8 | 16 | 24 | 32;
export type BuildTgaOrigin = 0 | 1 | 2 | 3; // 0=BL,1=BR,2=TL,3=TR (bits 4-5)

export interface BuildTgaColorMap {
  firstEntryIndex: number;
  length: number;
  entrySize: 24 | 32;
  /**
   * BGR/BGRA on-disk bytes for entries [firstEntryIndex .. length).
   * Length must be (length - firstEntryIndex) * (entrySize/8) bytes.
   */
  onDiskBytes: Uint8Array;
}

export interface BuildTgaOptions {
  imageType: BuildTgaImageType;
  width: number;
  height: number;
  pixelDepth: BuildTgaPixelDepth;
  /** Origin bits 4-5 of byte 17. Default 2 (top-left). */
  originBits?: BuildTgaOrigin;
  /** Attribute bits 0-3 of byte 17. Default derived from pixelDepth. */
  attributeBits?: number;
  /** Reserved bits 6-7 of byte 17. Default 0. Set to test error path. */
  reservedBits?: number;
  /** Raw on-disk pixel bytes (BGR/BGRA for 24/32-bit, raw index for 8-bit). */
  pixelData: Uint8Array;
  /** Optional color map. Required if colorMapType=1. */
  colorMap?: BuildTgaColorMap;
  /** Image ID bytes (0..255 bytes). Default empty. */
  imageId?: Uint8Array;
  xOrigin?: number;
  yOrigin?: number;
  /** Whether to append a TGA 2.0 footer. Default true. */
  hasFooter?: boolean;
  /** Extension area bytes to embed. Default none. */
  extensionAreaBytes?: Uint8Array;
  /** Developer area bytes to embed. Default none. */
  developerAreaBytes?: Uint8Array;
}

/**
 * Build a raw TGA byte sequence from the given options.
 * All multi-byte fields written little-endian (Trap #1).
 */
export function buildTga(opts: BuildTgaOptions): Uint8Array {
  const imageId = opts.imageId ?? new Uint8Array(0);
  const hasFooter = opts.hasFooter ?? true;
  const originBits = opts.originBits ?? 2; // top-left
  const extBytes = opts.extensionAreaBytes ?? new Uint8Array(0);
  const devBytes = opts.developerAreaBytes ?? new Uint8Array(0);

  // Derive attributeBits from pixelDepth if not specified
  let attributeBits = opts.attributeBits;
  if (attributeBits === undefined) {
    if (opts.pixelDepth === 32) attributeBits = 8;
    else if (opts.pixelDepth === 16) attributeBits = 1;
    else attributeBits = 0;
  }

  const reservedBits = opts.reservedBits ?? 0;

  const hasColorMap = opts.colorMap !== undefined;
  const cm = opts.colorMap;

  // Color map on-disk bytes
  const cmOnDiskBytes = cm?.onDiskBytes ?? new Uint8Array(0);

  // Compute offsets
  const pixelDataOffset = TGA_HEADER_SIZE + imageId.length + cmOnDiskBytes.length;
  const pixelDataEnd = pixelDataOffset + opts.pixelData.length;

  const devAreaStart = pixelDataEnd;
  const extAreaStart = pixelDataEnd + devBytes.length;
  let devAreaOffset = 0;
  let extAreaOffset = 0;

  if (devBytes.length > 0) {
    devAreaOffset = devAreaStart;
  }
  if (extBytes.length > 0) {
    extAreaOffset = extAreaStart;
  }

  const footerSize = hasFooter ? TGA_FOOTER_SIZE : 0;
  const totalSize =
    TGA_HEADER_SIZE +
    imageId.length +
    cmOnDiskBytes.length +
    opts.pixelData.length +
    devBytes.length +
    extBytes.length +
    footerSize;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // Write 18-byte header
  out[0] = imageId.length;
  out[1] = hasColorMap ? 1 : 0;
  out[2] = opts.imageType;
  // Color map fields (uint16 LE — Trap #1)
  dv.setUint16(3, cm?.firstEntryIndex ?? 0, true);
  dv.setUint16(5, cm?.length ?? 0, true);
  out[7] = cm?.entrySize ?? 0;
  // Image spec (uint16 LE — Trap #1)
  dv.setUint16(8, opts.xOrigin ?? 0, true);
  dv.setUint16(10, opts.yOrigin ?? 0, true);
  dv.setUint16(12, opts.width, true);
  dv.setUint16(14, opts.height, true);
  out[16] = opts.pixelDepth;
  // Descriptor: bits 6-7 (reserved), bits 4-5 (origin), bits 0-3 (attributeBits)
  out[17] = ((reservedBits & 0x03) << 6) | ((originBits & 0x03) << 4) | (attributeBits & 0x0f);

  // Write image ID
  let offset = TGA_HEADER_SIZE;
  out.set(imageId, offset);
  offset += imageId.length;

  // Write color map
  out.set(cmOnDiskBytes, offset);
  offset += cmOnDiskBytes.length;

  // Write pixel data
  out.set(opts.pixelData, offset);
  offset += opts.pixelData.length;

  // Write developer area
  if (devBytes.length > 0) {
    out.set(devBytes, offset);
    offset += devBytes.length;
  }

  // Write extension area
  if (extBytes.length > 0) {
    out.set(extBytes, offset);
    offset += extBytes.length;
  }

  // Write TGA 2.0 footer
  if (hasFooter) {
    dv.setUint32(offset, extAreaOffset, true); // Trap #1: LE
    dv.setUint32(offset + 4, devAreaOffset, true); // Trap #1: LE
    out.set(TGA_FOOTER_SIGNATURE, offset + 8);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers for building on-disk BGR/BGRA pixel data
// ---------------------------------------------------------------------------

/** Build 24-bit BGR on-disk bytes from RGB triples. */
export function rgbToBgr(rgbPixels: Array<[number, number, number]>): Uint8Array {
  const out = new Uint8Array(rgbPixels.length * 3);
  for (let i = 0; i < rgbPixels.length; i++) {
    const px = rgbPixels[i];
    if (px === undefined) continue;
    out[i * 3] = px[2]; // B
    out[i * 3 + 1] = px[1]; // G
    out[i * 3 + 2] = px[0]; // R
  }
  return out;
}

/** Build 32-bit BGRA on-disk bytes from RGBA quads. */
export function rgbaToBgra(rgbaPixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(rgbaPixels.length * 4);
  for (let i = 0; i < rgbaPixels.length; i++) {
    const px = rgbaPixels[i];
    if (px === undefined) continue;
    out[i * 4] = px[2]; // B
    out[i * 4 + 1] = px[1]; // G
    out[i * 4 + 2] = px[0]; // R
    out[i * 4 + 3] = px[3]; // A
  }
  return out;
}

/**
 * Build 16-bit ARGB1555 LE on-disk bytes from RGBA8 quads.
 * Layout MSB→LSB: A | RRRRR | GGGGG | BBBBB (Trap #3).
 */
export function rgbaToArgb1555Le(rgbaPixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(rgbaPixels.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < rgbaPixels.length; i++) {
    const px = rgbaPixels[i];
    if (px === undefined) continue;
    const r5 = (px[0] >> 3) & 0x1f;
    const g5 = (px[1] >> 3) & 0x1f;
    const b5 = (px[2] >> 3) & 0x1f;
    const a1 = px[3] >= 128 ? 1 : 0;
    const word = (a1 << 15) | (r5 << 10) | (g5 << 5) | b5;
    dv.setUint16(i * 2, word, true); // LE (Trap #1)
  }
  return out;
}

/**
 * Build a simple TGA RLE stream for 8-bit grayscale.
 * Alternates REPEAT and RAW packets for testing.
 *
 * @param pixels Array of pixel values (grayscale 0-255)
 * @returns RLE-encoded byte stream
 */
export function buildRle8(pixels: number[]): Uint8Array {
  const chunks: number[] = [];
  let i = 0;
  while (i < pixels.length) {
    // Check for run
    let runLen = 1;
    while (runLen < 128 && i + runLen < pixels.length && pixels[i + runLen] === pixels[i]) {
      runLen++;
    }
    if (runLen > 1) {
      chunks.push(0x80 | (runLen - 1));
      chunks.push(pixels[i] ?? 0);
      i += runLen;
    } else {
      // RAW
      let rawLen = 1;
      while (
        rawLen < 128 &&
        i + rawLen < pixels.length &&
        pixels[i + rawLen] !== pixels[i + rawLen - 1]
      ) {
        rawLen++;
      }
      chunks.push(rawLen - 1);
      for (let r = 0; r < rawLen; r++) {
        chunks.push(pixels[i + r] ?? 0);
      }
      i += rawLen;
    }
  }
  return new Uint8Array(chunks);
}

/**
 * Build a TGA RLE stream for 24-bit BGR pixels.
 * Each pixel is [B, G, R] on disk.
 */
export function buildRle24(bgrPixels: Array<[number, number, number]>): Uint8Array {
  const chunks: number[] = [];
  let i = 0;
  while (i < bgrPixels.length) {
    let runLen = 1;
    while (
      runLen < 128 &&
      i + runLen < bgrPixels.length &&
      pixelEq24(bgrPixels[i], bgrPixels[i + runLen])
    ) {
      runLen++;
    }
    if (runLen > 1) {
      chunks.push(0x80 | (runLen - 1));
      const px = bgrPixels[i] ?? [0, 0, 0];
      chunks.push(px[0], px[1], px[2]);
      i += runLen;
    } else {
      let rawLen = 1;
      while (
        rawLen < 128 &&
        i + rawLen < bgrPixels.length &&
        !pixelEq24(bgrPixels[i + rawLen - 1], bgrPixels[i + rawLen])
      ) {
        rawLen++;
      }
      chunks.push(rawLen - 1);
      for (let r = 0; r < rawLen; r++) {
        const px = bgrPixels[i + r] ?? [0, 0, 0];
        chunks.push(px[0], px[1], px[2]);
      }
      i += rawLen;
    }
  }
  return new Uint8Array(chunks);
}

function pixelEq24(
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined,
): boolean {
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
