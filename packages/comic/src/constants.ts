/**
 * Shared security-cap, MIME, and container-signature constants for
 * @catlabtech/webcvt-comic.
 *
 * A comic book archive (CBZ / CBR / CB7) is untrusted input: a ZIP / RAR / 7z
 * container wrapping image pages. ZIP-bomb / zip-slip protection is delegated to
 * @catlabtech/webcvt-archive-zip's `parseZip`; per-image embedding limits are
 * delegated to @catlabtech/webcvt-doc-pdf's `imagesToPdf`. The caps below bound
 * the work this package itself performs (input size and page count). Modules
 * reference these constants; do not hardcode the values inline.
 */

// ---------------------------------------------------------------------------
// Input + structural caps
// ---------------------------------------------------------------------------

/**
 * Maximum raw input size in bytes (512 MiB). Comics — especially high-resolution
 * scans — are large, so this cap is higher than the ebook reader's. Checked
 * BEFORE any parsing.
 */
export const MAX_INPUT_BYTES = 512 * 1024 * 1024;

/**
 * Maximum number of image pages collected from a single comic archive (5,000).
 * Bounds memory and the downstream `imagesToPdf` page count even when the input
 * is within MAX_INPUT_BYTES but expands hugely after decompression.
 */
export const MAX_PAGES = 5_000;

// ---------------------------------------------------------------------------
// Container magic-byte signatures (offset 0)
// ---------------------------------------------------------------------------

/** ZIP local file header "PK\x03\x04" — a CBZ is a ZIP of image pages. */
export const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];

/**
 * RAR archive signature "Rar!\x1a\x07". The 7th byte distinguishes RAR 1.5–4.x
 * (0x00) from RAR5 (0x01); this 6-byte prefix is shared by both, so matching it
 * covers a CBR regardless of RAR version.
 */
export const RAR_MAGIC: readonly number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];

/** 7z archive signature "7z\xbc\xaf\x27\x1c" — a CB7 is a 7z of image pages. */
export const SEVENZIP_MAGIC: readonly number[] = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

// ---------------------------------------------------------------------------
// Page image extensions + their MIME types
// ---------------------------------------------------------------------------

/**
 * Lowercased file extensions (without the leading dot) recognised as comic page
 * images, mapped to the MIME type passed to `imagesToPdf`. Entries whose name
 * does not end in one of these are skipped (cover XML, ComicInfo.xml, fonts, …).
 */
export const IMAGE_EXT_TO_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

// ---------------------------------------------------------------------------
// Format MIME types
// ---------------------------------------------------------------------------

/** Canonical MIME type of a Comic Book ZIP archive. */
export const CBZ_MIME = 'application/vnd.comicbook+zip';

/** Canonical MIME type of a Comic Book RAR archive. */
export const CBR_MIME = 'application/vnd.comicbook-rar';

/** MIME type of a Comic Book 7z archive. */
export const CB7_MIME = 'application/x-cb7';

/** Output MIME type (the `pdf` conversion target). */
export const PDF_MIME = 'application/pdf';
