/**
 * Public data model for @catlabtech/webcvt-doc-ebook-epub.
 *
 * These types describe the structured shape returned by `parseEpub`. They are
 * plain data (no methods) so the metadata/spine/manifest portions round-trip
 * cleanly through `JSON.stringify` in the backend. Chapter `bytes` are decoded
 * to text on demand by the serialisers.
 *
 * Clean-room: modelled from the W3C EPUB 3.3 OCF (container) and Packages (OPF)
 * specifications. No code or types ported from epub.js / epubjs / readium.
 */

/** A single `<item>` from the OPF `<manifest>` (EPUB 3.3 Packages §4). */
export interface EpubManifestItem {
  /** The manifest item id (`id` attribute), unique within the OPF. */
  readonly id: string;
  /** The href exactly as declared in the OPF (relative to the OPF directory). */
  readonly href: string;
  /** The declared `media-type` (may be empty when the producer omitted it). */
  readonly mediaType: string;
}

/** One resolved spine content document. */
export interface EpubChapter {
  /** Resolved path of the document, relative to the OCF (zip) root. */
  readonly href: string;
  /** The manifest `media-type` for this document. */
  readonly mediaType: string;
  /** Raw, decompressed document bytes (decoded to text on demand). */
  readonly bytes: Uint8Array;
}

/** Dublin Core metadata extracted from the OPF `<metadata>` element. */
export interface EpubMetadata {
  /** `dc:title`, if present. */
  readonly title?: string;
  /** All `dc:creator` values, in document order (may be empty). */
  readonly creators: readonly string[];
  /** `dc:language`, if present. */
  readonly language?: string;
  /** First `dc:identifier`, if present. */
  readonly identifier?: string;
}

/** The fully parsed EPUB publication returned by `parseEpub`. */
export interface EpubBook {
  /** The OPF `<package version>` attribute (e.g. "3.0"), if declared. */
  readonly version?: string;
  /** Dublin Core metadata. */
  readonly metadata: EpubMetadata;
  /** Path of the OPF package document, relative to the OCF (zip) root. */
  readonly opfPath: string;
  /** Ordered spine: the reading order of content documents. */
  readonly spine: readonly EpubChapter[];
  /** All manifest items, in document order. */
  readonly manifest: readonly EpubManifestItem[];
}
