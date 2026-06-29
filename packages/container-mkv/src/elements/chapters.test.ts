/**
 * Tests for Chapters decode (chapters.ts).
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { concatBytes } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import {
  ID_CHAPTERS,
  ID_CHAPTER_ATOM,
  ID_CHAPTER_DISPLAY,
  ID_CHAPTER_TIME_END,
  ID_CHAPTER_TIME_START,
  ID_CHAPTER_UID,
  ID_CHAP_LANGUAGE,
  ID_CHAP_STRING,
  ID_EDITION_ENTRY,
} from '../constants.ts';
import { decodeChapters } from './chapters.ts';
import {
  encodeMasterElement,
  encodeStringElement,
  encodeUintElement,
  encodeUtf8Element,
} from './header.ts';

/** Wrap a payload buffer in a synthetic Chapters EbmlElement spanning the whole buffer. */
function asChaptersElem(payload: Uint8Array): { bytes: Uint8Array; elem: EbmlElement } {
  return {
    bytes: payload,
    elem: {
      id: ID_CHAPTERS,
      size: BigInt(payload.length),
      payloadOffset: 0,
      nextOffset: payload.length,
      idWidth: 0,
      sizeWidth: 0,
    },
  };
}

function display(title: string, language: string): Uint8Array {
  return encodeMasterElement(
    ID_CHAPTER_DISPLAY,
    concatBytes([
      encodeUtf8Element(ID_CHAP_STRING, title),
      encodeStringElement(ID_CHAP_LANGUAGE, language),
    ]),
  );
}

describe('decodeChapters', () => {
  it('decodes two chapters with titles, times and language', () => {
    const atom0 = encodeMasterElement(
      ID_CHAPTER_ATOM,
      concatBytes([
        encodeUintElement(ID_CHAPTER_UID, 11n),
        encodeUintElement(ID_CHAPTER_TIME_START, 0n),
        encodeUintElement(ID_CHAPTER_TIME_END, 5_000_000_000n),
        display('Intro', 'eng'),
      ]),
    );
    const atom1 = encodeMasterElement(
      ID_CHAPTER_ATOM,
      concatBytes([
        encodeUintElement(ID_CHAPTER_UID, 22n),
        encodeUintElement(ID_CHAPTER_TIME_START, 5_000_000_000n),
        display('Main', 'eng'),
      ]),
    );
    const edition = encodeMasterElement(ID_EDITION_ENTRY, concatBytes([atom0, atom1]));
    const { bytes, elem } = asChaptersElem(edition);
    const chapters = decodeChapters(bytes, elem);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      uid: 11n,
      startNs: 0,
      endNs: 5_000_000_000,
      title: 'Intro',
      language: 'eng',
    });
    expect(chapters[1]?.uid).toBe(22n);
    expect(chapters[1]?.endNs).toBeUndefined();
    expect(chapters[1]?.title).toBe('Main');
  });

  it('flattens nested ChapterAtoms (sub-chapters)', () => {
    const child = encodeMasterElement(
      ID_CHAPTER_ATOM,
      concatBytes([
        encodeUintElement(ID_CHAPTER_UID, 2n),
        encodeUintElement(ID_CHAPTER_TIME_START, 1_000n),
      ]),
    );
    const parent = encodeMasterElement(
      ID_CHAPTER_ATOM,
      concatBytes([
        encodeUintElement(ID_CHAPTER_UID, 1n),
        encodeUintElement(ID_CHAPTER_TIME_START, 0n),
        child,
      ]),
    );
    const edition = encodeMasterElement(ID_EDITION_ENTRY, parent);
    const { bytes, elem } = asChaptersElem(edition);
    const chapters = decodeChapters(bytes, elem);

    expect(chapters.map((c) => c.uid)).toEqual([1n, 2n]);
  });

  it('defaults uid to 0n and omits title when fields are absent', () => {
    const atom = encodeMasterElement(
      ID_CHAPTER_ATOM,
      encodeUintElement(ID_CHAPTER_TIME_START, 42n),
    );
    const edition = encodeMasterElement(ID_EDITION_ENTRY, atom);
    const { bytes, elem } = asChaptersElem(edition);
    const chapters = decodeChapters(bytes, elem);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.uid).toBe(0n);
    expect(chapters[0]?.startNs).toBe(42);
    expect(chapters[0]?.title).toBeUndefined();
    expect(chapters[0]?.language).toBeUndefined();
  });

  it('skips ChapterAtoms without ChapterTimeStart', () => {
    const atom = encodeMasterElement(ID_CHAPTER_ATOM, encodeUintElement(ID_CHAPTER_UID, 99n));
    const edition = encodeMasterElement(ID_EDITION_ENTRY, atom);
    const { bytes, elem } = asChaptersElem(edition);
    expect(decodeChapters(bytes, elem)).toEqual([]);
  });

  it('returns [] for a garbage Chapters payload', () => {
    const { bytes, elem } = asChaptersElem(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(decodeChapters(bytes, elem)).toEqual([]);
  });

  it('returns [] when there are no EditionEntry children', () => {
    const { bytes, elem } = asChaptersElem(new Uint8Array(0));
    expect(decodeChapters(bytes, elem)).toEqual([]);
  });
});
