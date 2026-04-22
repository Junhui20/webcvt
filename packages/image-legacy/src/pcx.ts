/**
 * PCX (PC Paintbrush / ZSoft) parser and serializer for @catlabtech/webcvt-image-legacy.
 *
 * Implements ZSoft PCX File Format Technical Reference Manual (1991, version 5).
 * Clean-room implementation per plan.md §11 — no reference implementations consulted.
 *
 * All 10 traps from the design note are handled (see inline Trap #N comments):
 *   #1  All multi-byte ints little-endian unconditionally — DataView.getUint16(off, true)
 *   #2  Width = Xmax − Xmin + 1 (NOT Xmax); validate Xmax ≥ Xmin before subtraction
 *   #3  BytesPerLine may exceed ceil(width×BPP/8); strip trailing pad bytes on decode
 *   #4  Scanline layout PLANAR per scanline for NPlanes>1 — NOT pixel-interleaved
 *   #5  RLE: top 2 bits set → run; count = low 6 bits (NOT biased); any byte ≥ 0xC0 must
 *       be encoded as RUN even when it is a single pixel
 *   #6  RLE runs MUST NOT cross scanline boundaries per spec; decoder tolerates violations;
 *       encoder resets state at each scanline boundary
 *   #7  256-colour palette footer: ONLY the byte at fileLength−769 being 0x0C counts
 *   #8  (BPP=8, NPlanes=1) ambiguous: footer present → indexed VGA; absent → grayscale
 *   #9  1-bit bilevel uses EGA palette[0..1], NOT hard-coded black/white
 *   #10 Only supported (BPP, NPlanes) pairs: (1,1),(2,1),(4,1),(1,4),(8,1),(8,3)
 */

import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  MAX_PIXEL_BYTES,
  PCX_EGA_PALETTE_SIZE,
  PCX_ENCODING_RLE,
  PCX_HEADER_SIZE,
  PCX_MAGIC,
  PCX_MAX_RUN,
  PCX_PALETTE_FOOTER_SIZE,
  PCX_PALETTE_SENTINEL,
  PCX_VGA_PALETTE_SIZE,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  PcxBadEncodingError,
  PcxBadHeaderError,
  PcxBadMagicError,
  PcxBadVersionError,
  PcxRleDecodeError,
  PcxUnsupportedFeatureError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PcxVersion = 0 | 2 | 3 | 4 | 5;
export type PcxBitsPerPixel = 1 | 2 | 4 | 8;
export type PcxNPlanes = 1 | 3 | 4;

export type PcxKind =
  | '1bit-bilevel'
  | '2bit-cga'
  | '4bit-ega-packed'
  | '4bit-ega-planar'
  | '8bit-indexed-vga'
  | '8bit-grayscale'
  | '24bit-truecolor';

export type PcxNormalisation =
  | 'rle-decoded-on-parse'
  | 'planar-deinterleaved-to-packed-rgb'
  | 'bytesperline-pad-bytes-stripped'
  | 'version-promoted-to-5-on-serialize';

export interface PcxFile {
  format: 'pcx';
  version: PcxVersion;
  kind: PcxKind;
  width: number;
  height: number;
  /** 1 for all indexed/grayscale/bilevel/CGA/EGA kinds; 3 for 24-bit truecolor. */
  channels: 1 | 3;
  /** Always 8 in the decoded pixelData. */
  bitDepth: 8;

  /** Original BitsPerPixel from the header (before decode). */
  originalBitsPerPixel: PcxBitsPerPixel;
  /** Original NPlanes from the header (before decode). */
  originalNPlanes: PcxNPlanes;

  /**
   * Decoded pixel data, top-down row-major:
   *  - 1/2/4-bit and 8-bit-indexed/grayscale: 1 byte per pixel (index or grey value)
   *  - 24-bit truecolor: 3 bytes per pixel, interleaved RGB
   */
  pixelData: Uint8Array;

  /** 48 bytes from header offsets 16–63; always present. */
  egaPalette: Uint8Array;
  /** 768 bytes iff v5 with VGA palette footer; null otherwise. */
  vgaPalette: Uint8Array | null;

  xMin: number;
  yMin: number;
  hDpi: number;
  vDpi: number;
  paletteInfo: number;
  hScreenSize: number;
  vScreenSize: number;
  /** Reserved byte at offset 64; preserved verbatim. */
  reservedByte64: number;
  /** Reserved bytes at offsets 74–127 (54 bytes); preserved verbatim. */
  reserved54: Uint8Array;

  normalisations: PcxNormalisation[];
}

// ---------------------------------------------------------------------------
// Valid (BitsPerPixel, NPlanes) combinations — Trap #10
// ---------------------------------------------------------------------------

type BppNplanesTuple = readonly [PcxBitsPerPixel, PcxNPlanes];

const SUPPORTED_COMBOS: readonly BppNplanesTuple[] = [
  [1, 1], // 1-bit bilevel
  [2, 1], // 2-bit CGA
  [4, 1], // 4-bit EGA packed
  [1, 4], // 4-bit EGA planar
  [8, 1], // 8-bit indexed or grayscale
  [8, 3], // 24-bit truecolor
];

function isSupportedCombo(bpp: number, nplanes: number): bpp is PcxBitsPerPixel {
  return SUPPORTED_COMBOS.some(([b, p]) => b === bpp && p === nplanes);
}

function isValidVersion(v: number): v is PcxVersion {
  return v === 0 || v === 2 || v === 3 || v === 4 || v === 5;
}

function isValidNPlanes(n: number): n is PcxNPlanes {
  return n === 1 || n === 3 || n === 4;
}

// ---------------------------------------------------------------------------
// RLE decoder — Trap #5, #6
// ---------------------------------------------------------------------------

/**
 * Decode PCX RLE from input[inputOffset..inputEnd) into exactly expectedBytes bytes.
 *
 * Trap #5: byte with top 2 bits set (0xC0..0xFF) is a RUN header;
 *          count = low 6 bits (1–63, NOT biased). Literal bytes below 0xC0.
 * Trap #6: decoder walks full byte stream without scanline boundaries (max compat).
 *          RLE decoder stops when expectedBytes are emitted, NOT at inputEnd.
 */
export function decodePcxRle(
  input: Uint8Array,
  inputOffset: number,
  inputEnd: number,
  expectedBytes: number,
): Uint8Array {
  const out = new Uint8Array(expectedBytes);
  let src = inputOffset;
  let dst = 0;

  while (dst < expectedBytes) {
    if (src >= inputEnd) {
      throw new PcxRleDecodeError('input-underrun');
    }
    // bounds guaranteed by src < inputEnd check above; ?? 0 is defensive for noUncheckedIndexedAccess
    /* v8 ignore next */
    const b = input[src++] ?? 0;

    if ((b & 0xc0) === 0xc0) {
      // RUN packet — Trap #5.
      // Spec says count range is 1..63. Byte 0xC0 with low 6 bits = 0 is
      // illegal — a zero-length run would consume a data byte without
      // advancing output, enabling an infinite-loop DoS on crafted input
      // of alternating 0xC0/XX pairs. Reject explicitly.
      const count = b & 0x3f;
      if (count === 0) {
        throw new PcxRleDecodeError('zero-length-run');
      }
      if (src >= inputEnd) {
        throw new PcxRleDecodeError('input-underrun');
      }
      if (dst + count > expectedBytes) {
        throw new PcxRleDecodeError('output-overflow');
      }
      /* v8 ignore next */
      const data = input[src++] ?? 0;
      for (let i = 0; i < count; i++) {
        out[dst + i] = data;
      }
      dst += count;
    } else {
      // Literal byte
      out[dst++] = b;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Planar de-interleave + pad stripping — Trap #3, #4
// ---------------------------------------------------------------------------

/**
 * Extract per-scanline plane bytes from a raw raster buffer, strip pad bytes,
 * and return pixel data appropriate for the given kind.
 *
 * Trap #3: bytesPerLine >= ceil(width×BPP/8); strip the trailing pad bytes.
 * Trap #4: scanline layout is [plane0 × BPL][plane1 × BPL]...[planeN-1 × BPL].
 */
function deplanarize(
  rawRaster: Uint8Array,
  width: number,
  height: number,
  bitsPerPixel: PcxBitsPerPixel,
  nPlanes: PcxNPlanes,
  bytesPerLine: number,
  kind: PcxKind,
): Uint8Array {
  const scanlineStride = nPlanes * bytesPerLine; // bytes per full scanline in raw raster

  if (kind === '24bit-truecolor') {
    // (BPP=8, NPlanes=3): planar RGB → interleaved RGB
    const pixelData = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      const scanBase = y * scanlineStride;
      for (let x = 0; x < width; x++) {
        // Trap #3: only width pixels taken; bytesPerLine padding is discarded
        pixelData[y * width * 3 + x * 3] = rawRaster[scanBase + x] ?? 0; // R
        pixelData[y * width * 3 + x * 3 + 1] = rawRaster[scanBase + bytesPerLine + x] ?? 0; // G
        pixelData[y * width * 3 + x * 3 + 2] = rawRaster[scanBase + 2 * bytesPerLine + x] ?? 0; // B
      }
    }
    return pixelData;
  }

  if (kind === '4bit-ega-planar') {
    // (BPP=1, NPlanes=4): four bit-planes → 4-bit EGA index per pixel
    const pixelData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const scanBase = y * scanlineStride;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor(x / 8);
        const bitIdx = 7 - (x % 8); // MSB first within each byte
        let idx = 0;
        // Trap #4: bit from each of 4 planes combines into 4-bit EGA index
        for (let p = 0; p < 4; p++) {
          const planeByte = rawRaster[scanBase + p * bytesPerLine + byteIdx] ?? 0;
          const bit = (planeByte >> bitIdx) & 1;
          idx |= bit << p;
        }
        pixelData[y * width + x] = idx;
      }
    }
    return pixelData;
  }

  if (kind === '1bit-bilevel') {
    // (BPP=1, NPlanes=1): unpack 1-bit per pixel → 0 or 1 index
    const pixelData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const scanBase = y * scanlineStride;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        const b = rawRaster[scanBase + byteIdx] ?? 0;
        pixelData[y * width + x] = (b >> bitIdx) & 1;
      }
    }
    return pixelData;
  }

  if (kind === '2bit-cga') {
    // (BPP=2, NPlanes=1): unpack 2-bit per pixel → 0–3 index
    const pixelData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const scanBase = y * scanlineStride;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor((x * 2) / 8);
        const shift = 6 - ((x * 2) % 8); // 2 bits, MSB first
        const b = rawRaster[scanBase + byteIdx] ?? 0;
        pixelData[y * width + x] = (b >> shift) & 0x03;
      }
    }
    return pixelData;
  }

  if (kind === '4bit-ega-packed') {
    // (BPP=4, NPlanes=1): unpack 4-bit per pixel → 0–15 index
    const pixelData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const scanBase = y * scanlineStride;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor(x / 2);
        const b = rawRaster[scanBase + byteIdx] ?? 0;
        // High nibble is first pixel, low nibble is second
        pixelData[y * width + x] = x % 2 === 0 ? (b >> 4) & 0x0f : b & 0x0f;
      }
    }
    return pixelData;
  }

  // 8-bit indexed or grayscale (BPP=8, NPlanes=1)
  // Trap #3: strip BPL-width trailing pad bytes
  const pixelData = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const scanBase = y * scanlineStride;
    for (let x = 0; x < width; x++) {
      pixelData[y * width + x] = rawRaster[scanBase + x] ?? 0;
    }
  }
  return pixelData;
}

// ---------------------------------------------------------------------------
// Kind determination — Trap #8, #10
// ---------------------------------------------------------------------------

function determineKind(
  bitsPerPixel: PcxBitsPerPixel,
  nPlanes: PcxNPlanes,
  hasVgaPalette: boolean,
): PcxKind {
  if (bitsPerPixel === 1 && nPlanes === 1) return '1bit-bilevel';
  if (bitsPerPixel === 2 && nPlanes === 1) return '2bit-cga';
  if (bitsPerPixel === 4 && nPlanes === 1) return '4bit-ega-packed';
  if (bitsPerPixel === 1 && nPlanes === 4) return '4bit-ega-planar';
  if (bitsPerPixel === 8 && nPlanes === 3) return '24bit-truecolor';
  // (BPP=8, NPlanes=1): ambiguous — Trap #8
  // Footer present → indexed VGA; absent → grayscale
  if (bitsPerPixel === 8 && nPlanes === 1) {
    return hasVgaPalette ? '8bit-indexed-vga' : '8bit-grayscale';
  }
  // Should not reach here if combo was validated
  /* v8 ignore next */
  return '8bit-grayscale';
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parsePcx(input: Uint8Array): PcxFile {
  // Step 1: validate input size
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }
  if (input.length < PCX_HEADER_SIZE) {
    throw new PcxBadHeaderError(
      `input is only ${input.length} bytes; minimum is ${PCX_HEADER_SIZE} (header).`,
    );
  }

  // Step 2: parse 128-byte header via DataView (all LE — Trap #1)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);

  const manufacturer = dv.getUint8(0);
  const version = dv.getUint8(1);
  const encoding = dv.getUint8(2);
  const bitsPerPixelRaw = dv.getUint8(3);
  const xMin = dv.getUint16(4, true); // Trap #1: LE
  const yMin = dv.getUint16(6, true);
  const xMax = dv.getUint16(8, true);
  const yMax = dv.getUint16(10, true);
  const hDpi = dv.getUint16(12, true);
  const vDpi = dv.getUint16(14, true);
  // egaPalette: bytes 16..63 (48 bytes)
  const egaPalette = input.slice(16, 64);
  const reservedByte64 = dv.getUint8(64);
  const nPlanesRaw = dv.getUint8(65);
  const bytesPerLine = dv.getUint16(66, true); // Trap #1: LE
  const paletteInfo = dv.getUint16(68, true);
  const hScreenSize = dv.getUint16(70, true);
  const vScreenSize = dv.getUint16(72, true);
  const reserved54 = input.slice(74, 128);

  // Step 3: validate magic, version, encoding, BPP, NPlanes, combination
  if (manufacturer !== PCX_MAGIC) {
    throw new PcxBadMagicError(manufacturer);
  }
  if (!isValidVersion(version)) {
    throw new PcxBadVersionError(version);
  }
  if (encoding !== PCX_ENCODING_RLE) {
    throw new PcxBadEncodingError(encoding);
  }
  if (!isValidNPlanes(nPlanesRaw)) {
    throw new PcxUnsupportedFeatureError(
      `NPlanes=${nPlanesRaw} is not supported; valid values are 1, 3, 4.`,
    );
  }
  const nPlanes = nPlanesRaw as PcxNPlanes;

  if (!isSupportedCombo(bitsPerPixelRaw, nPlanes)) {
    throw new PcxUnsupportedFeatureError(
      `(BitsPerPixel=${bitsPerPixelRaw}, NPlanes=${nPlanes}) is not a supported combination.`,
    );
  }
  const bitsPerPixel = bitsPerPixelRaw as PcxBitsPerPixel;

  // Step 4: compute width/height — Trap #2
  if (xMax < xMin) {
    throw new PcxBadHeaderError(`Xmax (${xMax}) < Xmin (${xMin}).`);
  }
  if (yMax < yMin) {
    throw new PcxBadHeaderError(`Ymax (${yMax}) < Ymin (${yMin}).`);
  }
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;

  if (width === 0 || height === 0) {
    throw new PcxBadHeaderError(`zero dimension: width=${width}, height=${height}.`);
  }

  // Step 5: validate BytesPerLine — Trap #3
  if (bytesPerLine % 2 !== 0) {
    throw new PcxBadHeaderError(`BytesPerLine (${bytesPerLine}) must be even.`);
  }
  const minBytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  if (bytesPerLine < minBytesPerLine) {
    throw new PcxBadHeaderError(
      `BytesPerLine (${bytesPerLine}) is less than minimum required (${minBytesPerLine}) for width=${width}, BPP=${bitsPerPixel}.`,
    );
  }

  // Step 6: validate dimension + pixel caps
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `PCX: dimension ${width}×${height} exceeds maximum ${MAX_DIM}×${MAX_DIM}.`,
    );
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXELS) {
    throw new ImagePixelCapError(`PCX: pixel count ${pixelCount} exceeds maximum ${MAX_PIXELS}.`);
  }
  const channels: 1 | 3 = nPlanes === 3 ? 3 : 1;
  const pixelByteCount = pixelCount * channels;
  if (pixelByteCount > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `PCX: pixel byte count ${pixelByteCount} exceeds maximum ${MAX_PIXEL_BYTES}.`,
    );
  }

  // Step 7: tail-check VGA palette footer — Trap #7
  // Only byte at EXACTLY fileLength−769 being 0x0C counts; no body scan.
  let vgaPalette: Uint8Array | null = null;
  let bodyEnd = input.length;

  if (version === 5 && input.length >= PCX_HEADER_SIZE + PCX_PALETTE_FOOTER_SIZE) {
    const sentinelOffset = input.length - PCX_PALETTE_FOOTER_SIZE;
    if ((input[sentinelOffset] ?? 0) === PCX_PALETTE_SENTINEL) {
      // Trap #7: only exact tail offset; do NOT scan body
      vgaPalette = input.slice(sentinelOffset + 1, sentinelOffset + 1 + PCX_VGA_PALETTE_SIZE);
      bodyEnd = sentinelOffset;
    }
  }

  // Step 8: allocate raw-raster buffer and decode RLE
  const expectedRasterBytes = height * nPlanes * bytesPerLine;
  if (expectedRasterBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `PCX: raw raster size ${expectedRasterBytes} exceeds maximum ${MAX_PIXEL_BYTES}.`,
    );
  }

  const rawRaster = decodePcxRle(input, PCX_HEADER_SIZE, bodyEnd, expectedRasterBytes);

  // Step 9: determine kind (after we know vgaPalette) — Trap #8
  const kind = determineKind(bitsPerPixel, nPlanes, vgaPalette !== null);

  // Step 10: de-planarise + strip pad per scanline — Traps #3, #4
  const pixelData = deplanarize(
    rawRaster,
    width,
    height,
    bitsPerPixel,
    nPlanes,
    bytesPerLine,
    kind,
  );

  // Step 11: build normalisations
  const normalisations: PcxNormalisation[] = ['rle-decoded-on-parse'];
  if (nPlanes > 1) {
    normalisations.push('planar-deinterleaved-to-packed-rgb');
  }
  if (bytesPerLine > minBytesPerLine) {
    normalisations.push('bytesperline-pad-bytes-stripped');
  }

  return {
    format: 'pcx',
    version: version as PcxVersion,
    kind,
    width,
    height,
    channels,
    bitDepth: 8,
    originalBitsPerPixel: bitsPerPixel,
    originalNPlanes: nPlanes,
    pixelData,
    egaPalette,
    vgaPalette,
    xMin,
    yMin,
    hDpi,
    vDpi,
    paletteInfo,
    hScreenSize,
    vScreenSize,
    reservedByte64,
    reserved54,
    normalisations,
  };
}

// ---------------------------------------------------------------------------
// RLE encoder — Trap #5, #6
// ---------------------------------------------------------------------------

/**
 * RLE-encode a single scanline (one plane's worth of bytesPerLine bytes).
 *
 * Trap #5: any byte ≥ 0xC0 must be encoded as a RUN even as a single pixel.
 * Trap #6: encoder resets RLE state at each scanline boundary (called per-scanline).
 * Max run = 63 (PCX_MAX_RUN).
 */
function encodePcxRleScanline(scanBytes: Uint8Array): Uint8Array {
  const chunks: number[] = [];
  let i = 0;
  const len = scanBytes.length;

  while (i < len) {
    const val = scanBytes[i] ?? 0;

    // Try to build a run
    let runLen = 1;
    while (runLen < PCX_MAX_RUN && i + runLen < len && (scanBytes[i + runLen] ?? 0) === val) {
      runLen++;
    }

    if (runLen > 1 || val >= 0xc0) {
      // Trap #5: must use RUN form for byte ≥ 0xC0 even when runLen === 1
      // RUN header: top 2 bits set, low 6 bits = count (1–63)
      chunks.push(0xc0 | runLen);
      chunks.push(val);
      i += runLen;
    } else {
      // Literal byte (0x00..0xBF)
      chunks.push(val);
      i++;
    }
  }

  return new Uint8Array(chunks);
}

// ---------------------------------------------------------------------------
// Re-planarize for serializer — Trap #4
// ---------------------------------------------------------------------------

/**
 * Convert decoded pixelData back into planar scanline format for the given kind.
 * Returns raw raster bytes: height × nPlanes × bytesPerLine.
 */
function replanarize(
  pixelData: Uint8Array,
  width: number,
  height: number,
  bitsPerPixel: PcxBitsPerPixel,
  nPlanes: PcxNPlanes,
  bytesPerLine: number,
  kind: PcxKind,
): Uint8Array {
  const rawRaster = new Uint8Array(height * nPlanes * bytesPerLine);

  if (kind === '24bit-truecolor') {
    // Interleaved RGB → planar [R][G][B] per scanline
    for (let y = 0; y < height; y++) {
      const scanBase = y * nPlanes * bytesPerLine;
      for (let x = 0; x < width; x++) {
        rawRaster[scanBase + x] = pixelData[y * width * 3 + x * 3] ?? 0; // R
        rawRaster[scanBase + bytesPerLine + x] = pixelData[y * width * 3 + x * 3 + 1] ?? 0; // G
        rawRaster[scanBase + 2 * bytesPerLine + x] = pixelData[y * width * 3 + x * 3 + 2] ?? 0; // B
      }
      // pad bytes are already 0 from Uint8Array initialisation
    }
    return rawRaster;
  }

  if (kind === '4bit-ega-planar') {
    // 4-bit EGA index → four bit-planes per scanline
    for (let y = 0; y < height; y++) {
      const scanBase = y * 4 * bytesPerLine;
      for (let x = 0; x < width; x++) {
        const idx = pixelData[y * width + x] ?? 0;
        const byteIdx = Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        for (let p = 0; p < 4; p++) {
          const bit = (idx >> p) & 1;
          const off = scanBase + p * bytesPerLine + byteIdx;
          rawRaster[off] = (rawRaster[off] ?? 0) | (bit << bitIdx);
        }
      }
    }
    return rawRaster;
  }

  if (kind === '1bit-bilevel') {
    for (let y = 0; y < height; y++) {
      const scanBase = y * bytesPerLine;
      for (let x = 0; x < width; x++) {
        const bit = (pixelData[y * width + x] ?? 0) & 1;
        const byteIdx = Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        const off = scanBase + byteIdx;
        rawRaster[off] = (rawRaster[off] ?? 0) | (bit << bitIdx);
      }
    }
    return rawRaster;
  }

  if (kind === '2bit-cga') {
    for (let y = 0; y < height; y++) {
      const scanBase = y * bytesPerLine;
      for (let x = 0; x < width; x++) {
        const val = (pixelData[y * width + x] ?? 0) & 0x03;
        const byteIdx = Math.floor((x * 2) / 8);
        const shift = 6 - ((x * 2) % 8);
        const off = scanBase + byteIdx;
        rawRaster[off] = (rawRaster[off] ?? 0) | (val << shift);
      }
    }
    return rawRaster;
  }

  if (kind === '4bit-ega-packed') {
    for (let y = 0; y < height; y++) {
      const scanBase = y * bytesPerLine;
      for (let x = 0; x < width; x++) {
        const val = (pixelData[y * width + x] ?? 0) & 0x0f;
        const byteIdx = Math.floor(x / 2);
        const off = scanBase + byteIdx;
        if (x % 2 === 0) {
          rawRaster[off] = (rawRaster[off] ?? 0) | (val << 4);
        } else {
          rawRaster[off] = (rawRaster[off] ?? 0) | val;
        }
      }
    }
    return rawRaster;
  }

  // 8-bit indexed or grayscale
  for (let y = 0; y < height; y++) {
    const scanBase = y * bytesPerLine;
    for (let x = 0; x < width; x++) {
      rawRaster[scanBase + x] = pixelData[y * width + x] ?? 0;
    }
    // Trap #3: pad bytes remain 0
  }
  return rawRaster;
}

// ---------------------------------------------------------------------------
// Main serializer
// ---------------------------------------------------------------------------

export function serializePcx(file: PcxFile): Uint8Array {
  const { width, height } = file;
  const bitsPerPixel = file.originalBitsPerPixel;
  const nPlanes = file.originalNPlanes;

  // Step 1: recompute bytesPerLine = even minimum — Trap #3
  const minBpl = Math.ceil((width * bitsPerPixel) / 8);
  const bytesPerLine = minBpl % 2 === 0 ? minBpl : minBpl + 1;

  // Step 2: re-planarize pixelData + zero-pad per scanline
  const rawRaster = replanarize(
    file.pixelData,
    width,
    height,
    bitsPerPixel,
    nPlanes,
    bytesPerLine,
    file.kind,
  );

  // Step 3: RLE-encode per plane per scanline — Trap #5, #6
  const rleChunks: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    for (let p = 0; p < nPlanes; p++) {
      const scanOffset = (y * nPlanes + p) * bytesPerLine;
      const scanSlice = rawRaster.subarray(scanOffset, scanOffset + bytesPerLine);
      rleChunks.push(encodePcxRleScanline(scanSlice));
    }
  }

  const rleBody = concatUint8Arrays(rleChunks);

  // Step 5: calculate total size
  const hasVgaPalette = file.vgaPalette !== null;
  const footerSize = hasVgaPalette ? PCX_PALETTE_FOOTER_SIZE : 0;
  const totalSize = PCX_HEADER_SIZE + rleBody.length + footerSize;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  // Step 6: write 128-byte header (always v5 on serialize)
  dv.setUint8(0, PCX_MAGIC); // Manufacturer
  dv.setUint8(1, 5); // Version = 5 always
  dv.setUint8(2, PCX_ENCODING_RLE); // Encoding = 1 (RLE)
  dv.setUint8(3, bitsPerPixel); // BitsPerPixel
  dv.setUint16(4, file.xMin, true); // Xmin — Trap #1: LE
  dv.setUint16(6, file.yMin, true); // Ymin
  dv.setUint16(8, file.xMin + width - 1, true); // Xmax
  dv.setUint16(10, file.yMin + height - 1, true); // Ymax
  dv.setUint16(12, file.hDpi, true); // HDpi
  dv.setUint16(14, file.vDpi, true); // VDpi
  out.set(file.egaPalette.subarray(0, PCX_EGA_PALETTE_SIZE), 16); // EGA palette
  dv.setUint8(64, file.reservedByte64); // Reserved (verbatim)
  dv.setUint8(65, nPlanes); // NPlanes
  dv.setUint16(66, bytesPerLine, true); // BytesPerLine — Trap #1: LE
  dv.setUint16(68, file.paletteInfo, true); // PaletteInfo
  dv.setUint16(70, file.hScreenSize, true); // HScreenSize
  dv.setUint16(72, file.vScreenSize, true); // VScreenSize
  out.set(file.reserved54.subarray(0, 54), 74); // Reserved 54 bytes (verbatim)

  // Step 7: write RLE body
  out.set(rleBody, PCX_HEADER_SIZE);

  // Step 8: append VGA palette footer if present — Trap #7
  if (hasVgaPalette && file.vgaPalette !== null) {
    const footerOffset = PCX_HEADER_SIZE + rleBody.length;
    dv.setUint8(footerOffset, PCX_PALETTE_SENTINEL); // 0x0C sentinel
    out.set(file.vgaPalette.subarray(0, PCX_VGA_PALETTE_SIZE), footerOffset + 1);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
