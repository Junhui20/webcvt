/**
 * TGA (Truevision Targa) parser and serializer for @webcvt/image-legacy.
 *
 * Implements Truevision TGA File Format Specification Version 2.0 (1989).
 * Clean-room implementation per plan.md §11 — no reference implementations consulted.
 *
 * All 15 traps from the design note are handled (see inline Trap #N comments).
 *
 * Trap list summary:
 *   #1  All multi-byte ints little-endian — use DataView.getUint16/32(off, true)
 *   #2  BGR/BGRA on disk → RGB/RGBA in memory (swap both ways)
 *   #3  16-bit = 5/5/5/1 ARGB1555; expand with (c5 << 3) | (c5 >> 2)
 *   #4  Origin bits 4-5 of byte 17; BL is legacy default; normalise to TL on parse
 *   #5  TGA 1.0 has NO magic; detection: footer-first, then header heuristic
 *   #6  Footer signature exactly 18 bytes: TRUEVISION-XFILE.\0
 *   #7  RLE packet 0x00 = 1-pixel RAW (not a no-op; differs from PackBits)
 *   #8  colorMapStart ≠ 0; on-disk map is only (length - start) entries; zero-fill prefix
 *   #9  (imageType, pixelDepth) legal pair enforcement
 *   #10 attributeBits must be consistent with pixel depth
 *   #11 RLE packets MAY cross scanline boundaries; treat full raster as one stream
 *   #12 RLE cap is by absolute output size (pre-allocated buffer), not ratio
 *   #13 Reserved bits 6-7 of byte 17 MUST be zero
 *   #14 Image ID length 0 = no ID block; color map starts at offset 18
 *   #15 Color map data is also BGR/BGRA — swap on parse and serialize
 */

import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  MAX_PIXEL_BYTES,
  TGA_FOOTER_SIGNATURE,
  TGA_FOOTER_SIZE,
  TGA_HEADER_SIZE,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  TgaBadFooterError,
  TgaBadHeaderError,
  TgaNoImageDataError,
  TgaRleDecodeError,
  TgaTruncatedError,
  TgaUnsupportedFeatureError,
  TgaUnsupportedImageTypeError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TgaImageType = 1 | 2 | 3 | 9 | 10 | 11;
export type TgaPixelDepth = 8 | 16 | 24 | 32;
export type TgaOrigin = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type TgaColorMapEntrySize = 24 | 32;

export interface TgaColorMap {
  firstEntryIndex: number;
  length: number;
  entrySize: TgaColorMapEntrySize;
  /**
   * Decoded RGB or RGBA, NOT BGR/BGRA.
   * Prefix [0, firstEntryIndex) is zero-filled (Trap #8).
   */
  paletteData: Uint8Array;
}

export type TgaNormalisation =
  | 'origin-normalised-to-top-left'
  | 'rle-decoded-on-parse'
  | 'tga-1-promoted-to-tga-2-on-serialize';

export interface TgaFile {
  format: 'tga';
  imageType: TgaImageType;
  width: number;
  height: number;
  /** Channels in the decoded pixelData (RGB=3, RGBA=4, grayscale=1). */
  channels: 1 | 3 | 4;
  /** Always 8 in the decoded pixelData (values 0-255 per channel). */
  bitDepth: 8;
  /** Original on-disk pixel depth (8, 16, 24, or 32 bits). */
  originalPixelDepth: TgaPixelDepth;
  /** Original image origin from the header before normalisation. */
  originalOrigin: TgaOrigin;
  /** Top-left row-major, RGB/RGBA/grayscale interleaved. */
  pixelData: Uint8Array;
  colorMap: TgaColorMap | null;
  /** Image ID bytes (0..255 bytes, may be empty). Trap #14. */
  imageId: Uint8Array;
  xOrigin: number;
  yOrigin: number;
  /** Attribute bits from byte 17 bits 0-3. Valid values: 0, 1, 8. */
  attributeBits: 0 | 1 | 8;
  /** True if the TGA 2.0 footer was detected. */
  hasFooter: boolean;
  /** Extension Area bytes (opaque). Null if absent. */
  extensionAreaBytes: Uint8Array | null;
  /** Developer Area bytes (opaque). Null if absent. */
  developerAreaBytes: Uint8Array | null;
  /** Lossy normalisation flags applied during parse. */
  normalisations: TgaNormalisation[];
}

// ---------------------------------------------------------------------------
// Legal (imageType, pixelDepth) pairs — Trap #9
// ---------------------------------------------------------------------------

const LEGAL_PAIRS: ReadonlyMap<TgaImageType, ReadonlySet<number>> = new Map([
  [1, new Set([8])], // cmap: 8-bit index
  [2, new Set([16, 24, 32])], // truecolor: 16/24/32-bit
  [3, new Set([8])], // grayscale: 8-bit
  [9, new Set([8])], // RLE cmap
  [10, new Set([16, 24, 32])], // RLE truecolor
  [11, new Set([8])], // RLE grayscale
]);

function isLegalPair(imageType: TgaImageType, pixelDepth: number): boolean {
  return LEGAL_PAIRS.get(imageType)?.has(pixelDepth) === true;
}

// ---------------------------------------------------------------------------
// Channels per image type (after decode, in output pixelData)
// ---------------------------------------------------------------------------

function channelsForType(imageType: TgaImageType, pixelDepth: TgaPixelDepth): 1 | 3 | 4 {
  // Type 1/9 (cmap): index pixel, palette provides RGB or RGBA
  // For index pixels we store raw indices (1 channel) when returning raw.
  // But per the design: channels is 1 for grayscale/cmap, 3 for truecolor 24-bit, 4 for 32-bit
  if (imageType === 1 || imageType === 9) return 1; // palette index
  if (imageType === 3 || imageType === 11) return 1; // grayscale
  // imageType 2 or 10: truecolor
  if (pixelDepth === 32) return 4;
  if (pixelDepth === 16) return 4; // 16-bit expands to RGBA (with 1-bit alpha)
  return 3; // 24-bit → RGB
}

// ---------------------------------------------------------------------------
// Origin decode — Trap #4
// ---------------------------------------------------------------------------

function decodeOriginBits(bits: number): TgaOrigin {
  switch (bits & 0x03) {
    case 0:
      return 'bottom-left';
    case 1:
      return 'bottom-right';
    case 2:
      return 'top-left';
    default:
      return 'top-right';
  }
}

// ---------------------------------------------------------------------------
// BGR ↔ RGB swap — Trap #2
// ---------------------------------------------------------------------------

/** Swap BGR → RGB in-place for a 3-channel (24-bit) buffer. */
function swapBgrToRgb(buf: Uint8Array): void {
  for (let i = 0; i + 2 < buf.length; i += 3) {
    // bounds guaranteed by loop condition; ?? 0 is defensive for noUncheckedIndexedAccess
    /* v8 ignore next 2 */
    const b = buf[i] ?? 0;
    const r = buf[i + 2] ?? 0;
    buf[i] = r;
    buf[i + 2] = b;
  }
}

/** Swap BGRA → RGBA in-place for a 4-channel (32-bit) buffer. */
function swapBgraToRgba(buf: Uint8Array): void {
  for (let i = 0; i + 3 < buf.length; i += 4) {
    // bounds guaranteed by loop condition; ?? 0 is defensive for noUncheckedIndexedAccess
    /* v8 ignore next 2 */
    const b = buf[i] ?? 0;
    const r = buf[i + 2] ?? 0;
    buf[i] = r;
    buf[i + 2] = b;
  }
}

// ---------------------------------------------------------------------------
// 16-bit ARGB1555 unpack — Trap #3
// ---------------------------------------------------------------------------

/**
 * Unpack a 16-bit ARGB1555 little-endian buffer into an RGBA8 buffer.
 * MSB to LSB layout: A | RRRRR | GGGGG | BBBBB.
 * Each 5-bit channel expanded: (c5 << 3) | (c5 >> 2).
 */
function unpack16bitToRgba(src: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount * 4);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  for (let i = 0; i < pixelCount; i++) {
    const word = dv.getUint16(i * 2, true); // Trap #1: little-endian
    const b5 = word & 0x1f;
    const g5 = (word >> 5) & 0x1f;
    const r5 = (word >> 10) & 0x1f;
    const a1 = (word >> 15) & 0x01;
    out[i * 4] = (r5 << 3) | (r5 >> 2);
    out[i * 4 + 1] = (g5 << 3) | (g5 >> 2);
    out[i * 4 + 2] = (b5 << 3) | (b5 >> 2);
    out[i * 4 + 3] = a1 ? 255 : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RLE decoder — Traps #7, #11, #12
// ---------------------------------------------------------------------------

/**
 * Decode TGA RLE-compressed pixel stream.
 *
 * Trap #7: packet 0x00 = 1-pixel RAW (not no-op).
 * Trap #11: packets may cross scanline boundaries; operate on full raster stream.
 * Trap #12: pre-allocated output size is the absolute cap; reject overflows.
 */
export function decodeTgaRle(
  input: Uint8Array,
  inputOffset: number,
  bytesPerPixel: 1 | 2 | 3 | 4,
  expectedPixels: number,
): Uint8Array {
  const out = new Uint8Array(expectedPixels * bytesPerPixel);
  let src = inputOffset;
  let dst = 0;

  while (dst < out.length) {
    if (src >= input.length) {
      throw new TgaRleDecodeError('input-underrun');
    }
    const header = input[src++] ?? 0;
    const count = (header & 0x7f) + 1;
    const isRepeat = (header & 0x80) !== 0;
    const writeBytes = count * bytesPerPixel;

    if (dst + writeBytes > out.length) {
      // Trap #12: absolute output-size bound
      throw new TgaRleDecodeError('output-overflow');
    }

    if (isRepeat) {
      // REPEAT packet: one pixel, repeated count times
      if (src + bytesPerPixel > input.length) {
        throw new TgaRleDecodeError('input-underrun');
      }
      for (let i = 0; i < count; i++) {
        for (let b = 0; b < bytesPerPixel; b++) {
          // bounds guaranteed by prior check; ?? 0 defensive for noUncheckedIndexedAccess
          /* v8 ignore next */
          out[dst + i * bytesPerPixel + b] = input[src + b] ?? 0;
        }
      }
      src += bytesPerPixel;
    } else {
      // RAW packet: count literal pixels
      if (src + writeBytes > input.length) {
        throw new TgaRleDecodeError('input-underrun');
      }
      out.set(input.subarray(src, src + writeBytes), dst);
      src += writeBytes;
    }
    dst += writeBytes;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Origin normalisation — Trap #4
// ---------------------------------------------------------------------------

/**
 * Normalise origin to top-left in-place.
 * - BL (bottom-left): row-flip
 * - BR (bottom-right): row-flip + per-row reverse
 * - TL (top-left): no-op
 * - TR (top-right): per-row reverse
 */
function normaliseOrigin(
  pixelData: Uint8Array,
  width: number,
  height: number,
  channels: number,
  origin: TgaOrigin,
): void {
  const rowBytes = width * channels;

  const flipRows = (): void => {
    for (let top = 0, bot = height - 1; top < bot; top++, bot--) {
      const topOff = top * rowBytes;
      const botOff = bot * rowBytes;
      for (let b = 0; b < rowBytes; b++) {
        // bounds guaranteed by loop/row arithmetic; ?? 0 defensive for noUncheckedIndexedAccess
        /* v8 ignore next 2 */
        const t = pixelData[topOff + b] ?? 0;
        pixelData[topOff + b] = pixelData[botOff + b] ?? 0;
        pixelData[botOff + b] = t;
      }
    }
  };

  const reverseRows = (): void => {
    for (let row = 0; row < height; row++) {
      const rowOff = row * rowBytes;
      for (let left = 0, right = width - 1; left < right; left++, right--) {
        for (let ch = 0; ch < channels; ch++) {
          const lIdx = rowOff + left * channels + ch;
          const rIdx = rowOff + right * channels + ch;
          // bounds guaranteed by loop/row arithmetic; ?? 0 defensive for noUncheckedIndexedAccess
          /* v8 ignore next 2 */
          const tmp = pixelData[lIdx] ?? 0;
          pixelData[lIdx] = pixelData[rIdx] ?? 0;
          pixelData[rIdx] = tmp;
        }
      }
    }
  };

  switch (origin) {
    case 'bottom-left':
      flipRows();
      break;
    case 'bottom-right':
      flipRows();
      reverseRows();
      break;
    case 'top-left':
      // no-op
      break;
    case 'top-right':
      reverseRows();
      break;
  }
}

// ---------------------------------------------------------------------------
// Footer detection and parsing — Traps #5, #6
// ---------------------------------------------------------------------------

interface TgaFooterInfo {
  hasFooter: boolean;
  extensionAreaOffset: number;
  developerAreaOffset: number;
}

function parseFooter(input: Uint8Array): TgaFooterInfo {
  // Trap #5: TGA 2.0 footer is the last 26 bytes
  if (input.length < TGA_FOOTER_SIZE) {
    return { hasFooter: false, extensionAreaOffset: 0, developerAreaOffset: 0 };
  }

  const footerStart = input.length - TGA_FOOTER_SIZE;
  // Signature is at bytes 8..25 of the 26-byte footer (after the two uint32 offsets)
  const sigStart = footerStart + 8;

  // Trap #6: every byte of the 18-byte signature must match exactly.
  // H-1: If first 10 bytes match 'TRUEVISION' prefix but full signature fails → TgaBadFooterError.
  // Full mismatch (prefix also fails) → TGA 1.0 file, return hasFooter: false.
  const PREFIX_LEN = 10; // 'TRUEVISION'
  let prefixMatches = true;
  for (let i = 0; i < PREFIX_LEN; i++) {
    // bounds guaranteed; ?? 0 defensive for noUncheckedIndexedAccess
    /* v8 ignore next */
    if ((input[sigStart + i] ?? 0) !== (TGA_FOOTER_SIGNATURE[i] ?? 0)) {
      prefixMatches = false;
      break;
    }
  }

  let fullMatches = prefixMatches;
  if (prefixMatches) {
    for (let i = PREFIX_LEN; i < TGA_FOOTER_SIGNATURE.length; i++) {
      // bounds guaranteed; ?? 0 defensive for noUncheckedIndexedAccess
      /* v8 ignore next */
      if ((input[sigStart + i] ?? 0) !== (TGA_FOOTER_SIGNATURE[i] ?? 0)) {
        fullMatches = false;
        break;
      }
    }
    if (!fullMatches) {
      // Partial match: prefix 'TRUEVISION' present but rest corrupt — Trap #6
      throw new TgaBadFooterError(
        'footer begins with TRUEVISION prefix but signature is corrupt (expected TRUEVISION-XFILE.\\0).',
      );
    }
  }

  if (!prefixMatches) {
    // No prefix match at all → valid TGA 1.0 file with no footer
    return { hasFooter: false, extensionAreaOffset: 0, developerAreaOffset: 0 };
  }

  // Footer found — read the two uint32 LE offsets (Trap #1)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const extensionAreaOffset = dv.getUint32(footerStart, true);
  const developerAreaOffset = dv.getUint32(footerStart + 4, true);

  return { hasFooter: true, extensionAreaOffset, developerAreaOffset };
}

// ---------------------------------------------------------------------------
// Header sanity check for detection (Trap #5 — header heuristic)
// ---------------------------------------------------------------------------

export function isTgaHeader(input: Uint8Array): boolean {
  if (input.length < TGA_HEADER_SIZE) return false;

  // input.length >= TGA_HEADER_SIZE = 18 is guaranteed above; ?? 0 is defensive
  /* v8 ignore next 4 */
  const colorMapType = input[1] ?? 0;
  const imageType = input[2] ?? 0;
  const pixelDepth = input[16] ?? 0;
  const descriptor = input[17] ?? 0;

  // colorMapType must be 0 or 1
  if (colorMapType > 1) return false;
  // imageType must be in {0,1,2,3,9,10,11}
  const validTypes = new Set([0, 1, 2, 3, 9, 10, 11]);
  if (!validTypes.has(imageType)) return false;
  // pixelDepth must be in {8, 16, 24, 32}
  if (![8, 16, 24, 32].includes(pixelDepth)) return false;
  // Reserved bits 6-7 of byte 17 must be zero (Trap #13)
  if ((descriptor & 0xc0) !== 0) return false;
  // Dimensions must be ≥ 1 (read as LE uint16)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const width = dv.getUint16(12, true);
  const height = dv.getUint16(14, true);
  if (width === 0 || height === 0) return false;

  // Raster should fit in remaining input
  // bounds guaranteed above; ?? 0 defensive for noUncheckedIndexedAccess
  /* v8 ignore next 2 */
  const idLength = input[0] ?? 0;
  const cmType = colorMapType;
  /* v8 ignore next */
  const cmEntrySize = input[7] ?? 0;
  const cmLength = dv.getUint16(5, true);
  const cmStart = dv.getUint16(3, true);
  const bytesPerEntry = cmEntrySize === 32 ? 4 : cmEntrySize === 24 ? 3 : 0;
  // H-3 (security): if cmStart > cmLength, cmOnDiskEntries would be negative → reject
  if (cmType === 1 && cmStart > cmLength) return false;
  const cmOnDiskEntries = cmType === 1 ? (cmEntrySize > 0 ? cmLength - cmStart : 0) : 0;
  const cmBytes = cmOnDiskEntries > 0 ? cmOnDiskEntries * bytesPerEntry : 0;
  const bpp = pixelDepth === 32 ? 4 : pixelDepth === 24 ? 3 : pixelDepth === 16 ? 2 : 1;
  const rasterBytes = width * height * bpp;
  const minLength = TGA_HEADER_SIZE + idLength + cmBytes + rasterBytes;

  return input.length >= minLength;
}

// ---------------------------------------------------------------------------
// Color map parse — Traps #8, #15
// ---------------------------------------------------------------------------

function parseColorMap(
  input: Uint8Array,
  colorMapOffset: number,
  firstEntryIndex: number,
  colorMapLength: number,
  entrySize: number,
): TgaColorMap {
  if (entrySize !== 24 && entrySize !== 32) {
    throw new TgaUnsupportedFeatureError(
      `color map entry size ${entrySize} not supported; only 24 and 32 are allowed.`,
    );
  }
  const entrySizeBytes = entrySize === 32 ? 4 : 3;
  const channels = entrySize === 32 ? 4 : 3;
  // Trap #8: on-disk count is (colorMapLength - firstEntryIndex)
  const onDiskCount = colorMapLength - firstEntryIndex;
  if (onDiskCount < 0) {
    throw new TgaBadHeaderError(
      `colorMapFirstEntryIndex (${firstEntryIndex}) exceeds colorMapLength (${colorMapLength}).`,
    );
  }
  const onDiskBytes = onDiskCount * entrySizeBytes;
  if (colorMapOffset + onDiskBytes > input.length) {
    throw new TgaTruncatedError(
      `color map extends past input (need ${colorMapOffset + onDiskBytes}, have ${input.length}).`,
    );
  }

  // H-1 (security): cap palette allocation before allocating
  const paletteTotalBytes = colorMapLength * channels;
  if (paletteTotalBytes > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(paletteTotalBytes, MAX_INPUT_BYTES);
  }
  // Allocate full palette including zero-filled prefix (Trap #8)
  const paletteData = new Uint8Array(paletteTotalBytes);

  // Fill [firstEntryIndex .. colorMapLength) from on-disk data
  for (let i = 0; i < onDiskCount; i++) {
    const srcOff = colorMapOffset + i * entrySizeBytes;
    const dstOff = (firstEntryIndex + i) * channels;
    if (entrySize === 24) {
      // Trap #15: BGR → RGB; bounds guaranteed by onDiskBytes check; ?? 0 defensive
      /* v8 ignore next 3 */
      paletteData[dstOff] = input[srcOff + 2] ?? 0; // R
      paletteData[dstOff + 1] = input[srcOff + 1] ?? 0; // G
      paletteData[dstOff + 2] = input[srcOff] ?? 0; // B
    } else {
      // 32-bit: BGRA → RGBA (Trap #15); bounds guaranteed; ?? 0 defensive
      /* v8 ignore next 4 */
      paletteData[dstOff] = input[srcOff + 2] ?? 0; // R
      paletteData[dstOff + 1] = input[srcOff + 1] ?? 0; // G
      paletteData[dstOff + 2] = input[srcOff] ?? 0; // B
      paletteData[dstOff + 3] = input[srcOff + 3] ?? 0; // A
    }
  }

  return {
    firstEntryIndex,
    length: colorMapLength,
    entrySize: entrySize as TgaColorMapEntrySize,
    paletteData,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseTga(input: Uint8Array): TgaFile {
  // Step 1: validate input size
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }
  if (input.length < TGA_HEADER_SIZE) {
    throw new TgaBadHeaderError(`input is ${input.length} bytes; minimum is ${TGA_HEADER_SIZE}.`);
  }

  // Step 2: read 18-byte header via DataView (all LE — Trap #1)
  // input.length >= TGA_HEADER_SIZE = 18 is guaranteed above; ?? 0 is defensive for noUncheckedIndexedAccess
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  /* v8 ignore next 3 */
  const idLength = input[0] ?? 0;
  const colorMapType = input[1] ?? 0;
  const imageTypeRaw = input[2] ?? 0;
  const colorMapFirstEntryIndex = dv.getUint16(3, true); // Trap #1
  const colorMapLength = dv.getUint16(5, true); // Trap #1
  /* v8 ignore next */
  const colorMapEntrySize = input[7] ?? 0;
  const xOrigin = dv.getUint16(8, true); // Trap #1
  const yOrigin = dv.getUint16(10, true); // Trap #1
  const width = dv.getUint16(12, true); // Trap #1
  const height = dv.getUint16(14, true); // Trap #1
  /* v8 ignore next 2 */
  const pixelDepth = input[16] ?? 0;
  const descriptor = input[17] ?? 0;

  // Step 3: validate imageType
  if (imageTypeRaw === 0) {
    throw new TgaNoImageDataError();
  }
  const validImageTypes = new Set<number>([1, 2, 3, 9, 10, 11]);
  if (!validImageTypes.has(imageTypeRaw)) {
    throw new TgaUnsupportedImageTypeError(imageTypeRaw);
  }
  const imageType = imageTypeRaw as TgaImageType;

  // Step 4: validate (imageType, pixelDepth) legal pair — Trap #9
  if (![8, 16, 24, 32].includes(pixelDepth)) {
    throw new TgaUnsupportedFeatureError(`pixel depth ${pixelDepth} is not supported.`);
  }
  if (!isLegalPair(imageType, pixelDepth)) {
    throw new TgaUnsupportedFeatureError(
      `(imageType=${imageType}, pixelDepth=${pixelDepth}) is not a legal combination.`,
    );
  }
  const typedPixelDepth = pixelDepth as TgaPixelDepth;

  // Step 5: validate attributeBits — Trap #10
  const attributeBits = descriptor & 0x0f;
  let validAttributeBits: boolean;
  switch (pixelDepth) {
    case 24:
      validAttributeBits = attributeBits === 0;
      break;
    case 32:
      validAttributeBits = attributeBits === 8;
      break;
    case 16:
      validAttributeBits = attributeBits === 0 || attributeBits === 1;
      break;
    default: // 8
      validAttributeBits = attributeBits === 0;
      break;
  }
  if (!validAttributeBits) {
    throw new TgaBadHeaderError(
      `attributeBits=${attributeBits} is inconsistent with pixelDepth=${pixelDepth}.`,
    );
  }
  const typedAttributeBits = attributeBits as 0 | 1 | 8;

  // Step 6: validate reserved bits 6-7 — Trap #13
  if ((descriptor & 0xc0) !== 0) {
    throw new TgaBadHeaderError(
      `reserved bits 6-7 of byte 17 must be 0, got 0x${descriptor.toString(16)}.`,
    );
  }

  // Step 7: validate dimensions
  if (width === 0 || height === 0) {
    throw new TgaBadHeaderError(`dimensions must be ≥ 1×1, got ${width}×${height}.`);
  }
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(`TGA: dimension ${width}×${height} exceeds MAX_DIM=${MAX_DIM}.`);
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `TGA: pixel count ${pixelCount} exceeds MAX_PIXELS=${MAX_PIXELS}.`,
    );
  }

  // Derive channels BEFORE pixel-byte cap (16-bit unpacks to 4 channels)
  const channels = channelsForType(imageType, typedPixelDepth);
  const pixelBytes = pixelCount * channels;
  if (pixelBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `TGA: pixel byte count ${pixelBytes} exceeds MAX_PIXEL_BYTES=${MAX_PIXEL_BYTES}.`,
    );
  }

  // Step 8: compute offsets
  const imageIdOffset = TGA_HEADER_SIZE;
  const colorMapOffset = imageIdOffset + idLength; // Trap #14

  // M-2 (security): validate color-map entry size BEFORE computing pixelDataOffset,
  // so an unsupported entrySize can never miscompute the offset.
  if (colorMapType === 1 && (colorMapEntrySize === 15 || colorMapEntrySize === 16)) {
    throw new TgaUnsupportedFeatureError(
      `palette-entry-size-${colorMapEntrySize}-bit — only 24 and 32 are supported.`,
    );
  }

  // Color map on-disk byte count
  const cmOnDiskEntries = colorMapType === 1 ? colorMapLength - colorMapFirstEntryIndex : 0;
  const cmEntrySizeBytes = colorMapEntrySize === 32 ? 4 : colorMapEntrySize === 24 ? 3 : 0;
  // M-3 (code): the > 0 guard already ensures positivity; Math.max(0, ...) was redundant
  const cmBytes = cmOnDiskEntries > 0 ? cmOnDiskEntries * cmEntrySizeBytes : 0;

  const pixelDataOffset = colorMapOffset + cmBytes;

  // On-disk bytes per pixel (before unpacking)
  const bpp =
    typedPixelDepth === 32 ? 4 : typedPixelDepth === 24 ? 3 : typedPixelDepth === 16 ? 2 : 1;

  // For raw types, validate raster fits
  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  if (!isRle) {
    const rasterBytes = pixelCount * bpp;
    if (pixelDataOffset + rasterBytes > input.length) {
      throw new TgaTruncatedError(
        `raster data ends at ${pixelDataOffset + rasterBytes} but input is only ${input.length} bytes.`,
      );
    }
  } else {
    if (pixelDataOffset > input.length) {
      throw new TgaTruncatedError(
        `pixel data offset ${pixelDataOffset} exceeds input length ${input.length}.`,
      );
    }
  }

  // Step 9: slice Image ID
  const imageId = input.slice(imageIdOffset, imageIdOffset + idLength);

  // Step 10: parse Color Map
  // Note: 15/16-bit entrySize already rejected in Step 8 before offset computation (M-2).
  let colorMap: TgaColorMap | null = null;
  if (colorMapType === 1) {
    colorMap = parseColorMap(
      input,
      colorMapOffset,
      colorMapFirstEntryIndex,
      colorMapLength,
      colorMapEntrySize,
    );
  }

  // Step 11: decode pixel data
  const normalisations: TgaNormalisation[] = [];
  let rawPixelData: Uint8Array;

  if (isRle) {
    // RLE types 9, 10, 11 — Traps #7, #11, #12
    rawPixelData = decodeTgaRle(input, pixelDataOffset, bpp as 1 | 2 | 3 | 4, pixelCount);
    normalisations.push('rle-decoded-on-parse');
  } else {
    // Raw types 1, 2, 3
    const rasterBytes = pixelCount * bpp;
    rawPixelData = input.slice(pixelDataOffset, pixelDataOffset + rasterBytes);
  }

  // BGR/BGRA → RGB/RGBA swap and 16-bit unpack — Traps #2, #3
  let pixelData: Uint8Array;
  if (typedPixelDepth === 24) {
    pixelData = new Uint8Array(rawPixelData); // copy
    swapBgrToRgb(pixelData); // Trap #2
  } else if (typedPixelDepth === 32) {
    pixelData = new Uint8Array(rawPixelData); // copy
    swapBgraToRgba(pixelData); // Trap #2
  } else if (typedPixelDepth === 16) {
    pixelData = unpack16bitToRgba(rawPixelData, pixelCount); // Trap #3 (includes swap)
  } else {
    // 8-bit: grayscale or cmap index — no swap needed
    pixelData = new Uint8Array(rawPixelData);
  }

  // Step 12: apply origin normalisation — Trap #4
  const originBits = (descriptor >> 4) & 0x03;
  const originalOrigin = decodeOriginBits(originBits);
  if (originalOrigin !== 'top-left') {
    normaliseOrigin(pixelData, width, height, channels, originalOrigin);
    normalisations.push('origin-normalised-to-top-left');
  }

  // Step 13: parse footer — Traps #5, #6
  const { hasFooter, extensionAreaOffset, developerAreaOffset } = parseFooter(input);

  let extensionAreaBytes: Uint8Array | null = null;
  let developerAreaBytes: Uint8Array | null = null;

  if (hasFooter) {
    // H-3: compute the minimum safe start for extension/developer areas.
    // For raw types we know the exact pixel data end; for RLE we used the compressed
    // data that starts at pixelDataOffset — use pixelDataOffset as lower bound guard
    // (actual pixel data end is at least pixelDataOffset).
    const rawRasterBytes = isRle ? 0 : pixelCount * bpp;
    const pixelDataEnd = pixelDataOffset + rawRasterBytes;
    const footerStart = input.length - TGA_FOOTER_SIZE;

    if (extensionAreaOffset !== 0) {
      // H-3 (a): offset must be >= end of pixel data and < start of footer
      if (extensionAreaOffset < pixelDataEnd || extensionAreaOffset >= footerStart) {
        throw new TgaBadFooterError(
          `extension area offset ${extensionAreaOffset} is outside the valid region [${pixelDataEnd}, ${footerStart}).`,
        );
      }
      // M-3 (security): extension area must meet the 495-byte spec minimum
      const extEnd =
        developerAreaOffset !== 0 && developerAreaOffset > extensionAreaOffset
          ? developerAreaOffset
          : footerStart;
      if (extEnd - extensionAreaOffset < 495) {
        throw new TgaBadFooterError(
          `extension area is only ${extEnd - extensionAreaOffset} bytes; minimum is 495 per spec.`,
        );
      }
      extensionAreaBytes = input.slice(extensionAreaOffset, extEnd);
    }

    if (developerAreaOffset !== 0) {
      // H-3 (a): offset must be >= end of pixel data and < start of footer
      if (developerAreaOffset < pixelDataEnd || developerAreaOffset >= footerStart) {
        throw new TgaBadFooterError(
          `developer area offset ${developerAreaOffset} is outside the valid region [${pixelDataEnd}, ${footerStart}).`,
        );
      }
      // H-3: developer and extension areas must not overlap each other
      if (
        extensionAreaOffset !== 0 &&
        developerAreaOffset >= extensionAreaOffset &&
        developerAreaOffset < footerStart
      ) {
        // Overlap: devAreaOffset falls inside extension area range
        throw new TgaBadFooterError(
          `developer area offset ${developerAreaOffset} overlaps extension area at ${extensionAreaOffset}.`,
        );
      }
      const devEnd =
        extensionAreaOffset !== 0 && extensionAreaOffset > developerAreaOffset
          ? extensionAreaOffset
          : footerStart;
      developerAreaBytes = input.slice(developerAreaOffset, devEnd);
    }
  }

  return {
    format: 'tga',
    imageType,
    width,
    height,
    channels,
    bitDepth: 8,
    originalPixelDepth: typedPixelDepth,
    originalOrigin,
    pixelData,
    colorMap,
    imageId,
    xOrigin,
    yOrigin,
    attributeBits: typedAttributeBits,
    hasFooter,
    extensionAreaBytes,
    developerAreaBytes,
    normalisations,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * RLE encoder (greedy): scans for runs, emits REPEAT packets where beneficial.
 * Structural equivalence only — not byte-equal with the original encoder.
 */
function encodeTgaRle(pixelData: Uint8Array, bytesPerPixel: number): Uint8Array {
  const pixelCount = pixelData.length / bytesPerPixel;
  // Worst case: every pixel is a 1-pixel RAW packet → 1 header byte per pixel
  const maxOut = pixelData.length + pixelCount;
  const out = new Uint8Array(maxOut);
  let dst = 0;
  let i = 0;

  while (i < pixelCount) {
    // Check for run
    let runLen = 1;
    while (
      runLen < 128 &&
      i + runLen < pixelCount &&
      pixelsEqual(pixelData, i, i + runLen, bytesPerPixel)
    ) {
      runLen++;
    }

    if (runLen > 1) {
      // REPEAT packet: bit 7 = 1, count - 1 in bits 0-6
      out[dst++] = 0x80 | (runLen - 1);
      for (let b = 0; b < bytesPerPixel; b++) {
        out[dst++] = pixelData[i * bytesPerPixel + b] ?? 0;
      }
      i += runLen;
    } else {
      // RAW packet: find contiguous non-repeating pixels (up to 128)
      let rawLen = 1;
      while (
        rawLen < 128 &&
        i + rawLen < pixelCount &&
        !pixelsEqual(pixelData, i + rawLen - 1, i + rawLen, bytesPerPixel)
      ) {
        rawLen++;
      }
      out[dst++] = rawLen - 1; // bit 7 = 0
      for (let p = 0; p < rawLen; p++) {
        for (let b = 0; b < bytesPerPixel; b++) {
          // bounds guaranteed by rawLen logic; ?? 0 defensive for noUncheckedIndexedAccess
          /* v8 ignore next */
          out[dst++] = pixelData[(i + p) * bytesPerPixel + b] ?? 0;
        }
      }
      i += rawLen;
    }
  }

  return out.subarray(0, dst);
}

function pixelsEqual(data: Uint8Array, i: number, j: number, bpp: number): boolean {
  for (let b = 0; b < bpp; b++) {
    // bounds guaranteed by caller logic; ?? 0 defensive for noUncheckedIndexedAccess
    /* v8 ignore next */
    if ((data[i * bpp + b] ?? 0) !== (data[j * bpp + b] ?? 0)) return false;
  }
  return true;
}

export function serializeTga(file: TgaFile): Uint8Array {
  const normalisations: TgaNormalisation[] = [];

  if (!file.hasFooter) {
    normalisations.push('tga-1-promoted-to-tga-2-on-serialize');
  }

  // Determine on-disk bytesPerPixel from originalPixelDepth
  const bpp =
    file.originalPixelDepth === 32
      ? 4
      : file.originalPixelDepth === 24
        ? 3
        : file.originalPixelDepth === 16
          ? 2
          : 1;

  const pixelCount = file.width * file.height;

  // Convert pixelData back to BGR/BGRA or re-pack 16-bit
  let onDiskPixelData: Uint8Array;
  if (file.originalPixelDepth === 24) {
    onDiskPixelData = new Uint8Array(pixelCount * 3);
    // RGB → BGR (Trap #2)
    for (let i = 0; i < pixelCount; i++) {
      // bounds guaranteed by pixelCount; ?? 0 defensive for noUncheckedIndexedAccess
      /* v8 ignore next 3 */
      onDiskPixelData[i * 3] = file.pixelData[i * 3 + 2] ?? 0; // B
      onDiskPixelData[i * 3 + 1] = file.pixelData[i * 3 + 1] ?? 0; // G
      onDiskPixelData[i * 3 + 2] = file.pixelData[i * 3] ?? 0; // R
    }
  } else if (file.originalPixelDepth === 32) {
    onDiskPixelData = new Uint8Array(pixelCount * 4);
    // RGBA → BGRA (Trap #2)
    for (let i = 0; i < pixelCount; i++) {
      // bounds guaranteed by pixelCount; ?? 0 defensive for noUncheckedIndexedAccess
      /* v8 ignore next */
      onDiskPixelData[i * 4] = file.pixelData[i * 4 + 2] ?? 0; // B
      /* v8 ignore next 3 */
      onDiskPixelData[i * 4 + 1] = file.pixelData[i * 4 + 1] ?? 0; // G
      onDiskPixelData[i * 4 + 2] = file.pixelData[i * 4] ?? 0; // R
      onDiskPixelData[i * 4 + 3] = file.pixelData[i * 4 + 3] ?? 0; // A
    }
  } else if (file.originalPixelDepth === 16) {
    // Re-pack RGBA8 → ARGB1555 LE (Trap #3)
    onDiskPixelData = new Uint8Array(pixelCount * 2);
    const dv = new DataView(onDiskPixelData.buffer);
    for (let i = 0; i < pixelCount; i++) {
      // bounds guaranteed by pixelCount; ?? 0 defensive for noUncheckedIndexedAccess
      /* v8 ignore next 4 */
      const r = file.pixelData[i * 4] ?? 0;
      const g = file.pixelData[i * 4 + 1] ?? 0;
      const b = file.pixelData[i * 4 + 2] ?? 0;
      const a = file.pixelData[i * 4 + 3] ?? 0;
      const r5 = (r >> 3) & 0x1f;
      const g5 = (g >> 3) & 0x1f;
      const b5 = (b >> 3) & 0x1f;
      const a1 = a >= 128 ? 1 : 0;
      const word = (a1 << 15) | (r5 << 10) | (g5 << 5) | b5;
      dv.setUint16(i * 2, word, true); // Trap #1: little-endian
    }
  } else {
    // 8-bit grayscale or cmap index — no swap
    onDiskPixelData = new Uint8Array(file.pixelData);
  }

  // Encode pixel data (raw or RLE depending on imageType)
  const isRle = file.imageType === 9 || file.imageType === 10 || file.imageType === 11;
  let encodedPixelData: Uint8Array;
  if (isRle) {
    encodedPixelData = encodeTgaRle(onDiskPixelData, bpp);
  } else {
    encodedPixelData = onDiskPixelData;
  }

  // Color map bytes
  let cmBytes = new Uint8Array(0);
  if (file.colorMap !== null) {
    const cm = file.colorMap;
    const cmChannels = cm.entrySize === 32 ? 4 : 3;
    const onDiskCount = cm.length - cm.firstEntryIndex;
    // H-2: cmChannels === 4 ? 4 : 3 is just cmChannels (derived from entrySize === 32 ? 4 : 3)
    cmBytes = new Uint8Array(onDiskCount * cmChannels);
    for (let i = 0; i < onDiskCount; i++) {
      const srcOff = (cm.firstEntryIndex + i) * cmChannels;
      const dstOff = i * cmChannels;
      if (cm.entrySize === 24) {
        // RGB → BGR (Trap #15); bounds guaranteed by paletteData size; ?? 0 defensive
        /* v8 ignore next 3 */
        cmBytes[dstOff] = cm.paletteData[srcOff + 2] ?? 0; // B
        cmBytes[dstOff + 1] = cm.paletteData[srcOff + 1] ?? 0; // G
        cmBytes[dstOff + 2] = cm.paletteData[srcOff] ?? 0; // R
      } else {
        // RGBA → BGRA (Trap #15); bounds guaranteed by paletteData size; ?? 0 defensive
        /* v8 ignore next 4 */
        cmBytes[dstOff] = cm.paletteData[srcOff + 2] ?? 0; // B
        cmBytes[dstOff + 1] = cm.paletteData[srcOff + 1] ?? 0; // G
        cmBytes[dstOff + 2] = cm.paletteData[srcOff] ?? 0; // R
        cmBytes[dstOff + 3] = cm.paletteData[srcOff + 3] ?? 0; // A
      }
    }
  }

  // Extension/Developer area bytes
  const extBytes = file.extensionAreaBytes ?? new Uint8Array(0);
  const devBytes = file.developerAreaBytes ?? new Uint8Array(0);

  // Compute layout offsets
  const headerEnd = TGA_HEADER_SIZE + file.imageId.length + cmBytes.length;
  const pixelDataStart = headerEnd; // offset in output
  const pixelDataEnd = pixelDataStart + encodedPixelData.length;

  // Extension and Developer area placement
  let devAreaOffset = 0;
  let extAreaOffset = 0;
  let extAreaStart = pixelDataEnd;
  let devAreaStart = pixelDataEnd;

  if (devBytes.length > 0) {
    devAreaOffset = devAreaStart;
    devAreaStart = devAreaOffset;
    extAreaStart = devAreaOffset + devBytes.length;
  }
  if (extBytes.length > 0) {
    extAreaOffset = extAreaStart;
  }

  // Total size: header + imageId + cmBytes + pixelData + devBytes + extBytes + footer
  const totalSize =
    TGA_HEADER_SIZE +
    file.imageId.length +
    cmBytes.length +
    encodedPixelData.length +
    devBytes.length +
    extBytes.length +
    TGA_FOOTER_SIZE;

  const out = new Uint8Array(totalSize);
  const dvOut = new DataView(out.buffer);

  // Write 18-byte header — Trap #1: all multi-byte fields are LE
  out[0] = file.imageId.length;
  out[1] = file.colorMap !== null ? 1 : 0;
  out[2] = file.imageType;
  // Color map spec fields (Trap #1: LE uint16)
  const cm = file.colorMap;
  dvOut.setUint16(3, cm !== null ? cm.firstEntryIndex : 0, true);
  dvOut.setUint16(5, cm !== null ? cm.length : 0, true);
  out[7] = cm !== null ? cm.entrySize : 0;
  dvOut.setUint16(8, file.xOrigin, true);
  dvOut.setUint16(10, file.yOrigin, true);
  dvOut.setUint16(12, file.width, true);
  dvOut.setUint16(14, file.height, true);
  out[16] = file.originalPixelDepth;
  // Descriptor: always top-left origin (bits 4-5 = 0b10 = 2), attributeBits in bits 0-3 (Trap #4)
  // Bits 6-7 reserved = 0 (Trap #13)
  out[17] = (2 << 4) | (file.attributeBits & 0x0f);

  // Write image ID
  let offset = TGA_HEADER_SIZE;
  out.set(file.imageId, offset);
  offset += file.imageId.length;

  // Write color map
  out.set(cmBytes, offset);
  offset += cmBytes.length;

  // Write pixel data
  out.set(encodedPixelData, offset);
  offset += encodedPixelData.length;

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

  // Write TGA 2.0 footer (always — Trap #5: serializer always emits TGA 2.0)
  dvOut.setUint32(offset, extAreaOffset, true); // Trap #1: LE
  dvOut.setUint32(offset + 4, devAreaOffset, true); // Trap #1: LE
  out.set(TGA_FOOTER_SIGNATURE, offset + 8);

  return out;
}
