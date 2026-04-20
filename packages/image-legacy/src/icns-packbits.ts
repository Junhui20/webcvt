/**
 * PackBits decoder for ICNS — consumption-aware variant.
 *
 * ICNS uses the same PackBits algorithm as TIFF (Apple TN1023, 1985), but the
 * decoder must return BOTH the decompressed output AND the number of source
 * bytes consumed. This is needed because ICNS stores R, G, B planes
 * sequentially in a single element payload, and the decoder must advance
 * past each plane independently (Trap #2 in the design note).
 *
 * The algorithm is identical to TIFF packBitsDecode (Trap #8):
 *   - header byte n is treated as signed int8
 *   - n in [0, 127]   : copy n+1 literal bytes
 *   - n in [-127, -1] : repeat next byte (1-n) times
 *   - n === -128      : NO-OP, do not consume next byte
 *
 * Throws IcnsPackBitsDecodeError on corrupt input.
 */

import { IcnsPackBitsDecodeError } from './errors.ts';

export interface PackBitsDecodeResult {
  /** Decompressed output bytes (exactly `expected` bytes long). */
  output: Uint8Array;
  /** Number of bytes consumed from `input` starting at `offset`. */
  consumed: number;
}

/**
 * Decode exactly `expected` output bytes of PackBits data from `input`,
 * starting at `offset` and not reading past `inputEnd`.
 *
 * Returns both the decoded output and the number of input bytes consumed.
 */
export function packBitsDecodeConsume(
  input: Uint8Array,
  offset: number,
  inputEnd: number,
  expected: number,
): PackBitsDecodeResult {
  const out = new Uint8Array(expected);
  let src = offset;
  let dst = 0;

  while (dst < expected) {
    if (src >= inputEnd) {
      throw new IcnsPackBitsDecodeError(
        `source exhausted at byte ${src} with ${expected - dst} output bytes remaining`,
      );
    }

    const headerByte = input[src++] ?? 0;
    // Treat as signed int8 (Trap #7 from TIFF design, same algo here)
    const n = headerByte > 127 ? headerByte - 256 : headerByte;

    if (n === -128) {
      // NO-OP: do not consume next byte
      continue;
    }

    if (n >= 0) {
      // Copy n+1 literal bytes
      const len = n + 1;
      if (src + len > inputEnd) {
        throw new IcnsPackBitsDecodeError(
          `literal run of ${len} bytes at src=${src} exceeds input end ${inputEnd}`,
        );
      }
      if (dst + len > expected) {
        throw new IcnsPackBitsDecodeError(
          `literal run of ${len} bytes at dst=${dst} would exceed expected output ${expected}`,
        );
      }
      out.set(input.subarray(src, src + len), dst);
      src += len;
      dst += len;
    } else {
      // Repeat next byte (1 - n) times; n is in [-127, -1]
      const len = 1 - n;
      if (src >= inputEnd) {
        throw new IcnsPackBitsDecodeError(
          `repeat run at src=${src} needs repeat byte but source is exhausted`,
        );
      }
      if (dst + len > expected) {
        throw new IcnsPackBitsDecodeError(
          `repeat run of ${len} bytes at dst=${dst} would exceed expected output ${expected}`,
        );
      }
      const repeatByte = input[src++] ?? 0;
      out.fill(repeatByte, dst, dst + len);
      dst += len;
    }
  }

  return { output: out, consumed: src - offset };
}
