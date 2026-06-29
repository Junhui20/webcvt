/**
 * Tests for Tags decode (tags.ts).
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { concatBytes } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import {
  ID_SIMPLE_TAG,
  ID_TAG,
  ID_TAGS,
  ID_TAG_LANGUAGE,
  ID_TAG_NAME,
  ID_TAG_STRING,
} from '../constants.ts';
import { encodeMasterElement, encodeStringElement, encodeUtf8Element } from './header.ts';
import { decodeTags } from './tags.ts';

/** Wrap a payload buffer in a synthetic Tags EbmlElement spanning the whole buffer. */
function asTagsElem(payload: Uint8Array): { bytes: Uint8Array; elem: EbmlElement } {
  return {
    bytes: payload,
    elem: {
      id: ID_TAGS,
      size: BigInt(payload.length),
      payloadOffset: 0,
      nextOffset: payload.length,
      idWidth: 0,
      sizeWidth: 0,
    },
  };
}

function simpleTag(
  name: string | null,
  value: string | null,
  language: string | null,
  nested?: Uint8Array,
): Uint8Array {
  const parts: Uint8Array[] = [];
  if (name !== null) parts.push(encodeUtf8Element(ID_TAG_NAME, name));
  if (value !== null) parts.push(encodeUtf8Element(ID_TAG_STRING, value));
  if (language !== null) parts.push(encodeStringElement(ID_TAG_LANGUAGE, language));
  if (nested) parts.push(nested);
  return encodeMasterElement(ID_SIMPLE_TAG, concatBytes(parts));
}

describe('decodeTags', () => {
  it('decodes a few SimpleTags with name/value/language', () => {
    const tag = encodeMasterElement(
      ID_TAG,
      concatBytes([simpleTag('TITLE', 'My Movie', null), simpleTag('ARTIST', 'Someone', 'eng')]),
    );
    const { bytes, elem } = asTagsElem(tag);
    const tags = decodeTags(bytes, elem);

    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ name: 'TITLE', value: 'My Movie', language: undefined });
    expect(tags[1]).toEqual({ name: 'ARTIST', value: 'Someone', language: 'eng' });
  });

  it('flattens nested SimpleTags', () => {
    const nested = simpleTag('SUBTITLE', 'Episode 1', null);
    const tag = encodeMasterElement(ID_TAG, simpleTag('SHOW', 'Series', null, nested));
    const { bytes, elem } = asTagsElem(tag);
    const tags = decodeTags(bytes, elem);

    expect(tags.map((t) => t.name)).toEqual(['SHOW', 'SUBTITLE']);
    expect(tags[1]?.value).toBe('Episode 1');
  });

  it('defaults value to empty string when TagString is absent', () => {
    const tag = encodeMasterElement(ID_TAG, simpleTag('FLAG', null, null));
    const { bytes, elem } = asTagsElem(tag);
    const tags = decodeTags(bytes, elem);

    expect(tags).toHaveLength(1);
    expect(tags[0]?.value).toBe('');
  });

  it('skips SimpleTags without a TagName', () => {
    const tag = encodeMasterElement(ID_TAG, simpleTag(null, 'orphan value', null));
    const { bytes, elem } = asTagsElem(tag);
    expect(decodeTags(bytes, elem)).toEqual([]);
  });

  it('returns [] for an empty Tags payload', () => {
    const { bytes, elem } = asTagsElem(new Uint8Array(0));
    expect(decodeTags(bytes, elem)).toEqual([]);
  });

  it('returns [] for a garbage Tags payload', () => {
    const { bytes, elem } = asTagsElem(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(decodeTags(bytes, elem)).toEqual([]);
  });
});
