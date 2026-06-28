/**
 * TIFF LZW codec for @catlabtech/webcvt-image-legacy.
 *
 * Implements post-6.0 MSB-first variable-width LZW as required by the TIFF 6.0
 * specification (Adobe, 1992). Key differences from GIF LZW:
 *
 *   - Codes are MSB-first within each byte (Trap #9 — NOT GIF's LSB-first).
 *   - Dictionary growth boundary is 510, NOT 511 (Trap #10, "TIFF Bug 5" fix).
 *   - ClearCode (256) resets dictionary AND code width to 9 (Trap #11).
 *   - EOIcode (257) terminates the stream.
 *   - KwKwK case: code equals the next-to-be-allocated entry → emit prev + prev[0].
 *
 * The dictionary is stored as parallel `prefix`/`suffix`/`entryLen` arrays with a
 * reusable decode stack (the same technique as gif-lzw.ts), so each code expands
 * in O(code-length) with no per-entry allocation or buffer copy. The previous
 * implementation stored every dictionary entry as a fully-expanded byte string
 * rebuilt with `concat`, which is quadratic in time and allocations on large
 * LZW-compressed strips (TIFF Compression=5).
 *
 * lzwEncode is not implemented in second pass (stub throws).
 *
 * Width transitions (post-6.0 correction):
 *   codes   0..510  → 9-bit
 *   codes 511..1022 → 10-bit
 *   codes 1023..2046 → 11-bit
 *   codes 2047..4094 → 12-bit
 *   dictionary full at 4094 → stay at 12-bit until ClearCode
 */

import { MAX_DECOMPRESSED_STRIP_BYTES, MAX_LZW_EXPANSION_RATIO } from './constants.ts';
import { TiffLzwDecodeError, TiffUnsupportedFeatureError } from './errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLEAR_CODE = 256;
const EOI_CODE = 257;
const FIRST_DICT_CODE = 258;
const MAX_DICT_SIZE = 4096;

// Width expands AFTER the next entry would equal these thresholds.
// Post-6.0 fix: expand at 510 (not 511), 1022, 2046, then cap at 12.
const EXPAND_AT_9BIT = 510;
const EXPAND_AT_10BIT = 1022;
const EXPAND_AT_11BIT = 2046;

// ---------------------------------------------------------------------------
// BitReader — MSB-first bit extraction
// ---------------------------------------------------------------------------

/** Reads variable-width codes MSB-first from a byte buffer (Trap #9). */
class MsbBitReader {
  private readonly buf: Uint8Array;
  private bytePos = 0;
  private bitPos = 0; // bit offset within current byte (0=MSB=7, 7=LSB=0)

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  /** Read `width` bits MSB-first. Returns -1 if the buffer is exhausted. */
  readBits(width: number): number {
    let result = 0;
    for (let i = 0; i < width; i++) {
      if (this.bytePos >= this.buf.length) return -1;
      const byte = this.buf[this.bytePos] ?? 0;
      // Extract bit at current position (7 = MSB, 0 = LSB)
      const bitValue = (byte >> (7 - this.bitPos)) & 1;
      result = (result << 1) | bitValue;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
    return result;
  }

  get exhausted(): boolean {
    return this.bytePos >= this.buf.length;
  }
}

// ---------------------------------------------------------------------------
// Public decoder
// ---------------------------------------------------------------------------

/**
 * Decompress a single TIFF LZW-compressed strip.
 *
 * `expectedBytes` is used only for the expansion-ratio cap. If provided and
 * the uncompressed output would exceed `MAX_LZW_EXPANSION_RATIO * input.length`
 * OR `MAX_DECOMPRESSED_STRIP_BYTES`, the function throws.
 */
export function lzwDecode(input: Uint8Array, expectedBytes?: number): Uint8Array {
  const maxOut = Math.min(
    MAX_DECOMPRESSED_STRIP_BYTES,
    expectedBytes != null
      ? Math.max(expectedBytes, input.length * MAX_LZW_EXPANSION_RATIO)
      : input.length * MAX_LZW_EXPANSION_RATIO,
  );

  const reader = new MsbBitReader(input);

  // Dictionary as parallel arrays:
  //   prefix[c]   = parent code (-1 for the 0..255 single-byte roots)
  //   suffix[c]   = the appended (last) byte of entry c
  //   entryLen[c] = decoded length of entry c (used for the pre-write cap check)
  // Codes 256 (Clear) and 257 (EOI) are reserved sentinels, never data.
  const prefix = new Int32Array(MAX_DICT_SIZE);
  const suffix = new Uint8Array(MAX_DICT_SIZE);
  const entryLen = new Int32Array(MAX_DICT_SIZE);
  // Reusable stack for reversing a dictionary chain during expansion. The
  // longest possible entry is bounded by the dictionary size.
  const stack = new Uint8Array(MAX_DICT_SIZE + 1);

  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    entryLen[i] = 1;
  }

  let nextCode = FIRST_DICT_CODE;
  let codeWidth = 9;
  let prevCode = -1; // analogous to "no previous entry yet"
  let seenClear = false;

  // M-3 (security): guard against ClearCode storm (repeated resets burn CPU/GC).
  // Legitimate LZW streams emit 1 ClearCode at start, then 0-2 mid-stream.
  // Bound per-strip ClearCode count to input.length — a generous cap.
  let clearCount = 0;
  const MAX_CLEAR_CODES = input.length;

  // Growable output buffer: doubles on demand, hard-capped at maxOut. Avoids
  // both the per-entry allocations of the old chunk list and pre-allocating the
  // full (up to 256 MiB) cap up front.
  let out = new Uint8Array(Math.min(maxOut, Math.max(64, input.length * 4)));
  let off = 0;

  const ensureCapacity = (extra: number): void => {
    if (off + extra <= out.length) return;
    let newLen = out.length === 0 ? 64 : out.length;
    while (newLen < off + extra) newLen *= 2;
    if (newLen > maxOut) newLen = maxOut;
    const bigger = new Uint8Array(newLen);
    bigger.set(out.subarray(0, off));
    out = bigger;
  };

  for (;;) {
    const code = reader.readBits(codeWidth);
    if (code === -1) break; // buffer exhausted (treat as implicit EOI)

    if (code === EOI_CODE) break;

    if (code === CLEAR_CODE) {
      clearCount++;
      if (clearCount > MAX_CLEAR_CODES) {
        throw new TiffLzwDecodeError('excessive ClearCodes — possible decompression bomb');
      }
      nextCode = FIRST_DICT_CODE;
      codeWidth = 9;
      prevCode = -1;
      seenClear = true;
      continue;
    }

    if (!seenClear) {
      throw new TiffLzwDecodeError('pixel data begins before ClearCode');
    }

    // Determine the entry length for this code (two valid cases + range error).
    let entryLength: number;
    let isKwKwK = false;

    if (code < nextCode) {
      entryLength = entryLen[code] ?? 0;
    } else if (code === nextCode) {
      // KwKwK case: code equals the not-yet-allocated entry → prev + prev[0].
      if (prevCode === -1) {
        throw new TiffLzwDecodeError('KwKwK case encountered without previous entry');
      }
      isKwKwK = true;
      entryLength = (entryLen[prevCode] ?? 0) + 1;
    } else {
      throw new TiffLzwDecodeError(`code ${code} is out of range (next expected ${nextCode})`);
    }

    // Output — hostile-input expansion cap; reachable only via a crafted LZW bomb
    /* v8 ignore next 4 */
    if (off + entryLength > maxOut) {
      throw new TiffLzwDecodeError(
        `LZW expansion exceeds cap (${maxOut} bytes). Possible corrupt data or hostile input.`,
      );
    }

    // Walk the prefix chain of the source code (the current code, or prevCode for
    // KwKwK) into the stack, yielding bytes leaf-first. Well-formed chains strictly
    // decrease, so the loop always terminates; the bound is purely defensive.
    let top = 0;
    let c = isKwKwK ? prevCode : code;
    while (c >= FIRST_DICT_CODE) {
      stack[top++] = suffix[c] ?? 0;
      c = prefix[c] ?? -1;
      /* v8 ignore next */
      if (c < 0 || top > MAX_DICT_SIZE) break;
    }
    stack[top++] = c & 0xff; // terminal root byte
    const firstByte = stack[top - 1] ?? 0; // root = first byte of the string

    ensureCapacity(entryLength);
    // Emit the chain in order (root → leaf) by reversing the stack...
    for (let i = top - 1; i >= 0; i--) {
      out[off++] = stack[i] ?? 0;
    }
    // ...and for KwKwK append the first byte of the previous string at the end.
    if (isKwKwK) {
      out[off++] = firstByte;
    }

    // Add the new dictionary entry (prev + firstByte of the current entry).
    if (prevCode !== -1 && nextCode < MAX_DICT_SIZE) {
      prefix[nextCode] = prevCode;
      suffix[nextCode] = firstByte;
      entryLen[nextCode] = (entryLen[prevCode] ?? 0) + 1;
      nextCode++;

      // Widen code after the threshold (Trap #10: boundary is 510, not 511)
      if (codeWidth === 9 && nextCode > EXPAND_AT_9BIT) codeWidth = 10;
      else if (codeWidth === 10 && nextCode > EXPAND_AT_10BIT) codeWidth = 11;
      else if (codeWidth === 11 && nextCode > EXPAND_AT_11BIT) codeWidth = 12;
      // At 12-bit, stay at 12 until ClearCode (Trap #10)
    }

    prevCode = code;
  }

  return off === out.length ? out : out.slice(0, off);
}

// ---------------------------------------------------------------------------
// Stub encoder
// ---------------------------------------------------------------------------

/**
 * LZW encoder — NOT implemented in second pass.
 * The serializer always writes Compression=1 (NONE), so this is never called.
 */
export function lzwEncode(_input: Uint8Array): Uint8Array {
  throw new TiffUnsupportedFeatureError('lzw-encode-not-implemented');
}
