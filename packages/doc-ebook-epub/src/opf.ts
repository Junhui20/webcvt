/**
 * OPF (Open Packaging Format) package-document reader — EPUB 3.3 Packages §4-6.
 *
 * The OPF is the heart of an EPUB: `<package>` carries the version; `<metadata>`
 * holds the Dublin Core record; `<manifest>` lists every resource; `<spine>`
 * gives the reading order via `<itemref idref>`. We rely on
 * @catlabtech/webcvt-data-text's `parseXml` for all XML security gating.
 *
 * Clean-room from the W3C EPUB Packages specification.
 */

import { type XmlElement, parseXml } from '@catlabtech/webcvt-data-text';
import { MAX_MANIFEST_ITEMS, MAX_SPINE_ITEMS } from './constants.ts';
import {
  EpubInvalidOpfError,
  EpubTooManyManifestItemsError,
  EpubTooManySpineItemsError,
} from './errors.ts';
import type { EpubManifestItem, EpubMetadata } from './model.ts';
import { allByLocalName, attrByLocalName, firstByLocalName, trimmedText } from './xml-util.ts';

/** The structured result of parsing an OPF package document. */
export interface ParsedOpf {
  /** `<package version>` attribute, if present. */
  readonly version?: string;
  /** Dublin Core metadata. */
  readonly metadata: EpubMetadata;
  /** Manifest items in document order. */
  readonly manifest: EpubManifestItem[];
  /** Spine `idref`s in reading order. */
  readonly spineIdrefs: string[];
}

function readMetadata(metadataEl: XmlElement): EpubMetadata {
  const creators: string[] = [];
  for (const creatorEl of allByLocalName(metadataEl, 'creator')) {
    const value = trimmedText(creatorEl);
    if (value !== undefined) creators.push(value);
  }

  const metadata: EpubMetadata = {
    title: trimmedText(firstByLocalName(metadataEl, 'title')),
    creators,
    language: trimmedText(firstByLocalName(metadataEl, 'language')),
    identifier: trimmedText(firstByLocalName(metadataEl, 'identifier')),
  };
  return metadata;
}

function readManifest(manifestEl: XmlElement): EpubManifestItem[] {
  const itemEls = allByLocalName(manifestEl, 'item');
  if (itemEls.length > MAX_MANIFEST_ITEMS) {
    throw new EpubTooManyManifestItemsError(itemEls.length, MAX_MANIFEST_ITEMS);
  }

  const items: EpubManifestItem[] = [];
  for (const itemEl of itemEls) {
    const id = attrByLocalName(itemEl, 'id');
    const href = attrByLocalName(itemEl, 'href');
    // An item must have both an id (to be referenced by the spine) and an href
    // (to be resolvable). Items missing either are skipped, not fatal.
    if (id === undefined || href === undefined || href.length === 0) continue;
    items.push({ id, href, mediaType: attrByLocalName(itemEl, 'media-type') ?? '' });
  }
  return items;
}

function readSpine(spineEl: XmlElement): string[] {
  const itemrefEls = allByLocalName(spineEl, 'itemref');
  if (itemrefEls.length > MAX_SPINE_ITEMS) {
    throw new EpubTooManySpineItemsError(itemrefEls.length, MAX_SPINE_ITEMS);
  }

  const idrefs: string[] = [];
  for (const itemrefEl of itemrefEls) {
    const idref = attrByLocalName(itemrefEl, 'idref');
    if (idref !== undefined && idref.length > 0) idrefs.push(idref);
  }
  return idrefs;
}

/**
 * Parse OPF package-document bytes into a {@link ParsedOpf}.
 *
 * @throws XML errors from `parseXml`, {@link EpubInvalidOpfError} for a missing
 *         required element, or the manifest/spine cap errors.
 */
export function parseOpf(bytes: Uint8Array): ParsedOpf {
  const file = parseXml(bytes);

  const packageEl = firstByLocalName(file.root, 'package');
  if (packageEl === undefined) {
    throw new EpubInvalidOpfError('missing the <package> root element.');
  }

  const metadataEl = firstByLocalName(packageEl, 'metadata');
  if (metadataEl === undefined) {
    throw new EpubInvalidOpfError('missing the <metadata> element.');
  }
  const manifestEl = firstByLocalName(packageEl, 'manifest');
  if (manifestEl === undefined) {
    throw new EpubInvalidOpfError('missing the <manifest> element.');
  }
  const spineEl = firstByLocalName(packageEl, 'spine');
  if (spineEl === undefined) {
    throw new EpubInvalidOpfError('missing the <spine> element.');
  }

  return {
    version: attrByLocalName(packageEl, 'version'),
    metadata: readMetadata(metadataEl),
    manifest: readManifest(manifestEl),
    spineIdrefs: readSpine(spineEl),
  };
}
