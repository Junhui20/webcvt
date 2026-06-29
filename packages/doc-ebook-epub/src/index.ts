/**
 * @catlabtech/webcvt-doc-ebook-epub — Public API
 *
 * A self-written, read-only EPUB (EPUB 3.3 OCF + OPF) reader that composes two
 * hardened webcvt packages:
 *   - @catlabtech/webcvt-archive-zip — `parseZip` (zip-slip + decompression-bomb
 *     protection) reads the OCF ZIP container.
 *   - @catlabtech/webcvt-data-text   — `parseXml` (DOCTYPE / ENTITY / XXE
 *     rejection) parses `container.xml` and the OPF package document.
 *
 * Scope: read-only EPUB → text / html / json. It does NOT author or write EPUBs.
 *
 * Clean-room: implemented from the W3C EPUB 3.3 OCF + Packages specifications,
 * not ported from epub.js / epubjs / readium.
 *
 * Security: 256 MiB input cap, manifest (10,000) and spine (5,000) item caps, a
 * 64 MiB concatenated-output cap, a depth-bounded OPF/container tree walk, and
 * `../` path-traversal rejection on every manifest/spine href. ZIP and XML bomb
 * protection is delegated to the two composed packages.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { EpubBook, EpubChapter, EpubManifestItem, EpubMetadata } from './model.ts';
export type { ParsedOpf } from './opf.ts';

// ---------------------------------------------------------------------------
// Reader API
// ---------------------------------------------------------------------------

export { parseEpub, resolveHref } from './parser.ts';
export { parseContainerXml } from './ocf.ts';
export { parseOpf } from './opf.ts';

// ---------------------------------------------------------------------------
// Backend + format descriptor + output serialisers
// ---------------------------------------------------------------------------

export {
  EpubBackend,
  EPUB_FORMAT,
  concatWithCap,
  serializeBookToHtml,
  serializeBookToJson,
  serializeBookToText,
} from './backend.ts';

// ---------------------------------------------------------------------------
// Low-level helpers (exported for advanced consumers / testing)
// ---------------------------------------------------------------------------

export { htmlToText } from './html-to-text.ts';

// ---------------------------------------------------------------------------
// Errors (typed, for instanceof checks by consumers)
// ---------------------------------------------------------------------------

export {
  EpubInputTooLargeError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubMissingContainerError,
  EpubMissingContentError,
  EpubMissingOpfError,
  EpubOutputTooLargeError,
  EpubPathTraversalError,
  EpubTooManyManifestItemsError,
  EpubTooManySpineItemsError,
} from './errors.ts';
