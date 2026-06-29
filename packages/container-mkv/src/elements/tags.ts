/**
 * Tags element (ID 0x1254C367) decode for Matroska.
 *
 * Structure (RFC 9559 §5.1.8):
 *   Tags → Tag → SimpleTag (TagName + TagString [+ TagLanguage], possibly nested).
 *   SimpleTags may nest; nested SimpleTags are flattened into the returned list.
 *
 * Targets (the scope of each Tag) are not surfaced in this pass — only the
 * flattened name/value/language triples are returned.
 *
 * Caps: at most MAX_TAGS Tag elements, MAX_SIMPLE_TAGS flattened entries, nesting
 * depth MAX_TAG_DEPTH. Parsing is tolerant: malformed sub-elements are skipped.
 */

import { findChild, parseFlatChildren, readString, readUtf8 } from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  ID_SIMPLE_TAG,
  ID_TAG,
  ID_TAG_LANGUAGE,
  ID_TAG_NAME,
  ID_TAG_STRING,
  MAX_SIMPLE_TAGS,
  MAX_TAGS,
  MAX_TAG_DEPTH,
} from '../constants.ts';
import { MkvTooManyTagsError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvTag {
  /** TagName (UTF-8). */
  name: string;
  /** TagString (UTF-8); empty string when absent. */
  value: string;
  /** Optional TagLanguage (ISO-639). */
  language?: string;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode the Tags element into a flat list of name/value/language triples.
 *
 * @param bytes        Full file buffer.
 * @param tagsElem     The Tags master element descriptor.
 * @param elementCount Global element counter threaded from parseMkv.
 */
export function decodeTags(
  bytes: Uint8Array,
  tagsElem: EbmlElement,
  elementCount: { value: number } = { value: 0 },
): MkvTag[] {
  const out: MkvTag[] = [];
  const tagChildren = parseFlatChildren(bytes, tagsElem, elementCount);

  let tagCount = 0;
  for (const tag of tagChildren) {
    if (tag.id !== ID_TAG) continue;

    tagCount++;
    if (tagCount > MAX_TAGS) {
      throw new MkvTooManyTagsError(MAX_TAGS);
    }

    const simpleTags = parseFlatChildren(bytes, tag, elementCount);
    for (const simpleTag of simpleTags) {
      if (simpleTag.id !== ID_SIMPLE_TAG) continue;
      collectSimpleTag(bytes, simpleTag, out, elementCount, 0);
    }
  }

  return out;
}

function collectSimpleTag(
  bytes: Uint8Array,
  simpleTagElem: EbmlElement,
  out: MkvTag[],
  elementCount: { value: number },
  depth: number,
): void {
  if (depth > MAX_TAG_DEPTH) return;

  const children = parseFlatChildren(bytes, simpleTagElem, elementCount);

  const nameElem = findChild(children, ID_TAG_NAME);
  const name = nameElem
    ? readUtf8(bytes.subarray(nameElem.payloadOffset, nameElem.nextOffset))
    : '';

  // A SimpleTag without a TagName is malformed; skip the value but still recurse.
  if (name.length > 0) {
    if (out.length >= MAX_SIMPLE_TAGS) {
      throw new MkvTooManyTagsError(MAX_SIMPLE_TAGS);
    }

    const valueElem = findChild(children, ID_TAG_STRING);
    const value = valueElem
      ? readUtf8(bytes.subarray(valueElem.payloadOffset, valueElem.nextOffset))
      : '';

    const langElem = findChild(children, ID_TAG_LANGUAGE);
    const language = langElem
      ? readString(bytes.subarray(langElem.payloadOffset, langElem.nextOffset))
      : undefined;

    out.push({ name, value, language });
  }

  // Flatten nested SimpleTags.
  for (const child of children) {
    if (child.id === ID_SIMPLE_TAG) {
      collectSimpleTag(bytes, child, out, elementCount, depth + 1);
    }
  }
}
