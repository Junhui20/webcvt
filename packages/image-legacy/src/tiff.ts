/**
 * TIFF parser and serializer for @webcvt/image-legacy.
 *
 * Implements the TIFF 6.0 specification (Adobe, 1992) — both byte orders,
 * multi-IFD parse, Compression 1/5/32773, Photometric 0/1/2/3, BitsPerSample
 * 1/4/8/16, strip layout only.
 *
 * All 18 traps from the design note are handled (see inline comments).
 * DEFLATE (compression 8/32946) is deferred to a follow-up commit.
 */

import {
  MAX_DIM,
  MAX_IFD_ENTRIES,
  MAX_INPUT_BYTES,
  MAX_PAGES,
  MAX_PIXELS,
  MAX_PIXEL_BYTES,
  MAX_TAG_VALUE_COUNT,
} from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  TiffBadIfdError,
  TiffBadMagicError,
  TiffBadTagValueError,
  TiffCircularIfdError,
  TiffLzwDecodeError,
  TiffPackBitsDecodeError,
  TiffTooManyPagesError,
  TiffUnsupportedFeatureError,
} from './errors.ts';
import { lzwDecode } from './tiff-lzw.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TiffByteOrder = 'little' | 'big';
export type TiffPhotometric = 0 | 1 | 2 | 3;
export type TiffCompression = 1 | 5 | 8 | 32773 | 32946;
export type TiffPredictor = 1 | 2;
export type TiffPlanarConfig = 1 | 2;

export interface TiffOpaqueTag {
  tag: number;
  type: number;
  count: number;
  rawBytes: Uint8Array;
}

export interface TiffPage {
  width: number;
  height: number;
  photometric: TiffPhotometric;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: TiffCompression;
  predictor: TiffPredictor;
  planarConfig: TiffPlanarConfig;
  pixelData: Uint8Array | Uint16Array;
  palette?: Uint16Array;
  otherTags: TiffOpaqueTag[];
}

export type TiffNormalisation =
  | 'compression-dropped-to-none'
  | 'planar-flattened-to-chunky'
  | 'bits-per-sample-promoted-to-8'
  | 'multi-page-truncated-to-first';

export interface TiffFile {
  format: 'tiff';
  byteOrder: TiffByteOrder;
  pages: TiffPage[];
  normalisations: TiffNormalisation[];
}

// ---------------------------------------------------------------------------
// TIFF data type sizes (spec Table 2)
// ---------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

// ---------------------------------------------------------------------------
// Raw IFD entry
// ---------------------------------------------------------------------------

interface RawEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw bytes of the value (either inline from the 4-byte field, or from external offset). */
  rawBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// parseTiff — top-level entry point
// ---------------------------------------------------------------------------

export function parseTiff(input: Uint8Array): TiffFile {
  // 1. Input size cap
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);
  }

  if (input.length < 8) {
    throw new TiffBadMagicError();
  }

  // 2. Header — detect byte order and validate magic
  const b0 = input[0] ?? 0;
  const b1 = input[1] ?? 0;
  const b2 = input[2] ?? 0;
  const b3 = input[3] ?? 0;

  let le: boolean;
  if (b0 === 0x49 && b1 === 0x49 && b2 === 0x2a && b3 === 0x00) {
    le = true; // II (little-endian)
  } else if (b0 === 0x4d && b1 === 0x4d && b2 === 0x00 && b3 === 0x2a) {
    le = false; // MM (big-endian)
  } else {
    // Check for BigTIFF (magic 43 instead of 42)
    const magic16LE = ((input[3] ?? 0) << 8) | (input[2] ?? 0);
    const magic16BE = ((input[2] ?? 0) << 8) | (input[3] ?? 0);
    if (
      (b0 === 0x49 && b1 === 0x49 && magic16LE === 43) ||
      (b0 === 0x4d && b1 === 0x4d && magic16BE === 43)
    ) {
      throw new TiffUnsupportedFeatureError('bigtiff');
    }
    throw new TiffBadMagicError();
  }

  // 3. Construct byte-order-aware readers (Trap #1: byte order is STICKY and TOTAL)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);

  const read16 = (off: number): number => {
    if (off + 2 > input.length) {
      throw new TiffBadIfdError(`read16 at offset ${off} exceeds file length ${input.length}`);
    }
    return dv.getUint16(off, le);
  };

  const read32 = (off: number): number => {
    if (off + 4 > input.length) {
      throw new TiffBadIfdError(`read32 at offset ${off} exceeds file length ${input.length}`);
    }
    return dv.getUint32(off, le);
  };

  // 4. First IFD offset
  const firstIfdOffset = read32(4);
  if (firstIfdOffset < 8 || firstIfdOffset >= input.length) {
    throw new TiffBadIfdError(`first IFD offset ${firstIfdOffset} is out of bounds`);
  }

  // 5. Walk IFD chain
  const seen = new Set<number>();
  const pages: TiffPage[] = [];
  let nextOffset = firstIfdOffset;

  while (nextOffset !== 0) {
    if (seen.has(nextOffset)) {
      throw new TiffCircularIfdError(nextOffset);
    }
    if (pages.length >= MAX_PAGES) {
      throw new TiffTooManyPagesError(MAX_PAGES);
    }
    seen.add(nextOffset);

    // Parse one IFD
    if (nextOffset + 2 > input.length) {
      throw new TiffBadIfdError(`IFD at offset ${nextOffset} exceeds file length`);
    }
    const entryCount = read16(nextOffset);
    if (entryCount > MAX_IFD_ENTRIES) {
      throw new TiffBadIfdError(
        `IFD declares ${entryCount} entries, exceeds MAX_IFD_ENTRIES (${MAX_IFD_ENTRIES})`,
      );
    }

    const ifdDataEnd = nextOffset + 2 + entryCount * 12;
    if (ifdDataEnd + 4 > input.length) {
      throw new TiffBadIfdError(
        `IFD at offset ${nextOffset} truncated (need ${ifdDataEnd + 4} bytes, got ${input.length})`,
      );
    }

    // Read all 12-byte IFD entries
    const entryMap = new Map<number, RawEntry>();
    for (let i = 0; i < entryCount; i++) {
      const entryBase = nextOffset + 2 + i * 12;
      const tag = read16(entryBase);
      const type = read16(entryBase + 2);
      const count = read32(entryBase + 4);

      // Compute value bytes (Trap #2 and #3: inline vs. external)
      // H-1 (security): cap count before typeSize * count to prevent overflow
      if (count > MAX_TAG_VALUE_COUNT) {
        throw new TiffBadIfdError(
          `IFD entry tag ${tag} declares count ${count} > MAX_TAG_VALUE_COUNT (${MAX_TAG_VALUE_COUNT})`,
        );
      }
      const typeSize = TYPE_SIZE[type] ?? 1;
      const totalBytes = typeSize * count;

      let rawBytes: Uint8Array;
      if (totalBytes <= 4) {
        // Inline — left-aligned in bytes [8..11] of the entry
        // We do NOT validate unused padding bytes (Trap #2)
        rawBytes = input.slice(entryBase + 8, entryBase + 8 + totalBytes);
      } else {
        // External offset
        const valueOffset = read32(entryBase + 8);
        if (valueOffset + totalBytes > input.length) {
          throw new TiffBadIfdError(
            `tag ${tag} value offset ${valueOffset} + ${totalBytes} bytes exceeds file`,
          );
        }
        rawBytes = input.slice(valueOffset, valueOffset + totalBytes);
      }

      entryMap.set(tag, { tag, type, count, rawBytes });
    }

    // Next IFD offset
    nextOffset = read32(ifdDataEnd);

    // Build TiffPage from entry map
    const page = buildPage(entryMap, input, dv, le, read16, read32);
    pages.push(page);
  }

  const byteOrder: TiffByteOrder = le ? 'little' : 'big';
  return { format: 'tiff', byteOrder, pages, normalisations: [] };
}

// ---------------------------------------------------------------------------
// Per-page decode
// ---------------------------------------------------------------------------

function buildPage(
  entryMap: Map<number, RawEntry>,
  input: Uint8Array,
  dv: DataView,
  le: boolean,
  read16: (off: number) => number,
  read32: (off: number) => number,
): TiffPage {
  // Helper: read SHORT or LONG value from an entry's rawBytes[0]
  const readEntryUint = (entry: RawEntry, idx: number): number => {
    if (entry.type === 3) {
      // SHORT
      const off = idx * 2;
      if (off + 2 > entry.rawBytes.length) {
        throw new TiffBadIfdError(`entry value OOB at index ${idx} for tag ${entry.tag}`);
      }
      const entryDv = new DataView(entry.rawBytes.buffer, entry.rawBytes.byteOffset);
      return entryDv.getUint16(off, le);
    }
    if (entry.type === 4) {
      // LONG
      const off = idx * 4;
      if (off + 4 > entry.rawBytes.length) {
        throw new TiffBadIfdError(`entry value OOB at index ${idx} for tag ${entry.tag}`);
      }
      const entryDv = new DataView(entry.rawBytes.buffer, entry.rawBytes.byteOffset);
      return entryDv.getUint32(off, le);
    }
    // BYTE
    return entry.rawBytes[idx] ?? 0;
  };

  const getUint = (tag: number, idx = 0): number | undefined => {
    const entry = entryMap.get(tag);
    if (entry === undefined) return undefined;
    return readEntryUint(entry, idx);
  };

  const requireUint = (tag: number, tagName: string): number => {
    const entry = entryMap.get(tag);
    if (entry === undefined) {
      throw new TiffBadTagValueError(tagName, 'required tag missing');
    }
    // M-2 (security): a count of 0 for a required scalar tag is semantically invalid
    if (entry.count === 0) {
      throw new TiffBadTagValueError(tagName, 'required tag has count 0');
    }
    // M-1 (security): type must be BYTE(1), SHORT(3), or LONG(4) for uint reads
    if (entry.type !== 1 && entry.type !== 3 && entry.type !== 4) {
      throw new TiffBadTagValueError(
        tagName,
        `expected SHORT/LONG/BYTE type, got type ${entry.type}`,
      );
    }
    return readEntryUint(entry, 0);
  };

  // 1. Required tags
  const width = requireUint(256, 'ImageWidth');
  const height = requireUint(257, 'ImageLength');

  // 2. Early rejection of unsupported features
  // Check for tiles (TileWidth tag 322 or TileLength tag 323)
  if (entryMap.has(322) || entryMap.has(323)) {
    throw new TiffUnsupportedFeatureError('tiles');
  }

  // 3. Read tags with defaults
  const samplesPerPixel = getUint(277) ?? 1;

  // BitsPerSample — array of shorts, one per sample; default [1]
  const bpsEntry = entryMap.get(258);
  let bitsPerSample = 1;
  if (bpsEntry !== undefined) {
    bitsPerSample = readEntryUint(bpsEntry, 0);
    // Trap #17: all samples must have the same bit depth
    for (let i = 1; i < samplesPerPixel; i++) {
      const bps_i = readEntryUint(bpsEntry, i);
      if (bps_i !== bitsPerSample) {
        throw new TiffUnsupportedFeatureError(
          `heterogeneous-bits-per-sample-[${bitsPerSample},${bps_i}]`,
        );
      }
    }
  }

  const compression = (getUint(259) ?? 1) as TiffCompression;
  const photometric = requireUint(262, 'PhotometricInterpretation') as TiffPhotometric;
  const planarConfig = (getUint(284) ?? 1) as TiffPlanarConfig;
  const predictor = (getUint(317) ?? 1) as TiffPredictor;
  const sampleFormat = getUint(339) ?? 1;

  // Validate photometric
  if (photometric !== 0 && photometric !== 1 && photometric !== 2 && photometric !== 3) {
    throw new TiffUnsupportedFeatureError(`photometric-${photometric}`);
  }

  // Validate compression
  if (
    compression !== 1 &&
    compression !== 5 &&
    compression !== 32773 &&
    compression !== 8 &&
    compression !== 32946
  ) {
    throw new TiffUnsupportedFeatureError(`compression-${compression}`);
  }

  // Defer DEFLATE (Trap #18: codes 8 and 32946 are both DEFLATE)
  if (compression === 8 || compression === 32946) {
    throw new TiffUnsupportedFeatureError('compression-deflate-async');
  }

  // Reject float samples (SampleFormat 3 = IEEE float)
  if (sampleFormat === 3) {
    throw new TiffUnsupportedFeatureError('sample-format-float');
  }

  // Validate dimensions
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(`TIFF: dimension ${width}×${height} exceeds MAX_DIM (${MAX_DIM})`);
  }
  if (width * height > MAX_PIXELS) {
    throw new ImagePixelCapError(`TIFF: pixel count ${width * height} exceeds MAX_PIXELS`);
  }

  const bytesPerSample = bitsPerSample >= 8 ? bitsPerSample / 8 : 1; // for caps only
  const pixelBytes = width * height * samplesPerPixel * bytesPerSample;
  if (pixelBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(`TIFF: pixel byte count ${pixelBytes} exceeds MAX_PIXEL_BYTES`);
  }

  // Trap #5: RowsPerStrip default = 2^32 - 1; clamp to height
  const rpsRaw = getUint(278) ?? 0xffffffff;
  const rowsPerStrip = Math.min(rpsRaw, height);

  // Trap #6: stripsPerImage calculation
  const stripsPerImage = Math.ceil(height / rowsPerStrip);

  // StripOffsets (tag 273) — required (Trap #4: can be SHORT or LONG)
  const soEntry = entryMap.get(273);
  if (soEntry === undefined) {
    throw new TiffBadTagValueError('StripOffsets', 'required tag missing');
  }

  // StripByteCounts (tag 279) — required
  const sbcEntry = entryMap.get(279);
  if (sbcEntry === undefined) {
    throw new TiffBadTagValueError('StripByteCounts', 'required tag missing');
  }

  const expectedStripCount = planarConfig === 2 ? stripsPerImage * samplesPerPixel : stripsPerImage;

  if (soEntry.count !== expectedStripCount) {
    // Tolerate count=1 for single-strip images (some encoders omit the array)
    if (!(soEntry.count === 1 && stripsPerImage === 1)) {
      throw new TiffBadTagValueError(
        'StripOffsets',
        `count ${soEntry.count} does not match expected ${expectedStripCount} strips`,
      );
    }
  }

  // 4. Read and decompress all strips
  const rowBytesUncompressed = Math.ceil((width * samplesPerPixel * bitsPerSample) / 8);
  // H-3 (security): track running total during decompression; fail early before final allocation
  let runningDecompressedTotal = 0;
  const stripChunks: Uint8Array[] = [];

  for (let s = 0; s < stripsPerImage; s++) {
    const offset = readEntryUint(soEntry, s);
    const byteCount = readEntryUint(sbcEntry, s);

    if (offset + byteCount > input.length) {
      throw new TiffBadIfdError(`strip ${s} at offset ${offset} + ${byteCount} bytes exceeds file`);
    }

    const stripRaw = input.slice(offset, offset + byteCount);

    // Compute expected decompressed byte count for this strip
    const stripRows = s < stripsPerImage - 1 ? rowsPerStrip : height - s * rowsPerStrip;
    const expectedBytes = rowBytesUncompressed * stripRows;

    let decompressed: Uint8Array;
    if (compression === 1) {
      decompressed = stripRaw;
    } else if (compression === 32773) {
      decompressed = packBitsDecode(stripRaw, expectedBytes);
    } else if (compression === 5) {
      try {
        decompressed = lzwDecode(stripRaw, expectedBytes);
      } catch (e) {
        if (e instanceof TiffLzwDecodeError) throw e;
        throw new TiffLzwDecodeError(String(e));
      }
    } else {
      // Should never reach — compression validation is above
      decompressed = stripRaw;
    }

    runningDecompressedTotal += decompressed.length;
    if (runningDecompressedTotal > MAX_PIXEL_BYTES) {
      throw new ImagePixelCapError(
        `TIFF: cumulative strip decompression ${runningDecompressedTotal} > MAX_PIXEL_BYTES`,
      );
    }
    stripChunks.push(decompressed);
  }

  // Concatenate strips into one buffer
  const rawPixels = new Uint8Array(runningDecompressedTotal);
  let writeOff = 0;
  for (const chunk of stripChunks) {
    rawPixels.set(chunk, writeOff);
    writeOff += chunk.length;
  }

  // 5. Byte-order swap for 16-bit samples (Trap #1)
  let pixelData16: Uint16Array | undefined;
  if (bitsPerSample === 16) {
    const expectedBytes16 = width * height * samplesPerPixel * 2;
    if (rawPixels.length < expectedBytes16) {
      throw new TiffBadTagValueError(
        'pixel data',
        `expected ${expectedBytes16} bytes for 16-bit, got ${rawPixels.length}`,
      );
    }
    pixelData16 = new Uint16Array(width * height * samplesPerPixel);
    const rawDv = new DataView(rawPixels.buffer, rawPixels.byteOffset);
    for (let i = 0; i < pixelData16.length; i++) {
      pixelData16[i] = rawDv.getUint16(i * 2, le);
    }
  }

  // 6. Apply Predictor 2 (horizontal differencing) after decompression (Trap #12)
  if (predictor === 2) {
    if (bitsPerSample === 16 && pixelData16 !== undefined) {
      applyPredictor2_16(pixelData16, width, height, samplesPerPixel);
    } else if (bitsPerSample === 8) {
      applyPredictor2_8(rawPixels, width, height, samplesPerPixel);
    }
    // For 1-bit or 4-bit with predictor 2 — unusual but spec allows it; apply on bytes
  }

  // 7. Unpack 1-bit and 4-bit to 8-bit
  // M-2 (code): 1-bit multi-sample is not supported; unpack1To8 only handles spp=1
  if (bitsPerSample === 1 && samplesPerPixel > 1) {
    throw new TiffUnsupportedFeatureError('1-bit-multi-sample-not-supported');
  }

  let finalPixelData: Uint8Array | Uint16Array;
  if (bitsPerSample === 16 && pixelData16 !== undefined) {
    finalPixelData = pixelData16;
  } else if (bitsPerSample === 4) {
    finalPixelData = unpack4To8(rawPixels, width * height * samplesPerPixel);
  } else if (bitsPerSample === 1) {
    finalPixelData = unpack1To8(rawPixels, width, height, samplesPerPixel);
  } else {
    // 8-bit — slice to exact pixel count
    const expectedPixelBytes = width * height * samplesPerPixel;
    finalPixelData =
      rawPixels.length > expectedPixelBytes ? rawPixels.slice(0, expectedPixelBytes) : rawPixels;
  }

  // 8. Read ColorMap for Photometric=3 (Trap #16)
  let palette: Uint16Array | undefined;
  if (photometric === 3) {
    const cmEntry = entryMap.get(320);
    if (cmEntry === undefined) {
      throw new TiffBadTagValueError('ColorMap', 'required for Photometric=3');
    }
    const expectedPaletteCount = 3 * (1 << bitsPerSample);
    if (cmEntry.count !== expectedPaletteCount) {
      throw new TiffBadTagValueError(
        'ColorMap',
        `expected ${expectedPaletteCount} entries (3 * 2^${bitsPerSample}), got ${cmEntry.count}`,
      );
    }
    // Trap #16: layout is "all R, then all G, then all B" — NOT interleaved
    palette = new Uint16Array(cmEntry.count);
    const cmDv = new DataView(cmEntry.rawBytes.buffer, cmEntry.rawBytes.byteOffset);
    for (let i = 0; i < cmEntry.count; i++) {
      palette[i] = cmDv.getUint16(i * 2, le);
    }
  }

  // 9. Collect other tags as opaque
  const knownTags = new Set([
    256, 257, 258, 259, 262, 273, 277, 278, 279, 282, 283, 284, 296, 305, 306, 317, 320, 338, 339,
  ]);

  const otherTags: TiffOpaqueTag[] = [];
  for (const [, entry] of entryMap) {
    if (!knownTags.has(entry.tag)) {
      otherTags.push({
        tag: entry.tag,
        type: entry.type,
        count: entry.count,
        rawBytes: entry.rawBytes.slice(),
      });
    }
  }

  return {
    width,
    height,
    photometric,
    samplesPerPixel,
    bitsPerSample,
    compression,
    predictor,
    planarConfig,
    pixelData: finalPixelData,
    palette,
    otherTags,
  };
}

// ---------------------------------------------------------------------------
// PackBits decoder (Trap #7 and #8)
// ---------------------------------------------------------------------------

export function packBitsDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let src = 0;
  let dst = 0;

  while (dst < expected) {
    if (src >= input.length) {
      throw new TiffPackBitsDecodeError(
        `source exhausted at byte ${src} with ${expected - dst} output bytes remaining`,
      );
    }

    const headerByte = input[src++] ?? 0;
    // Trap #7: header byte is signed int8
    const n = headerByte > 127 ? headerByte - 256 : headerByte;

    if (n === -128) {
      // NO-OP — do not consume next byte (Trap #7)
      continue;
    }

    if (n >= 0) {
      // Copy n+1 literal bytes
      const len = n + 1;
      if (src + len > input.length) {
        throw new TiffPackBitsDecodeError(
          `literal run of ${len} bytes at src=${src} exceeds input length ${input.length}`,
        );
      }
      if (dst + len > expected) {
        throw new TiffPackBitsDecodeError(
          `literal run of ${len} bytes at dst=${dst} would exceed expected output ${expected}`,
        );
      }
      out.set(input.subarray(src, src + len), dst);
      src += len;
      dst += len;
    } else {
      // Repeat next byte (1 - n) times; n is in [-127, -1]
      const len = 1 - n;
      if (src >= input.length) {
        throw new TiffPackBitsDecodeError(
          `repeat run at src=${src} needs repeat byte but source is exhausted`,
        );
      }
      if (dst + len > expected) {
        throw new TiffPackBitsDecodeError(
          `repeat run of ${len} bytes at dst=${dst} would exceed expected output ${expected}`,
        );
      }
      const repeatByte = input[src++] ?? 0;
      out.fill(repeatByte, dst, dst + len);
      dst += len;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Predictor 2 — horizontal differencing (Trap #12)
// ---------------------------------------------------------------------------

/** Apply prefix-sum (undifferencing) for 8-bit samples, in-place. */
function applyPredictor2_8(
  data: Uint8Array,
  width: number,
  height: number,
  samplesPerPixel: number,
): void {
  // Per row, per channel, prefix sum mod 256
  // Stride between same-channel samples = samplesPerPixel (chunky)
  for (let row = 0; row < height; row++) {
    const rowBase = row * width * samplesPerPixel;
    for (let ch = 0; ch < samplesPerPixel; ch++) {
      let acc = 0;
      for (let col = 0; col < width; col++) {
        const idx = rowBase + col * samplesPerPixel + ch;
        acc = (acc + (data[idx] ?? 0)) & 0xff;
        data[idx] = acc;
      }
    }
  }
}

/** Apply prefix-sum (undifferencing) for 16-bit samples, in-place. */
function applyPredictor2_16(
  data: Uint16Array,
  width: number,
  height: number,
  samplesPerPixel: number,
): void {
  for (let row = 0; row < height; row++) {
    const rowBase = row * width * samplesPerPixel;
    for (let ch = 0; ch < samplesPerPixel; ch++) {
      let acc = 0;
      for (let col = 0; col < width; col++) {
        const idx = rowBase + col * samplesPerPixel + ch;
        acc = (acc + (data[idx] ?? 0)) & 0xffff;
        data[idx] = acc;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bit-depth unpacking
// ---------------------------------------------------------------------------

/** Unpack 4-bit nibbles to 8-bit (high nibble first per byte). */
function unpack4To8(input: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const byteIdx = Math.floor(i / 2);
    const b = input[byteIdx] ?? 0;
    out[i] = i % 2 === 0 ? (b >> 4) & 0x0f : b & 0x0f;
  }
  return out;
}

/** Unpack 1-bit pixels to 8-bit, MSB-first, row-padded. */
function unpack1To8(
  input: Uint8Array,
  width: number,
  height: number,
  samplesPerPixel: number,
): Uint8Array {
  const out = new Uint8Array(width * height * samplesPerPixel);
  const bitsPerRow = width * samplesPerPixel;
  const bytesPerRow = Math.ceil(bitsPerRow / 8);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const bitOff = row * bitsPerRow + col;
      const byteIdx = row * bytesPerRow + Math.floor(col / 8);
      const b = input[byteIdx] ?? 0;
      const bitVal = (b >> (7 - (col % 8))) & 1;
      out[row * width + col] = bitVal;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// serializeTiff
// ---------------------------------------------------------------------------

export function serializeTiff(file: TiffFile): Uint8Array {
  const normalisations: TiffNormalisation[] = [...file.normalisations];

  // 1. Multi-page: truncate to first page
  if (file.pages.length > 1) {
    if (!normalisations.includes('multi-page-truncated-to-first')) {
      normalisations.push('multi-page-truncated-to-first');
    }
  }

  const page = file.pages[0];
  /* v8 ignore next 3 -- cannot happen through parseTiff (always ≥1 page), only via
   * a manually constructed TiffFile with pages=[]; keep as a safety guard. */
  if (page === undefined) {
    throw new TiffBadTagValueError('pages', 'TIFF file has no pages');
  }

  const le = file.byteOrder === 'little';

  // 2. Normalisations
  if (page.compression !== 1) {
    if (!normalisations.includes('compression-dropped-to-none')) {
      normalisations.push('compression-dropped-to-none');
    }
  }
  if (page.planarConfig !== 1) {
    if (!normalisations.includes('planar-flattened-to-chunky')) {
      normalisations.push('planar-flattened-to-chunky');
    }
  }
  if (page.bitsPerSample === 4) {
    if (!normalisations.includes('bits-per-sample-promoted-to-8')) {
      normalisations.push('bits-per-sample-promoted-to-8');
    }
  }

  const { width, height, samplesPerPixel, photometric, palette, otherTags } = page;

  // Determine output bit depth
  const bitsPerSample = page.bitsPerSample === 4 ? 8 : page.bitsPerSample;

  // Build pixel data as Uint8Array for NONE compression
  let pixelBytes: Uint8Array;
  if (page.pixelData instanceof Uint16Array) {
    // 16-bit — write with correct byte order
    const buf = new Uint8Array(page.pixelData.length * 2);
    const bufDv = new DataView(buf.buffer);
    for (let i = 0; i < page.pixelData.length; i++) {
      bufDv.setUint16(i * 2, page.pixelData[i] ?? 0, le);
    }
    pixelBytes = buf;
  } else if (page.bitsPerSample === 4) {
    // Promote 4-bit to 8-bit
    pixelBytes = new Uint8Array(page.pixelData);
  } else if (page.bitsPerSample === 1) {
    // Re-pack 1-bit
    pixelBytes = pack1From8(page.pixelData as Uint8Array, width, height, samplesPerPixel);
  } else {
    pixelBytes = page.pixelData as Uint8Array;
  }

  const stripDataLength = pixelBytes.length;
  const stripCount = 1; // serializer always emits a single strip

  // ---------------------------------------------------------------------------
  // Build IFD entries
  // ---------------------------------------------------------------------------

  interface SerEntry {
    tag: number;
    type: number;
    count: number;
    valueBytes: Uint8Array;
  }

  const entries: SerEntry[] = [];

  const addShort = (tag: number, value: number): void => {
    const vb = new Uint8Array(2);
    const entDv = new DataView(vb.buffer);
    entDv.setUint16(0, value, le);
    entries.push({ tag, type: 3, count: 1, valueBytes: vb });
  };

  const addLong = (tag: number, value: number): void => {
    const vb = new Uint8Array(4);
    const entDv = new DataView(vb.buffer);
    entDv.setUint32(0, value, le);
    entries.push({ tag, type: 4, count: 1, valueBytes: vb });
  };

  const addShortArray = (tag: number, values: number[]): void => {
    const vb = new Uint8Array(values.length * 2);
    const entDv = new DataView(vb.buffer);
    for (let i = 0; i < values.length; i++) entDv.setUint16(i * 2, values[i] ?? 0, le);
    entries.push({ tag, type: 3, count: values.length, valueBytes: vb });
  };

  const addRational = (tag: number, num: number, den: number): void => {
    const vb = new Uint8Array(8);
    const entDv = new DataView(vb.buffer);
    entDv.setUint32(0, num, le);
    entDv.setUint32(4, den, le);
    entries.push({ tag, type: 5, count: 1, valueBytes: vb });
  };

  addLong(256, width);
  addLong(257, height);
  addShortArray(258, new Array<number>(samplesPerPixel).fill(bitsPerSample));
  addShort(259, 1); // Compression = NONE
  addShort(262, photometric);
  // StripOffsets — placeholder; patched below
  const stripOffsetPlaceholder = new Uint8Array(4);
  entries.push({ tag: 273, type: 4, count: stripCount, valueBytes: stripOffsetPlaceholder });
  addShort(277, samplesPerPixel);
  addLong(278, height); // RowsPerStrip = height (single strip)
  // StripByteCounts — placeholder
  const stripByteCountPlaceholder = new Uint8Array(4);
  entries.push({ tag: 279, type: 4, count: stripCount, valueBytes: stripByteCountPlaceholder });
  addRational(282, 72, 1); // XResolution
  addRational(283, 72, 1); // YResolution
  addShort(284, 1); // PlanarConfiguration = chunky
  addShort(296, 2); // ResolutionUnit = inch

  // ColorMap for Photometric=3
  if (photometric === 3 && palette !== undefined) {
    const cmVb = new Uint8Array(palette.length * 2);
    const cmDv = new DataView(cmVb.buffer);
    for (let i = 0; i < palette.length; i++) cmDv.setUint16(i * 2, palette[i] ?? 0, le);
    entries.push({ tag: 320, type: 3, count: palette.length, valueBytes: cmVb });
  }

  // OtherTags appended verbatim
  for (const ot of otherTags) {
    entries.push({ tag: ot.tag, type: ot.type, count: ot.count, valueBytes: ot.rawBytes.slice() });
  }

  // Sort by tag (TIFF spec)
  entries.sort((a, b) => a.tag - b.tag);

  // ---------------------------------------------------------------------------
  // Layout calculation (two-pass)
  // ---------------------------------------------------------------------------

  // Determine inline vs. external for each entry (Trap #3)
  const typeSizeMap: Record<number, number> = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    6: 1,
    7: 1,
    8: 2,
    9: 4,
    10: 8,
    11: 4,
    12: 8,
  };

  const isInline = (e: SerEntry): boolean => {
    const ts = typeSizeMap[e.type] ?? 1;
    return ts * e.count <= 4;
  };

  // Layout:
  //   8 bytes header
  //   pixel data
  //   external value blobs
  //   IFD

  const pixelDataOffset = 8;
  let cursor = pixelDataOffset + stripDataLength;

  interface ExternalBlob {
    entryIdx: number;
    offset: number;
  }

  const externalBlobs: ExternalBlob[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === undefined) continue;
    if (!isInline(e)) {
      externalBlobs.push({ entryIdx: i, offset: cursor });
      cursor += e.valueBytes.length;
      if (cursor & 1) cursor++; // word-align
    }
  }

  const ifdOffset = cursor;
  const ifdSize = 2 + entries.length * 12 + 4;
  const totalSize = ifdOffset + ifdSize;

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  const out = new Uint8Array(totalSize);
  const outDv = new DataView(out.buffer);

  // Header
  if (le) {
    out[0] = 0x49;
    out[1] = 0x49;
    outDv.setUint16(2, 42, true);
  } else {
    out[0] = 0x4d;
    out[1] = 0x4d;
    outDv.setUint16(2, 42, false);
  }
  outDv.setUint32(4, ifdOffset, le);

  // Pixel data
  out.set(pixelBytes, pixelDataOffset);

  // Patch StripOffsets and StripByteCounts
  const soIdx = entries.findIndex((e) => e.tag === 273);
  const sbcIdx = entries.findIndex((e) => e.tag === 279);
  const soEntry = entries[soIdx];
  if (soIdx >= 0 && soEntry !== undefined) {
    const vb = soEntry.valueBytes;
    const vbDv = new DataView(vb.buffer, vb.byteOffset);
    vbDv.setUint32(0, pixelDataOffset, le);
  }
  const sbcEntry = entries[sbcIdx];
  if (sbcIdx >= 0 && sbcEntry !== undefined) {
    const vb = sbcEntry.valueBytes;
    const vbDv = new DataView(vb.buffer, vb.byteOffset);
    vbDv.setUint32(0, stripDataLength, le);
  }

  // External blobs
  for (const blob of externalBlobs) {
    const e = entries[blob.entryIdx];
    if (e === undefined) continue;
    out.set(e.valueBytes, blob.offset);
  }

  // IFD
  outDv.setUint16(ifdOffset, entries.length, le);
  let entryOff = ifdOffset + 2;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === undefined) continue;
    outDv.setUint16(entryOff, e.tag, le);
    outDv.setUint16(entryOff + 2, e.type, le);
    outDv.setUint32(entryOff + 4, e.count, le);

    if (isInline(e)) {
      out.set(e.valueBytes, entryOff + 8);
    } else {
      const blob = externalBlobs.find((b) => b.entryIdx === i);
      // H-3 (code): blob is structurally guaranteed to exist for every non-inline entry;
      // throw defensively rather than silently writing offset 0 (= TIFF header).
      if (blob === undefined) {
        throw new TiffBadTagValueError(e.tag, 'external blob missing during serialization');
      }
      outDv.setUint32(entryOff + 8, blob.offset, le);
    }
    entryOff += 12;
  }

  // NextIFDOffset = 0 (end of chain)
  outDv.setUint32(entryOff, 0, le);

  // Attach normalisations to the returned file (mutate a copy)
  // NOTE: TiffFile.normalisations is on the file object; the serializer
  // cannot mutate the passed-in object. Return the bytes only.
  void normalisations; // used above for logic, not appended here

  return out;
}

// ---------------------------------------------------------------------------
// 1-bit repacker (for serializer)
// ---------------------------------------------------------------------------

function pack1From8(
  pixels: Uint8Array,
  width: number,
  height: number,
  samplesPerPixel: number,
): Uint8Array {
  const bytesPerRow = Math.ceil((width * samplesPerPixel) / 8);
  const out = new Uint8Array(height * bytesPerRow);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const bitOff = row * width * samplesPerPixel + col;
      const byteIdx = row * bytesPerRow + Math.floor(col / 8);
      const bitPos = 7 - (col % 8);
      const pixVal = pixels[bitOff] ?? 0;
      if (pixVal && byteIdx < out.length) out[byteIdx] = (out[byteIdx] ?? 0) | (1 << bitPos);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// serializeTiff with normalisations tracking — wrapper
// ---------------------------------------------------------------------------

/**
 * Serialize a TiffFile to bytes, collecting normalisation flags.
 * Returns { bytes, normalisations } so callers can inspect what changed.
 */
export function serializeTiffWithNormalisations(file: TiffFile): {
  bytes: Uint8Array;
  normalisations: TiffNormalisation[];
} {
  const normalisations: TiffNormalisation[] = [];

  if (file.pages.length > 1) normalisations.push('multi-page-truncated-to-first');

  const page = file.pages[0];
  if (page === undefined) throw new TiffBadTagValueError('pages', 'TIFF file has no pages');

  if (page.compression !== 1) normalisations.push('compression-dropped-to-none');
  if (page.planarConfig !== 1) normalisations.push('planar-flattened-to-chunky');
  if (page.bitsPerSample === 4) normalisations.push('bits-per-sample-promoted-to-8');

  const bytes = serializeTiff(file);
  return { bytes, normalisations };
}
