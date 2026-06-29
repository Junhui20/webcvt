/**
 * Shared data model for @catlabtech/webcvt-font.
 *
 * An sfnt (TTF/OTF) container and the equivalent WOFF 1.0 file decode to the
 * SAME logical model: an sfnt `flavor` (the original sfnt version u32) plus a
 * list of named tables. This is what makes sfnt↔WOFF a pure repackaging.
 */

/** A single sfnt table: its 4-character tag and its raw (uncompressed) bytes. */
export interface SfntTable {
  /** 4-character ASCII tag, e.g. "head", "name", "glyf". */
  readonly tag: string;
  /** Uncompressed table payload (zero-copy subarray when produced by parseSfnt). */
  readonly data: Uint8Array;
}

/**
 * A parsed font, independent of its container envelope (sfnt or WOFF).
 *
 * `flavor` is the sfnt version u32 — 0x00010000 (TrueType), 'OTTO' (CFF),
 * 'true'/'typ1' (legacy Apple). It selects the output extension when emitting an
 * sfnt: 'OTTO' → .otf, everything else → .ttf.
 */
export interface SfntFont {
  /** The sfnt version / flavor as a u32 (preserved across repackaging). */
  readonly flavor: number;
  /** Tables in their source order (sfnt directory order or WOFF directory order). */
  readonly tables: readonly SfntTable[];
}

/** Best-effort metadata read from the `name`, `head`, and `maxp` tables. */
export interface FontMeta {
  /** name ID 1 — typographic family (e.g. "Inter"). */
  readonly familyName?: string;
  /** name ID 2 — subfamily / style (e.g. "Bold Italic"). */
  readonly subfamilyName?: string;
  /** name ID 4 — full font name (e.g. "Inter Bold Italic"). */
  readonly fullName?: string;
  /** head.unitsPerEm (design-grid resolution). */
  readonly unitsPerEm?: number;
  /** maxp.numGlyphs (glyph count). */
  readonly numGlyphs?: number;
}
