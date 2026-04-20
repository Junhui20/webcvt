/**
 * GIF container parser and serializer.
 *
 * Handles GIF87a and GIF89a. Full container walk + LZW pixel decode +
 * GCE parsing + NETSCAPE2.0 loop count + interlaced raster deinterlacing.
 *
 * Both static (1-frame) and animated (multi-frame) GIFs use the same GifFile type.
 */

import {
  GIF87A_MAGIC,
  GIF89A_MAGIC,
  GIF_APP_LABEL,
  GIF_COMMENT_LABEL,
  GIF_EXTENSION_INTRODUCER,
  GIF_GCE_LABEL,
  GIF_IMAGE_SEPARATOR,
  GIF_PLAINTEXT_LABEL,
  GIF_TRAILER,
  MAX_DIM,
  MAX_FRAMES,
  MAX_GIF_FRAME_BYTES,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  NETSCAPE2_IDENTIFIER,
} from './constants.ts';
import {
  GifBadBlockIntroError,
  GifBadDimensionError,
  GifBadLzwMinCodeSizeError,
  GifBadSignatureError,
  GifFrameOutOfBoundsError,
  GifFrameTooLargeError,
  GifNoPaletteError,
  GifTooManyColorsError,
  GifTooManyFramesError,
  GifTooShortError,
  GifTruncatedExtensionError,
  GifUnknownExtensionError,
  ImageInputTooLargeError,
} from './errors.ts';
import { deinterlace } from './gif-deinterlace.ts';
import { decodeLzw, encodeLzw } from './gif-lzw.ts';
import type { AnimationFrame, BlendMode, DisposalMethod, GifFile } from './types.ts';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GraphicsControlExtension {
  disposal: number; // 0..7
  userInput: boolean;
  transparentFlag: boolean;
  transparentIndex: number;
  delayHundredths: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readU16Le(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0;
}

function mapGifDisposal(disposal: number): DisposalMethod {
  switch (disposal) {
    case 2:
      return 'background';
    case 3:
      return 'previous';
    default:
      return 'none'; // 0, 1, 4-7 all treated as 'none'
  }
}

/** Skip all sub-blocks starting at `pos`; returns the position after the terminator (0x00). */
function skipSubBlocks(bytes: Uint8Array, startPos: number): number {
  let pos = startPos;
  while (pos < bytes.length) {
    const len = bytes[pos] ?? 0;
    pos += 1;
    if (len === 0) break;
    pos += len;
  }
  return pos;
}

/** Read all sub-block bytes (excluding lengths and terminator) starting at `pos`. */
function readSubBlocks(bytes: Uint8Array, pos: number): { data: Uint8Array; nextPos: number } {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let p = pos;
  while (p < bytes.length) {
    const len = bytes[p++] ?? 0;
    if (len === 0) break;
    chunks.push(bytes.subarray(p, p + len));
    total += len;
    p += len;
  }
  const data = new Uint8Array(total);
  let dst = 0;
  for (const chunk of chunks) {
    data.set(chunk, dst);
    dst += chunk.length;
  }
  return { data, nextPos: p };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a GIF byte stream into a GifFile.
 *
 * @throws GifTooShortError / ImageInputTooLargeError / GifBadSignatureError /
 *         GifBadDimensionError / GifNoPaletteError / GifFrameOutOfBoundsError /
 *         GifUnknownExtensionError / GifBadBlockIntroError
 */
export function parseGif(input: Uint8Array): GifFile {
  // 1. Validate input size
  if (input.length < 14) throw new GifTooShortError(input.length);
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  // 2. Read and validate signature
  const sig = String.fromCharCode(
    input[0] ?? 0,
    input[1] ?? 0,
    input[2] ?? 0,
    input[3] ?? 0,
    input[4] ?? 0,
    input[5] ?? 0,
  );
  let variant: 'GIF87a' | 'GIF89a';
  if (sig === 'GIF87a') variant = 'GIF87a';
  else if (sig === 'GIF89a') variant = 'GIF89a';
  else throw new GifBadSignatureError(sig);

  // 3. Read Logical Screen Descriptor (7 bytes at offset 6)
  const canvasWidth = readU16Le(input, 6);
  const canvasHeight = readU16Le(input, 8);
  const packed = input[10] ?? 0;
  const backgroundColorIndex = input[11] ?? 0;
  const pixelAspectRatio = input[12] ?? 0;

  // 4. Validate canvas dimensions
  if (canvasWidth < 1 || canvasWidth > MAX_DIM)
    throw new GifBadDimensionError('width', canvasWidth);
  if (canvasHeight < 1 || canvasHeight > MAX_DIM)
    throw new GifBadDimensionError('height', canvasHeight);

  // 5. Read Global Color Table if flag set
  const gctFlag = (packed >> 7) & 1;
  const gctSizePow = packed & 0x07;
  let pos = 13;
  let globalColorTable: Uint8Array | undefined;

  if (gctFlag) {
    const gctEntries = 2 << gctSizePow;
    globalColorTable = input.slice(pos, pos + gctEntries * 3);
    pos += gctEntries * 3;
  }

  // 6. Initialise state
  const frames: AnimationFrame[] = [];
  const commentBlocks: string[] = [];
  let loopCount = 1; // default: play once
  let pendingGCE: GraphicsControlExtension | null = null;

  // 7. Main block loop
  while (pos < input.length) {
    const intro = input[pos++] ?? 0;

    if (intro === GIF_TRAILER) break; // 0x3B

    if (intro === GIF_EXTENSION_INTRODUCER) {
      // 0x21
      const label = input[pos++] ?? 0;

      if (label === GIF_GCE_LABEL) {
        // 0xF9 Graphics Control Extension
        // Block size must be 0x04
        pos++; // skip block size byte (should be 4)
        const gcePacked = input[pos++] ?? 0;
        const delayLo = input[pos++] ?? 0;
        const delayHi = input[pos++] ?? 0;
        const transIdx = input[pos++] ?? 0;
        pos++; // block terminator 0x00

        pendingGCE = {
          disposal: (gcePacked >> 2) & 0x07,
          userInput: Boolean((gcePacked >> 1) & 1),
          transparentFlag: Boolean(gcePacked & 1),
          transparentIndex: transIdx,
          delayHundredths: delayLo | (delayHi << 8),
        };
      } else if (label === GIF_APP_LABEL) {
        // 0xFF Application Extension
        const blockSize = input[pos++] ?? 0; // should be 11
        const identBytes = input.subarray(pos, pos + blockSize);
        const identifier = String.fromCharCode(...identBytes);
        pos += blockSize;

        if (identifier === NETSCAPE2_IDENTIFIER) {
          // Expect sub-block: 0x03 | 0x01 | loop-lo | loop-hi
          if (pos >= input.length) throw new GifTruncatedExtensionError('NETSCAPE2.0');
          const subLen = input[pos++] ?? 0;
          if (subLen >= 3) {
            if (pos + subLen > input.length) throw new GifTruncatedExtensionError('NETSCAPE2.0');
            const subId = input[pos++] ?? 0; // should be 0x01
            if (subId === 0x01) {
              const loLo = input[pos++] ?? 0;
              const loHi = input[pos++] ?? 0;
              loopCount = loLo | (loHi << 8);
              // Skip any remaining bytes in this sub-block
              pos += subLen - 3;
            } else {
              pos += subLen - 1;
            }
          } else {
            pos += subLen;
          }
          // Consume remaining sub-blocks
          pos = skipSubBlocks(input, pos);
        } else {
          // Unknown application extension — skip all sub-blocks
          pos = skipSubBlocks(input, pos);
        }
      } else if (label === GIF_COMMENT_LABEL) {
        // 0xFE Comment Extension
        const { data, nextPos } = readSubBlocks(input, pos);
        const text = new TextDecoder('ascii', { fatal: false }).decode(data);
        commentBlocks.push(text);
        pos = nextPos;
      } else if (label === GIF_PLAINTEXT_LABEL) {
        // 0x01 Plain Text Extension — skip 13-byte header + sub-blocks
        const headerSize = input[pos++] ?? 0;
        pos += headerSize;
        pos = skipSubBlocks(input, pos);
      } else {
        throw new GifUnknownExtensionError(label);
      }
    } else if (intro === GIF_IMAGE_SEPARATOR) {
      // 0x2C Image Descriptor
      const frameX = readU16Le(input, pos);
      const frameY = readU16Le(input, pos + 2);
      const frameWidth = readU16Le(input, pos + 4);
      const frameHeight = readU16Le(input, pos + 6);
      const imgPacked = input[pos + 8] ?? 0;
      pos += 9;

      const frameIndex = frames.length;

      // Validate frame bounds (Trap §15)
      if (frameX + frameWidth > canvasWidth) throw new GifFrameOutOfBoundsError(frameIndex, 'x');
      if (frameY + frameHeight > canvasHeight) throw new GifFrameOutOfBoundsError(frameIndex, 'y');

      // Read Local Color Table if flag set
      const lctFlag = (imgPacked >> 7) & 1;
      const interlaceFlag = (imgPacked >> 6) & 1;
      const lctSizePow = imgPacked & 0x07;
      let localColorTable: Uint8Array | undefined;

      if (lctFlag) {
        const lctEntries = 2 << lctSizePow;
        localColorTable = input.slice(pos, pos + lctEntries * 3);
        pos += lctEntries * 3;
      }

      // Choose active palette
      const palette = localColorTable ?? globalColorTable;
      if (!palette) throw new GifNoPaletteError(frameIndex);

      // Read LZW minimum code size and validate range [2, 8]
      const lzwMinCodeSize = input[pos++] ?? 2;
      if (lzwMinCodeSize < 2 || lzwMinCodeSize > 8)
        throw new GifBadLzwMinCodeSizeError(lzwMinCodeSize);

      // Cap frame count BEFORE reading any pixel data (H-2 code)
      if (frames.length >= MAX_FRAMES) throw new GifTooManyFramesError(frames.length, MAX_FRAMES);

      // Cap per-frame pixel count (H-3 code)
      if (frameWidth * frameHeight > MAX_PIXELS)
        throw new GifFrameTooLargeError('pixels', frameWidth * frameHeight, MAX_PIXELS);

      // Read sub-blocks into compressed bytes (cap at MAX_GIF_FRAME_BYTES)
      let totalCompressed = 0;
      const compressedChunks: Uint8Array[] = [];
      let p = pos;
      while (p < input.length) {
        const subLen = input[p++] ?? 0;
        if (subLen === 0) break;
        if (totalCompressed + subLen > MAX_GIF_FRAME_BYTES) {
          // CRIT-1: throw immediately instead of silently continuing past the cap
          throw new GifFrameTooLargeError(
            frameIndex,
            totalCompressed + subLen,
            MAX_GIF_FRAME_BYTES,
          );
        }
        compressedChunks.push(input.subarray(p, p + subLen));
        totalCompressed += subLen;
        p += subLen;
      }
      pos = p;

      const compressed = new Uint8Array(totalCompressed);
      let dst = 0;
      for (const chunk of compressedChunks) {
        compressed.set(chunk, dst);
        dst += chunk.length;
      }

      // Decode LZW
      let indexed = decodeLzw(compressed, lzwMinCodeSize, frameWidth * frameHeight);

      // Deinterlace if needed (Trap §14)
      if (interlaceFlag) {
        indexed = deinterlace(indexed, frameWidth, frameHeight);
      }

      // Convert indexed → RGBA
      const pixelData = new Uint8Array(frameWidth * frameHeight * 4);
      for (let i = 0; i < indexed.length; i++) {
        const idx = indexed[i] ?? 0;
        const r = palette[idx * 3] ?? 0;
        const g = palette[idx * 3 + 1] ?? 0;
        const b = palette[idx * 3 + 2] ?? 0;
        const a = pendingGCE?.transparentFlag && idx === pendingGCE.transparentIndex ? 0 : 255;
        pixelData[i * 4] = r;
        pixelData[i * 4 + 1] = g;
        pixelData[i * 4 + 2] = b;
        pixelData[i * 4 + 3] = a;
      }

      const durationMs = pendingGCE ? pendingGCE.delayHundredths * 10 : 0;
      const disposalMethod = mapGifDisposal(pendingGCE?.disposal ?? 0);

      frames.push({
        index: frameIndex,
        x: frameX,
        y: frameY,
        width: frameWidth,
        height: frameHeight,
        durationMs,
        disposalMethod,
        blendMode: 'source' as BlendMode,
        pixelData,
      });

      pendingGCE = null;
    } else {
      throw new GifBadBlockIntroError(intro, pos - 1);
    }
  }

  return {
    format: 'gif',
    variant,
    canvasWidth,
    canvasHeight,
    loopCount,
    backgroundColorIndex: globalColorTable !== undefined ? backgroundColorIndex : undefined,
    globalColorTable,
    pixelAspectRatio,
    frames,
    commentBlocks,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a GifFile to a GIF89a byte stream.
 *
 * Always emits GIF89a (even if input was GIF87a) because we may emit
 * NETSCAPE2.0 and GCE extensions.
 *
 * @throws GifTooManyColorsError if a frame has > 256 unique RGBA colours.
 */
export function serializeGif(file: GifFile): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. Header: always GIF89a
  parts.push(GIF89A_MAGIC);

  // 2. Logical Screen Descriptor
  const gctEntries = file.globalColorTable
    ? Math.max(2, nextPowerOfTwo(Math.ceil(file.globalColorTable.length / 3)))
    : 2;
  const gctSizePow = gctEntries > 2 ? Math.round(Math.log2(gctEntries)) - 1 : 0;
  const gctFlag = file.globalColorTable ? 1 : 0;
  const bgIndex = file.backgroundColorIndex ?? 0;
  const lsdPacked = (gctFlag << 7) | (0 << 4) | (0 << 3) | (gctSizePow & 0x07);

  const lsd = new Uint8Array(7);
  lsd[0] = file.canvasWidth & 0xff;
  lsd[1] = (file.canvasWidth >> 8) & 0xff;
  lsd[2] = file.canvasHeight & 0xff;
  lsd[3] = (file.canvasHeight >> 8) & 0xff;
  lsd[4] = lsdPacked;
  lsd[5] = bgIndex;
  lsd[6] = file.pixelAspectRatio;
  parts.push(lsd);

  // 3. Global Color Table
  if (file.globalColorTable) {
    parts.push(file.globalColorTable);
    // Pad to correct table size if needed
    const requiredBytes = (2 << gctSizePow) * 3;
    if (file.globalColorTable.length < requiredBytes) {
      parts.push(new Uint8Array(requiredBytes - file.globalColorTable.length));
    }
  }

  // 4. NETSCAPE2.0 Application Extension (if animated)
  if (file.frames.length > 1) {
    parts.push(buildNetscapeExt(file.loopCount));
  }

  // 5. Frames
  for (const frame of file.frames) {
    if (!frame.pixelData) continue; // GIF frames must have pixelData

    // Build LCT from frame RGBA pixels (quantise to unique colours)
    const { indexed, palette } = quantiseFrame(frame);

    if (palette.length / 3 > 256) {
      throw new GifTooManyColorsError(frame.index, Math.ceil(palette.length / 3));
    }

    // GCE
    const delayHundredths = Math.min(Math.round(frame.durationMs / 10), 0xffff);
    parts.push(buildGce(frame.disposalMethod, delayHundredths, false, 0));

    // Image Descriptor
    const lctEntries = nextPowerOfTwo(Math.ceil(palette.length / 3));
    const lctSizePow = Math.max(0, Math.round(Math.log2(Math.max(2, lctEntries))) - 1);
    const imgPacked = (1 << 7) | (0 << 6) | (0 << 5) | (lctSizePow & 0x07);

    const imgDesc = new Uint8Array(10);
    imgDesc[0] = GIF_IMAGE_SEPARATOR; // 0x2C
    imgDesc[1] = frame.x & 0xff;
    imgDesc[2] = (frame.x >> 8) & 0xff;
    imgDesc[3] = frame.y & 0xff;
    imgDesc[4] = (frame.y >> 8) & 0xff;
    imgDesc[5] = frame.width & 0xff;
    imgDesc[6] = (frame.width >> 8) & 0xff;
    imgDesc[7] = frame.height & 0xff;
    imgDesc[8] = (frame.height >> 8) & 0xff;
    imgDesc[9] = imgPacked;
    parts.push(imgDesc);

    // LCT (padded to lctEntries * 3 bytes)
    const lctActualEntries = 2 << lctSizePow;
    const lct = new Uint8Array(lctActualEntries * 3);
    lct.set(palette.subarray(0, Math.min(palette.length, lct.length)));
    parts.push(lct);

    // LZW pixel data
    const lzwMinCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, lctActualEntries))));
    const encoded = encodeLzw(indexed, lzwMinCodeSize);
    parts.push(encoded);
  }

  // 6. Trailer
  parts.push(new Uint8Array([GIF_TRAILER]));

  // Concatenate all parts
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers for serializer
// ---------------------------------------------------------------------------

function nextPowerOfTwo(n: number): number {
  if (n <= 2) return 2;
  let p = 2;
  while (p < n) p <<= 1;
  return p;
}

function buildNetscapeExt(loopCount: number): Uint8Array {
  // 0x21 0xFF 0x0B NETSCAPE2.0 0x03 0x01 lo hi 0x00
  const out = new Uint8Array(19);
  out[0] = 0x21;
  out[1] = 0xff;
  out[2] = 0x0b; // block size = 11
  const id = new TextEncoder().encode('NETSCAPE2.0');
  out.set(id, 3);
  out[14] = 0x03; // sub-block size
  out[15] = 0x01; // sub-block ID
  out[16] = loopCount & 0xff;
  out[17] = (loopCount >> 8) & 0xff;
  out[18] = 0x00; // terminator
  return out;
}

function buildGce(
  disposal: DisposalMethod,
  delayHundredths: number,
  transparent: boolean,
  transIdx: number,
): Uint8Array {
  const disposalBits = disposal === 'background' ? 2 : disposal === 'previous' ? 3 : 1;
  const packed = (disposalBits << 2) | (transparent ? 1 : 0);
  return new Uint8Array([
    0x21,
    0xf9,
    0x04,
    packed,
    delayHundredths & 0xff,
    (delayHundredths >> 8) & 0xff,
    transIdx,
    0x00,
  ]);
}

/** Quantise a frame's RGBA pixel data to an indexed palette. */
function quantiseFrame(frame: AnimationFrame): { indexed: Uint8Array; palette: Uint8Array } {
  const pixelData = frame.pixelData!;
  const pixelCount = frame.width * frame.height;

  // Map RGBA → palette index using a simple identity (no colour reduction)
  // Build colour map: RGBA key → palette index
  const colorMap = new Map<number, number>();
  const paletteColors: number[] = [];

  const indexed = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = pixelData[i * 4] ?? 0;
    const g = pixelData[i * 4 + 1] ?? 0;
    const b = pixelData[i * 4 + 2] ?? 0;
    const a = pixelData[i * 4 + 3] ?? 0;
    // Pack RGBA into a 32-bit key
    const key = (r << 24) | (g << 16) | (b << 8) | a;

    let idx = colorMap.get(key);
    if (idx === undefined) {
      idx = paletteColors.length;
      colorMap.set(key, idx);
      paletteColors.push(r, g, b);
    }
    indexed[i] = idx;
  }

  return {
    indexed,
    palette: new Uint8Array(paletteColors),
  };
}
