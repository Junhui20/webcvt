/**
 * Animation format detection via magic bytes.
 *
 * detectAnimationFormat(input) inspects the first bytes of input and returns:
 * - 'gif' for GIF87a/GIF89a
 * - 'apng' for PNG signature + acTL chunk within first 64 KiB
 * - 'webp-anim' for RIFF....WEBP + VP8X with animation flag set
 * - null for everything else (static PNG, static WebP, unknown)
 *
 * Detection is NOT applied automatically inside parseAnimation — callers pass
 * format explicitly to avoid double-scanning and magic-byte coincidences.
 */

import { MAX_PNG_CHUNK_BYTES, VP8X_ANIMATION_FLAG } from './constants.ts';
import type { AnimationFormat } from './types.ts';

const GIF87A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const APNG_SCAN_LIMIT = 64 * 1024; // 64 KiB

function matchesAt(buf: Uint8Array, offset: number, magic: Uint8Array): boolean {
  if (buf.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if ((buf[offset + i] ?? 0) !== (magic[i] ?? 0)) return false;
  }
  return true;
}

function readU32Le(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Sniff `input` and return 'gif', 'apng', 'webp-anim', or null.
 *
 * For APNG: returns 'apng' only if an acTL chunk exists in the first 64 KiB.
 * For WebP-anim: returns 'webp-anim' only if VP8X has the animation flag set.
 * A static PNG returns null; a static WebP returns null.
 */
export function detectAnimationFormat(input: Uint8Array): AnimationFormat | null {
  if (input.length < 12) return null;

  // GIF87a / GIF89a
  if (matchesAt(input, 0, GIF87A) || matchesAt(input, 0, GIF89A)) return 'gif';

  // PNG signature → scan for acTL to identify APNG
  if (matchesAt(input, 0, PNG_SIG)) {
    const limit = Math.min(input.length, APNG_SCAN_LIMIT);
    let offset = 8;
    while (offset + 12 <= limit) {
      // PNG chunk length is big-endian
      /* v8 ignore next 6 — offset+3 in bounds: while guard (offset+12 <= limit <= input.length) ensures in-bounds reads */
      const lengthBE =
        (((input[offset] ?? 0) << 24) |
          ((input[offset + 1] ?? 0) << 16) |
          ((input[offset + 2] ?? 0) << 8) |
          (input[offset + 3] ?? 0)) >>>
        0;
      /* v8 ignore next 6 — offset+4..7 in bounds: while guard ensures offset+12 <= limit */
      const type = String.fromCharCode(
        input[offset + 4] ?? 0,
        input[offset + 5] ?? 0,
        input[offset + 6] ?? 0,
        input[offset + 7] ?? 0,
      );
      if (type === 'acTL') return 'apng';
      if (type === 'IDAT' || type === 'IEND') break; // past where acTL must appear
      // MED-2: cap chunk advance to prevent u32 overflow; break on suspicious length
      const effectiveLen = Math.min(lengthBE, MAX_PNG_CHUNK_BYTES);
      if (lengthBE > MAX_PNG_CHUNK_BYTES) break; // suspicious chunk — stop scanning
      offset += 4 + 4 + effectiveLen + 4; // length + type + data + CRC
    }
    return null; // static PNG
  }

  // RIFF....WEBP → check VP8X animation flag
  if (matchesAt(input, 0, new Uint8Array([0x52, 0x49, 0x46, 0x46]))) {
    /* v8 ignore next 1 — input.length < 12 is already checked at line 49; this guard is unreachable */
    if (input.length < 12) return null;
    /* v8 ignore next 6 — input[8..11] in bounds: input.length >= 12 guaranteed above */
    const fourcc = String.fromCharCode(
      input[8] ?? 0,
      input[9] ?? 0,
      input[10] ?? 0,
      input[11] ?? 0,
    );
    if (fourcc !== 'WEBP') return null;

    // Walk to find VP8X chunk at offset 12
    /* v8 ignore next 1 — RIFF magic is 4 bytes and input.length >= 12 at this point; reaching < 24 would need a 12-23 byte RIFF, which is structurally invalid per RIFF spec but defensively checked */
    if (input.length < 24) return null;
    /* v8 ignore next 6 — input[12..15] in bounds: input.length >= 24 guaranteed above */
    const chunkFourcc = String.fromCharCode(
      input[12] ?? 0,
      input[13] ?? 0,
      input[14] ?? 0,
      input[15] ?? 0,
    );
    if (chunkFourcc !== 'VP8X') return null;

    // VP8X payload starts at offset 20 (12 + 8 header bytes)
    /* v8 ignore next 1 — input[20] in bounds: input.length >= 24 > 20 */
    const vp8xFlags = input[20] ?? 0;
    if ((vp8xFlags & VP8X_ANIMATION_FLAG) !== 0) return 'webp-anim';
    return null; // static WebP with VP8X but no animation flag
  }

  return null;
}
