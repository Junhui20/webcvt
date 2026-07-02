/**
 * @catlabtech/webcvt-font — Public API
 *
 * A self-written, dependency-free font-container converter for
 * sfnt (TTF/OTF) ↔ WOFF 1.0. The conversions are pure repackaging:
 *   - sfnt → WOFF: read the sfnt tables, zlib-deflate each (kept stored when
 *     compression does not help), and wrap them in a WOFF header + directory,
 *     each table block padded to 4 bytes. The sfnt flavor is preserved.
 *   - WOFF → sfnt: read the WOFF directory, inflate each compressed table,
 *     rebuild the sfnt offset table + directory + 4-byte-padded tables, and
 *     recompute head.checkSumAdjustment.
 *
 * Clean-room: implemented from the OpenType / ISO 14496-22 and WOFF 1.0 (W3C
 * Recommendation) specifications, not ported from any existing library.
 *
 * Out of scope: WOFF 2.0 (Brotli + glyf transform — throws a typed error) and
 * ttf↔otf outline/CFF conversion (only sfnt↔WOFF repackaging is performed).
 *
 * Security: 64 MiB input cap, 4096-table cap, per-table size cap, and a
 * cumulative decompression-bomb cap enforced while streaming.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { FontMeta, SfntFont, SfntTable } from './model.ts';

// ---------------------------------------------------------------------------
// Parsers / serialisers
// ---------------------------------------------------------------------------

export {
  computeChecksum,
  flavorToExt,
  isKnownSfntFlavor,
  parseSfnt,
  serializeSfnt,
} from './sfnt.ts';
export { parseWoff, serializeWoff } from './woff.ts';
export { readFontMeta } from './font-meta.ts';
export { deflate, inflate } from './compression.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptors
// ---------------------------------------------------------------------------

export { FontBackend, OTF_FORMAT, TTF_FORMAT, WOFF_FORMAT } from './backend.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  FontCollectionNotSupportedError,
  FontCompressionUnavailableError,
  FontDecompressionError,
  FontInputTooLargeError,
  FontInvalidSignatureError,
  FontMalformedError,
  FontTableTooLargeError,
  FontTooManyTablesError,
  FontWoff2NotSupportedError,
} from './errors.ts';

// ---------------------------------------------------------------------------
// registerFontBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { FontBackend } from './backend.ts';

/**
 * Construct a FontBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('font')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerFontBackend } from '@catlabtech/webcvt-font';
 * registerFontBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerFontBackend(registry: BackendRegistry = defaultRegistry): FontBackend {
  const backend = new FontBackend();
  registry.register(backend);
  return backend;
}
