/**
 * Top-level animation parser dispatch.
 *
 * parseAnimation(input, format) switches on `format` to invoke the appropriate
 * format-specific parser. The format parameter must be passed explicitly by the
 * caller — we do NOT auto-detect to avoid double-scanning and magic-byte coincidences.
 */

import { parseApng } from './apng.ts';
import { parseGif } from './gif.ts';
import type { AnimationFile, AnimationFormat } from './types.ts';
import { parseWebpAnim } from './webp-anim.ts';

/**
 * Parse an animated image byte stream into the corresponding typed file record.
 *
 * @param input - The raw byte stream.
 * @param format - Which format to parse as ('gif', 'apng', or 'webp-anim').
 * @returns A discriminated union of GifFile | ApngFile | WebpAnimFile.
 */
export function parseAnimation(input: Uint8Array, format: AnimationFormat): AnimationFile {
  switch (format) {
    case 'gif':
      return parseGif(input);
    case 'apng':
      return parseApng(input);
    case 'webp-anim':
      return parseWebpAnim(input);
  }
}
