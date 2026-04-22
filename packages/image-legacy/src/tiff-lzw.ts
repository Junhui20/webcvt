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
// Dictionary helpers
// ---------------------------------------------------------------------------

function makeInitialDict(): Uint8Array[] {
  const dict = new Array<Uint8Array>(MAX_DICT_SIZE);
  // Codes 0..255: single-byte literals
  for (let i = 0; i < 256; i++) {
    dict[i] = new Uint8Array([i]);
  }
  // Codes 256 (ClearCode) and 257 (EOICode): placeholders, never looked up as data
  dict[CLEAR_CODE] = new Uint8Array(0);
  dict[EOI_CODE] = new Uint8Array(0);
  return dict;
}

/** Concatenate two Uint8Arrays efficiently (avoid spread for large arrays). */
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
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
  const chunks: Uint8Array[] = [];
  let totalOut = 0;

  // Build dictionary fresh; will be reset on ClearCode
  let dict: Uint8Array[] = makeInitialDict();
  let nextCode = FIRST_DICT_CODE;
  let codeWidth = 9;
  let prevEntry: Uint8Array | null = null;
  let seenClear = false;

  // M-3 (security): guard against ClearCode storm (repeated resets burn CPU/GC).
  // Legitimate LZW streams emit 1 ClearCode at start, then 0-2 mid-stream.
  // Bound per-strip ClearCode count to input.length — a generous cap.
  let clearCount = 0;
  const MAX_CLEAR_CODES = input.length;

  const resetDict = (): void => {
    dict = makeInitialDict();
    nextCode = FIRST_DICT_CODE;
    codeWidth = 9;
    prevEntry = null;
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
      resetDict();
      seenClear = true;
      continue;
    }

    if (!seenClear) {
      throw new TiffLzwDecodeError('pixel data begins before ClearCode');
    }

    // Determine the entry for this code
    let entry: Uint8Array;

    if (code < nextCode) {
      // Known code — look up in dict.
      // dict[code] is always defined for code < nextCode (every entry is set before nextCode
      // is incremented), so the undefined branch is structurally unreachable but kept for safety.
      const dictEntry = dict[code];
      /* v8 ignore next 3 */
      if (dictEntry === undefined) {
        throw new TiffLzwDecodeError(`code ${code} not in dictionary`);
      }
      entry = dictEntry;
    } else if (code === nextCode) {
      // KwKwK case: code equals next-to-be-allocated
      if (prevEntry === null) {
        throw new TiffLzwDecodeError('KwKwK case encountered without previous entry');
      }
      const firstByte = prevEntry[0] ?? 0;
      entry = concat(prevEntry, new Uint8Array([firstByte]));
    } else {
      throw new TiffLzwDecodeError(`code ${code} is out of range (next expected ${nextCode})`);
    }

    // Output — hostile-input expansion cap; reachable only via a crafted LZW bomb
    /* v8 ignore next 4 */
    if (totalOut + entry.length > maxOut) {
      throw new TiffLzwDecodeError(
        `LZW expansion exceeds cap (${maxOut} bytes). Possible corrupt data or hostile input.`,
      );
    }
    chunks.push(entry);
    totalOut += entry.length;

    // Add new dictionary entry (prev + entry[0]) when we have a previous entry
    if (prevEntry !== null && nextCode < MAX_DICT_SIZE) {
      const firstByte = entry[0] ?? 0;
      dict[nextCode] = concat(prevEntry, new Uint8Array([firstByte]));
      nextCode++;

      // Widen code after the threshold (Trap #10: boundary is 510, not 511)
      if (codeWidth === 9 && nextCode > EXPAND_AT_9BIT) codeWidth = 10;
      else if (codeWidth === 10 && nextCode > EXPAND_AT_10BIT) codeWidth = 11;
      else if (codeWidth === 11 && nextCode > EXPAND_AT_11BIT) codeWidth = 12;
      // At 12-bit, stay at 12 until ClearCode (Trap #10)
    }

    prevEntry = entry;
  }

  // Assemble output
  const out = new Uint8Array(totalOut);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
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
