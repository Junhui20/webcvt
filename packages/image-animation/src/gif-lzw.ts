/**
 * GIF LZW codec — decoder and encoder.
 *
 * Key design notes from the spec:
 * - Codes are read/written LSB-first across bytes (contrast with PNG/JPEG MSB-first).
 * - Dictionary grows from 2^(minCodeSize+1) initial entries up to 4096 (12-bit max codes).
 * - CLEAR code = 2^minCodeSize, EOI code = CLEAR + 1. Both are reserved sentinels.
 * - "kwkwk" edge case (Trap §3): code === nextCode. Emit prev + firstByte(prev), then add that as entry.
 * - At 12-bit cap, keep using 12-bit codes; do NOT reset automatically. Wait for CLEAR.
 */

import { GifLzwInvalidCodeError, GifLzwTruncatedError } from './errors.ts';

const MAX_CODE_SIZE = 12;
const MAX_DICT_SIZE = 1 << MAX_CODE_SIZE; // 4096

/**
 * Decode a GIF LZW compressed byte stream into an indexed pixel array.
 *
 * @param compressed - The concatenated LZW sub-block bytes (already assembled by the caller).
 * @param minCodeSize - The LZW minimum code size byte from the Image Descriptor.
 * @param expectedPixels - Expected pixel count = frameWidth * frameHeight.
 * @returns Decoded indexed pixel values (one byte per pixel, palette index).
 */
export function decodeLzw(
  compressed: Uint8Array,
  minCodeSize: number,
  expectedPixels: number,
): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  // Dictionary stored as parallel arrays for performance.
  // prefix[i] = parent code in the chain (-1 for terminal entries 0..clearCode-1)
  // suffix[i] = the leaf pixel value
  const prefix = new Int32Array(MAX_DICT_SIZE).fill(-1);
  const suffix = new Uint8Array(MAX_DICT_SIZE);

  // Initialise terminal entries
  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  // Bit reader state
  let bitBuf = 0;
  let bitsAvailable = 0;
  let srcPos = 0;

  function readCode(codeSize: number): number {
    while (bitsAvailable < codeSize) {
      if (srcPos >= compressed.length) {
        // Pad with zeros if stream ends early
        bitsAvailable += 8;
      } else {
        bitBuf |= (compressed[srcPos++] ?? 0) << bitsAvailable;
        bitsAvailable += 8;
      }
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitsAvailable -= codeSize;
    return code;
  }

  // Stack for reversing dictionary chain during expansion
  const stack = new Uint8Array(MAX_DICT_SIZE + 1);

  function expand(code: number): Uint8Array {
    let top = 0;
    let c = code;
    while (c >= clearCode) {
      stack[top++] = suffix[c] ?? 0;
      c = prefix[c] ?? -1;
      if (c < 0) break;
    }
    // c is now a terminal (< clearCode)
    stack[top++] = c >= 0 ? c & 0xff : 0;
    const result = new Uint8Array(top);
    for (let i = 0; i < top; i++) {
      result[i] = stack[top - 1 - i] ?? 0;
    }
    return result;
  }

  const out = new Uint8Array(expectedPixels);
  let dst = 0;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  // Step 1: read first code — must be CLEAR
  let code = readCode(codeSize);
  while (code === clearCode) {
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
    code = readCode(codeSize);
  }

  if (code === eoiCode) {
    return out.subarray(0, dst);
  }

  // First real code must be a trivial terminal code
  if (code > clearCode) {
    throw new GifLzwInvalidCodeError(code);
  }
  out[dst++] = suffix[code] ?? 0;
  let prev = code;

  // Main decode loop
  while (dst < expectedPixels) {
    code = readCode(codeSize);

    if (code === clearCode) {
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;

      code = readCode(codeSize);
      if (code === eoiCode) break;
      if (code > clearCode) throw new GifLzwInvalidCodeError(code);

      out[dst++] = suffix[code] ?? 0;
      prev = code;
      continue;
    }

    if (code === eoiCode) break;

    let entry: Uint8Array;

    if (code < nextCode) {
      // Normal case: code is already in the dictionary
      entry = expand(code);
    } else if (code === nextCode) {
      // kwkwk edge case (Trap §3): code equals nextCode (not yet added)
      // entry = expand(prev) + firstByte(expand(prev))
      const prevEntry = expand(prev);
      entry = new Uint8Array(prevEntry.length + 1);
      entry.set(prevEntry);
      entry[prevEntry.length] = prevEntry[0] ?? 0;
    } else {
      throw new GifLzwInvalidCodeError(code);
    }

    // Emit
    for (let i = 0; i < entry.length && dst < expectedPixels; i++) {
      out[dst++] = entry[i] ?? 0;
    }

    // Add new dictionary entry
    if (nextCode < MAX_DICT_SIZE) {
      prefix[nextCode] = prev;
      suffix[nextCode] = entry[0] ?? 0;
      nextCode++;

      if (nextCode === 1 << codeSize && codeSize < MAX_CODE_SIZE) {
        codeSize++;
      }
    }
    // At 4096 entries with codeSize=12: keep decoding at 12 bits until CLEAR

    prev = code;
  }

  if (dst < expectedPixels) {
    throw new GifLzwTruncatedError(dst, expectedPixels);
  }

  return out;
}

/**
 * Encode an indexed pixel array into GIF LZW compressed bytes with sub-block framing.
 *
 * Standard LZW encoding loop: emit CLEAR, then process pixels building the string table,
 * emit codes when a match is not found, emit EOI at end. LSB-first bit packing.
 *
 * @param indexed - Pixel indices (one per pixel).
 * @param minCodeSize - The LZW minimum code size (typically 8 for 8-bit palettes, min 2).
 * @returns Encoded bytes: [minCodeSize, ...sub-blocks, 0x00].
 */
export function encodeLzw(indexed: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  // Output bit stream (LSB-first)
  const rawBits: number[] = [];
  let bitBuf = 0;
  let bitsUsed = 0;

  function emitCode(code: number, cs: number): void {
    bitBuf |= code << bitsUsed;
    bitsUsed += cs;
    while (bitsUsed >= 8) {
      rawBits.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitsUsed -= 8;
    }
  }

  function flushBits(): void {
    if (bitsUsed > 0) {
      rawBits.push(bitBuf & 0xff);
      bitBuf = 0;
      bitsUsed = 0;
    }
  }

  // String table: key = (prevCode << 8) | sym, value = code for that pair
  // We use a Map for simplicity; for large images a Uint32Array-backed hash would be faster.
  let stringTable = new Map<number, number>();
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  function resetState(): void {
    stringTable = new Map();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  // Emit initial CLEAR
  emitCode(clearCode, codeSize);
  resetState();

  if (indexed.length === 0) {
    emitCode(eoiCode, codeSize);
    flushBits();
    return packIntoSubBlocks(rawBits, minCodeSize);
  }

  // First pixel becomes the initial "prefix" (prevCode)
  let prevCode = indexed[0] ?? 0;

  for (let i = 1; i < indexed.length; i++) {
    const sym = indexed[i] ?? 0;
    const key = (prevCode << 8) | sym;

    const found = stringTable.get(key);
    if (found !== undefined) {
      // Extend the current match
      prevCode = found;
    } else {
      // Emit the current prevCode
      emitCode(prevCode, codeSize);

      if (nextCode < MAX_DICT_SIZE) {
        stringTable.set(key, nextCode);
        nextCode++;
        // Grow code size when nextCode EXCEEDS the current bit-width boundary.
        // The encoder transitions one step after the decoder, which is intentional:
        // the decoder adds an entry for the code it just read (and potentially
        // hasn't emitted yet when the kwkwk edge case applies), while the encoder
        // adds an entry for the pair it just emitted. Using > keeps them in sync.
        if (nextCode > 1 << codeSize && codeSize < MAX_CODE_SIZE) {
          codeSize++;
        }
      } else {
        // Dictionary full (4096 entries): emit CLEAR and reset
        emitCode(clearCode, codeSize);
        resetState();
        // The current sym becomes the new prevCode after reset
      }

      prevCode = sym;
    }
  }

  // Emit the final code and EOI
  emitCode(prevCode, codeSize);
  emitCode(eoiCode, codeSize);
  flushBits();

  return packIntoSubBlocks(rawBits, minCodeSize);
}

/**
 * Pack raw LZW bytes into GIF sub-block format:
 * [minCodeSize] [len1] [bytes...] [len2] [bytes...] ... [0x00]
 */
function packIntoSubBlocks(rawBits: number[], minCodeSize: number): Uint8Array {
  const result: number[] = [minCodeSize];
  let i = 0;
  while (i < rawBits.length) {
    const blockSize = Math.min(255, rawBits.length - i);
    result.push(blockSize);
    for (let j = 0; j < blockSize; j++) {
      result.push(rawBits[i++] ?? 0);
    }
  }
  result.push(0x00); // block terminator
  return new Uint8Array(result);
}
