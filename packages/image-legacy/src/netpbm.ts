/**
 * Netpbm family parser/serializer — PBM (P1/P4), PGM (P2/P5), PPM (P3/P6).
 *
 * Shared header reader: readNetpbmHeader handles whitespace, TAB, CR, LF, and
 * mid-header # comments (Trap §1). Binary 16-bit samples are read big-endian
 * via DataView (Trap §2). P4 row padding is correctly computed with
 * Math.ceil(width / 8) (Trap §3).
 *
 * TextDecoder is hoisted to module scope (Lesson 2 from prior packages).
 */

import { MAX_DIM, MAX_INPUT_BYTES, MAX_PIXELS, MAX_PIXEL_BYTES } from './constants.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  PbmBadAsciiByteError,
  PbmBadMagicError,
  PbmSizeMismatchError,
  PgmBadMagicError,
  PgmBadMaxvalError,
  PgmSampleOutOfRangeError,
  PpmBadMagicError,
  PpmSampleOutOfRangeError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** NetpbmMagic is one of the eight ASCII 2-byte header magics. */
export type NetpbmMagic = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'Pf' | 'PF';

export interface PbmFile {
  format: 'pbm';
  variant: 'ascii' | 'binary';
  width: number;
  height: number;
  channels: 1;
  bitDepth: 1;
  pixelData: Uint8Array;
}

export interface PgmFile {
  format: 'pgm';
  variant: 'ascii' | 'binary';
  width: number;
  height: number;
  channels: 1;
  bitDepth: 8 | 16;
  maxval: number;
  pixelData: Uint8Array | Uint16Array;
}

export interface PpmFile {
  format: 'ppm';
  variant: 'ascii' | 'binary';
  width: number;
  height: number;
  channels: 3;
  bitDepth: 8 | 16;
  maxval: number;
  pixelData: Uint8Array | Uint16Array;
}

// ---------------------------------------------------------------------------
// Module-scope TextDecoder (hoisted — Lesson 2)
// ---------------------------------------------------------------------------

const ASCII_DECODER = new TextDecoder('ascii');

// ---------------------------------------------------------------------------
// Shared Netpbm header reader (Trap §1 — byte-at-a-time tokenizer)
// ---------------------------------------------------------------------------

interface NetpbmHeader {
  magic: NetpbmMagic;
  width: number;
  height: number;
  /** null for PBM; integer for PGM/PPM; returned as a raw string for PFM (signed float). */
  thirdToken: string | null;
  headerEndOffset: number;
}

type TokenNeeded = 'magic' | 'width' | 'height' | 'third' | 'done';

/**
 * Read the Netpbm ASCII header one byte at a time.
 *
 * @param bytes  Full input buffer.
 * @param needThird  If true, read a third token after width/height (maxval or scale).
 * @returns Parsed header fields plus the byte offset of the first raster byte.
 */
export function readNetpbmHeader(bytes: Uint8Array, needThird: boolean): NetpbmHeader {
  const tokens: string[] = [];
  let inComment = false;
  let current = '';
  let i = 0;

  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  const targetTokens = needThird ? 4 : 3;

  for (; i < bytes.length; i++) {
    const b = bytes[i] as number;

    if (inComment) {
      if (b === 0x0a) inComment = false;
      continue;
    }

    if (b === 0x23 /* '#' */) {
      flush();
      inComment = true;
      continue;
    }

    // Whitespace: space(0x20), tab(0x09), CR(0x0d), LF(0x0a)
    if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) {
      flush();
      if (tokens.length === targetTokens) {
        // The whitespace byte after the last token IS consumed as the separator.
        i += 1;
        break;
      }
      continue;
    }

    current += String.fromCharCode(b);
  }

  // Flush any remaining token (if we hit EOF without trailing whitespace).
  flush();

  if (tokens.length < targetTokens) {
    throw new Error(
      `Netpbm header truncated: expected ${targetTokens} tokens, got ${tokens.length}.`,
    );
  }

  const magic = tokens[0] as NetpbmMagic;
  const widthStr = tokens[1];
  const heightStr = tokens[2];
  const thirdToken = needThird ? (tokens[3] ?? null) : null;

  const width = Number.parseInt(widthStr ?? '', 10);
  const height = Number.parseInt(heightStr ?? '', 10);

  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('Netpbm header: width/height are not valid integers.');
  }

  return { magic, width, height, thirdToken, headerEndOffset: i };
}

// ---------------------------------------------------------------------------
// Shared dimension cap validator
// ---------------------------------------------------------------------------

function validateDimensions(
  width: number,
  height: number,
  bytesPerPixel: number,
  label: string,
): void {
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    throw new ImagePixelCapError(
      `${label}: dimensions ${width}×${height} out of range [1, ${MAX_DIM}].`,
    );
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_PIXELS) {
    throw new ImagePixelCapError(
      `${label}: pixel count ${pixelCount} exceeds MAX_PIXELS ${MAX_PIXELS}.`,
    );
  }
  const pixelBytes = pixelCount * bytesPerPixel;
  if (pixelBytes > MAX_PIXEL_BYTES) {
    throw new ImagePixelCapError(
      `${label}: pixel byte count ${pixelBytes} exceeds MAX_PIXEL_BYTES ${MAX_PIXEL_BYTES}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// ASCII raster tokenizer (for P1 / P2 / P3)
// ---------------------------------------------------------------------------

/**
 * Walk post-header bytes and yield decimal integer tokens, skipping whitespace
 * and # comments. Returns the array of numeric token strings.
 */
function tokenizeAsciiRaster(bytes: Uint8Array, offset: number): number[] {
  const values: number[] = [];
  let inComment = false;
  let current = '';

  for (let i = offset; i < bytes.length; i++) {
    const b = bytes[i] as number;

    if (inComment) {
      if (b === 0x0a) inComment = false;
      continue;
    }

    if (b === 0x23) {
      if (current.length > 0) {
        values.push(Number.parseInt(current, 10));
        current = '';
      }
      inComment = true;
      continue;
    }

    if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) {
      if (current.length > 0) {
        values.push(Number.parseInt(current, 10));
        current = '';
      }
      continue;
    }

    current += String.fromCharCode(b);
  }

  if (current.length > 0) {
    values.push(Number.parseInt(current, 10));
  }

  return values;
}

// ---------------------------------------------------------------------------
// PBM parser
// ---------------------------------------------------------------------------

export function parsePbm(input: Uint8Array): PbmFile {
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  const header = readNetpbmHeader(input, false);
  const { magic, width, height, headerEndOffset } = header;

  if (magic !== 'P1' && magic !== 'P4') throw new PbmBadMagicError(magic);

  const variant: 'ascii' | 'binary' = magic === 'P1' ? 'ascii' : 'binary';

  // PBM is 1 bit per pixel but we allocate 1 byte per pixel.
  validateDimensions(width, height, 1, 'PBM');

  const pixelData = new Uint8Array(width * height);

  if (magic === 'P1') {
    // ASCII — collect '0' and '1' chars, reject anything else
    let dst = 0;
    let inComment = false;
    for (let i = headerEndOffset; i < input.length; i++) {
      const b = input[i] as number;
      if (inComment) {
        if (b === 0x0a) inComment = false;
        continue;
      }
      if (b === 0x23) {
        inComment = true;
        continue;
      }
      if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a) continue;
      if (b === 0x30 /* '0' */ || b === 0x31 /* '1' */) {
        if (dst >= pixelData.length) throw new PbmSizeMismatchError(dst + 1, pixelData.length);
        pixelData[dst++] = b - 0x30;
      } else {
        throw new PbmBadAsciiByteError(b);
      }
    }
    if (dst !== pixelData.length) throw new PbmSizeMismatchError(dst, pixelData.length);
  } else {
    // P4 binary — Trap §3: stride = ceil(width / 8)
    const stride = Math.ceil(width / 8);
    const expectedBytes = headerEndOffset + height * stride;
    // Allow one trailing LF for tooling tolerance
    if (input.length < expectedBytes || input.length > expectedBytes + 1) {
      throw new PbmSizeMismatchError((input.length - headerEndOffset) * 8, width * height);
    }
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const byteIndex = headerEndOffset + r * stride + Math.floor(c / 8);
        const bitIndex = 7 - (c % 8);
        const byte = input[byteIndex] ?? 0;
        pixelData[r * width + c] = (byte >> bitIndex) & 1;
      }
    }
  }

  return { format: 'pbm', variant, width, height, channels: 1, bitDepth: 1, pixelData };
}

// ---------------------------------------------------------------------------
// PBM serializer
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

export function serializePbm(file: PbmFile): Uint8Array {
  const { variant, width, height, pixelData } = file;
  const magic = variant === 'ascii' ? 'P1' : 'P4';
  const headerStr = `${magic}\n${width} ${height}\n`;
  const header = TEXT_ENCODER.encode(headerStr);

  if (variant === 'ascii') {
    const rows: string[] = [];
    for (let r = 0; r < height; r++) {
      const row: string[] = [];
      for (let c = 0; c < width; c++) {
        row.push(String(pixelData[r * width + c] ?? 0));
      }
      rows.push(row.join(' '));
    }
    const body = TEXT_ENCODER.encode(`${rows.join('\n')}\n`);
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  // P4 binary
  const stride = Math.ceil(width / 8);
  const body = new Uint8Array(height * stride);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const px = pixelData[r * width + c] ?? 0;
      if (px !== 0) {
        const byteIndex = r * stride + Math.floor(c / 8);
        const bitIndex = 7 - (c % 8);
        body[byteIndex] = (body[byteIndex] ?? 0) | (1 << bitIndex);
      }
    }
  }
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

// ---------------------------------------------------------------------------
// PGM parser
// ---------------------------------------------------------------------------

export function parsePgm(input: Uint8Array): PgmFile {
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  const header = readNetpbmHeader(input, true);
  const { magic, width, height, thirdToken, headerEndOffset } = header;

  if (magic !== 'P2' && magic !== 'P5') throw new PgmBadMagicError(magic);

  const variant: 'ascii' | 'binary' = magic === 'P2' ? 'ascii' : 'binary';

  const maxval = Number.parseInt(thirdToken ?? '', 10);
  if (!Number.isInteger(maxval) || maxval < 1 || maxval > 65535) {
    throw new PgmBadMaxvalError(maxval);
  }

  const bitDepth: 8 | 16 = maxval <= 255 ? 8 : 16;
  const bytesPerSample = bitDepth === 8 ? 1 : 2;

  validateDimensions(width, height, bytesPerSample, 'PGM');

  const numSamples = width * height;

  if (magic === 'P2') {
    const values = tokenizeAsciiRaster(input, headerEndOffset);
    if (values.length !== numSamples) {
      throw new PgmSampleOutOfRangeError(-1, maxval); // reuse error; provide context via message
    }
    const pixelData = bitDepth === 8 ? new Uint8Array(numSamples) : new Uint16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const v = values[i] ?? 0;
      if (v > maxval) throw new PgmSampleOutOfRangeError(v, maxval);
      pixelData[i] = v;
    }
    return { format: 'pgm', variant, width, height, channels: 1, bitDepth, maxval, pixelData };
  }

  // P5 binary
  // Sec-H-2: validate input has enough bytes BEFORE the read loop. The
  // `??0` fallback below would silently substitute 0 for out-of-bounds
  // bytes, producing silent data corruption on truncated inputs.
  const expectedRasterBytes = numSamples * bytesPerSample;
  if (input.length - headerEndOffset < expectedRasterBytes) {
    throw new PbmSizeMismatchError(input.length - headerEndOffset, expectedRasterBytes);
  }
  if (bitDepth === 8) {
    const pixelData = new Uint8Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const v = input[headerEndOffset + i] ?? 0;
      if (v > maxval) throw new PgmSampleOutOfRangeError(v, maxval);
      pixelData[i] = v;
    }
    return { format: 'pgm', variant, width, height, channels: 1, bitDepth: 8, maxval, pixelData };
  }

  // P5 16-bit big-endian (Trap §2)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const pixelData16 = new Uint16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const v = dv.getUint16(headerEndOffset + i * 2, false /* big-endian */);
    if (v > maxval) throw new PgmSampleOutOfRangeError(v, maxval);
    pixelData16[i] = v;
  }
  return {
    format: 'pgm',
    variant,
    width,
    height,
    channels: 1,
    bitDepth: 16,
    maxval,
    pixelData: pixelData16,
  };
}

// ---------------------------------------------------------------------------
// PGM serializer
// ---------------------------------------------------------------------------

export function serializePgm(file: PgmFile): Uint8Array {
  const { variant, width, height, maxval, pixelData, bitDepth } = file;
  const magic = variant === 'ascii' ? 'P2' : 'P5';
  const headerStr = `${magic}\n${width} ${height}\n${maxval}\n`;
  const header = TEXT_ENCODER.encode(headerStr);

  if (variant === 'ascii') {
    const rows: string[] = [];
    for (let r = 0; r < height; r++) {
      const row: string[] = [];
      for (let c = 0; c < width; c++) {
        row.push(String(pixelData[r * width + c] ?? 0));
      }
      rows.push(row.join(' '));
    }
    const body = TEXT_ENCODER.encode(`${rows.join('\n')}\n`);
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  const numSamples = width * height;
  const bodyBytes = numSamples * (bitDepth === 8 ? 1 : 2);
  const body = new Uint8Array(bodyBytes);

  if (bitDepth === 8) {
    const src = pixelData as Uint8Array;
    body.set(src);
  } else {
    const dv = new DataView(body.buffer);
    const src = pixelData as Uint16Array;
    for (let i = 0; i < numSamples; i++) {
      dv.setUint16(i * 2, src[i] ?? 0, false /* big-endian */);
    }
  }

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

// ---------------------------------------------------------------------------
// PPM parser
// ---------------------------------------------------------------------------

export function parsePpm(input: Uint8Array): PpmFile {
  if (input.length > MAX_INPUT_BYTES)
    throw new ImageInputTooLargeError(input.length, MAX_INPUT_BYTES);

  const header = readNetpbmHeader(input, true);
  const { magic, width, height, thirdToken, headerEndOffset } = header;

  if (magic !== 'P3' && magic !== 'P6') throw new PpmBadMagicError(magic);

  const variant: 'ascii' | 'binary' = magic === 'P3' ? 'ascii' : 'binary';

  const maxval = Number.parseInt(thirdToken ?? '', 10);
  if (!Number.isInteger(maxval) || maxval < 1 || maxval > 65535) {
    // Re-use PgmBadMaxvalError-style but for PPM context — use a generic approach
    throw new PpmSampleOutOfRangeError(maxval, 65535);
  }

  const bitDepth: 8 | 16 = maxval <= 255 ? 8 : 16;
  const bytesPerSample = bitDepth === 8 ? 1 : 2;

  validateDimensions(width, height, 3 * bytesPerSample, 'PPM');

  const numSamples = width * height * 3;

  if (magic === 'P3') {
    const values = tokenizeAsciiRaster(input, headerEndOffset);
    if (values.length !== numSamples) {
      throw new PpmSampleOutOfRangeError(-1, maxval);
    }
    const pixelData = bitDepth === 8 ? new Uint8Array(numSamples) : new Uint16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const v = values[i] ?? 0;
      if (v > maxval) throw new PpmSampleOutOfRangeError(v, maxval);
      pixelData[i] = v;
    }
    return { format: 'ppm', variant, width, height, channels: 3, bitDepth, maxval, pixelData };
  }

  // P6 binary
  // Sec-H-2: validate input has enough bytes BEFORE the read loop. The
  // `??0` fallback below would silently substitute 0 for out-of-bounds
  // bytes, producing silent data corruption on truncated inputs.
  const expectedRasterBytes = numSamples * bytesPerSample;
  if (input.length - headerEndOffset < expectedRasterBytes) {
    throw new PbmSizeMismatchError(input.length - headerEndOffset, expectedRasterBytes);
  }
  if (bitDepth === 8) {
    const pixelData = new Uint8Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const v = input[headerEndOffset + i] ?? 0;
      if (v > maxval) throw new PpmSampleOutOfRangeError(v, maxval);
      pixelData[i] = v;
    }
    return { format: 'ppm', variant, width, height, channels: 3, bitDepth: 8, maxval, pixelData };
  }

  // P6 16-bit big-endian (Trap §2)
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const pixelData16 = new Uint16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const v = dv.getUint16(headerEndOffset + i * 2, false /* big-endian */);
    if (v > maxval) throw new PpmSampleOutOfRangeError(v, maxval);
    pixelData16[i] = v;
  }
  return {
    format: 'ppm',
    variant,
    width,
    height,
    channels: 3,
    bitDepth: 16,
    maxval,
    pixelData: pixelData16,
  };
}

// ---------------------------------------------------------------------------
// PPM serializer
// ---------------------------------------------------------------------------

export function serializePpm(file: PpmFile): Uint8Array {
  const { variant, width, height, maxval, pixelData, bitDepth } = file;
  const magic = variant === 'ascii' ? 'P3' : 'P6';
  const headerStr = `${magic}\n${width} ${height}\n${maxval}\n`;
  const header = TEXT_ENCODER.encode(headerStr);

  if (variant === 'ascii') {
    const numPixels = width * height;
    const rows: string[] = [];
    for (let r = 0; r < height; r++) {
      const row: string[] = [];
      for (let c = 0; c < width; c++) {
        const base = (r * width + c) * 3;
        row.push(`${pixelData[base] ?? 0} ${pixelData[base + 1] ?? 0} ${pixelData[base + 2] ?? 0}`);
      }
      rows.push(row.join(' '));
    }
    const body = TEXT_ENCODER.encode(`${rows.join('\n')}\n`);
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  const numSamples = width * height * 3;
  const bodyBytes = numSamples * (bitDepth === 8 ? 1 : 2);
  const body = new Uint8Array(bodyBytes);

  if (bitDepth === 8) {
    body.set(pixelData as Uint8Array);
  } else {
    const dv = new DataView(body.buffer);
    const src = pixelData as Uint16Array;
    for (let i = 0; i < numSamples; i++) {
      dv.setUint16(i * 2, src[i] ?? 0, false /* big-endian */);
    }
  }

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}
