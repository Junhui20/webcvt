/**
 * Top-level animation serializer dispatch.
 *
 * serializeAnimation(file) switches on `file.format` to invoke the appropriate
 * format-specific serializer.
 */

import { serializeApng } from './apng.ts';
import { serializeGif } from './gif.ts';
import type { AnimationFile } from './types.ts';
import { serializeWebpAnim } from './webp-anim.ts';

/**
 * Serialize a typed animation file record back to its format's byte stream.
 *
 * @param file - A discriminated union of GifFile | ApngFile | WebpAnimFile.
 * @returns The encoded byte stream.
 */
export function serializeAnimation(file: AnimationFile): Uint8Array {
  switch (file.format) {
    case 'gif':
      return serializeGif(file);
    case 'apng':
      return serializeApng(file);
    case 'webp-anim':
      return serializeWebpAnim(file);
  }
}
