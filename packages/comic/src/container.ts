/**
 * Comic container detection by magic bytes.
 *
 * A comic book archive's real type is decided by its leading bytes, not its
 * filename extension (a `.cbz` may actually be a RAR, etc.). We match the three
 * archive signatures and return a discriminant so the parser can route to the
 * ZIP reader or raise a precise "deferred" error for RAR / 7z.
 *
 * Note: a plain `.zip` / `.rar` / `.7z` of images is byte-identical to a
 * CBZ / CBR / CB7 — the comic extension is purely conventional — so this detector
 * intentionally recognises the generic archive magics. Routing a comic-shaped
 * ZIP through the CBZ reader is exactly the desired behaviour.
 */

import { RAR_MAGIC, SEVENZIP_MAGIC, ZIP_MAGIC } from './constants.ts';

/** The recognised comic container kinds (`'unknown'` = no signature matched). */
export type ComicContainer = 'cbz' | 'cbr' | 'cb7' | 'unknown';

/** Returns true when `bytes` starts with the given signature at offset 0. */
function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detect the comic container kind from the input's leading bytes.
 *
 *   - `'cbz'` — ZIP local file header (`PK\x03\x04`).
 *   - `'cbr'` — RAR signature (`Rar!\x1a\x07`, both RAR4 and RAR5).
 *   - `'cb7'` — 7z signature (`7z\xbc\xaf\x27\x1c`).
 *   - `'unknown'` — none of the above.
 */
export function detectComicContainer(bytes: Uint8Array): ComicContainer {
  if (startsWith(bytes, ZIP_MAGIC)) return 'cbz';
  if (startsWith(bytes, RAR_MAGIC)) return 'cbr';
  if (startsWith(bytes, SEVENZIP_MAGIC)) return 'cb7';
  return 'unknown';
}
