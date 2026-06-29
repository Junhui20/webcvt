/**
 * Chapters element (ID 0x1043A770) decode for Matroska.
 *
 * Structure (RFC 9559 §5.1.7):
 *   Chapters → EditionEntry → ChapterAtom
 *     ChapterUID, ChapterTimeStart (ns), optional ChapterTimeEnd (ns),
 *     ChapterDisplay → ChapString (UTF-8 title) + ChapLanguage.
 *   ChapterAtoms may nest; nested atoms are flattened into the returned list
 *   (depth-capped at MAX_CHAPTER_DEPTH, count-capped at MAX_CHAPTERS).
 *
 * Parsing is tolerant: malformed sub-elements are skipped rather than thrown,
 * so an unknown/garbage Chapters payload yields an empty list (the parser keeps
 * skipping Chapters it cannot understand instead of failing the whole file).
 */

import {
  findChild,
  parseFlatChildren,
  readString,
  readUint,
  readUtf8,
} from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  ID_CHAPTER_ATOM,
  ID_CHAPTER_DISPLAY,
  ID_CHAPTER_TIME_END,
  ID_CHAPTER_TIME_START,
  ID_CHAPTER_UID,
  ID_CHAP_LANGUAGE,
  ID_CHAP_STRING,
  ID_EDITION_ENTRY,
  MAX_CHAPTERS,
  MAX_CHAPTER_DEPTH,
} from '../constants.ts';
import { MkvTooManyChaptersError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvChapter {
  /** ChapterUID (0 when absent). */
  uid: bigint;
  /** ChapterTimeStart in nanoseconds (absolute, not TimecodeScale-scaled). */
  startNs: number;
  /** Optional ChapterTimeEnd in nanoseconds. */
  endNs?: number;
  /** First ChapterDisplay's ChapString, if present. */
  title?: string;
  /** First ChapterDisplay's ChapLanguage, if present. */
  language?: string;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode the Chapters element into a flat list of chapters.
 *
 * @param bytes         Full file buffer.
 * @param chaptersElem  The Chapters master element descriptor.
 * @param elementCount  Global element counter threaded from parseMkv.
 */
export function decodeChapters(
  bytes: Uint8Array,
  chaptersElem: EbmlElement,
  elementCount: { value: number } = { value: 0 },
): MkvChapter[] {
  const chapters: MkvChapter[] = [];
  const editionChildren = parseFlatChildren(bytes, chaptersElem, elementCount);

  for (const edition of editionChildren) {
    if (edition.id !== ID_EDITION_ENTRY) continue;

    const atoms = parseFlatChildren(bytes, edition, elementCount);
    for (const atom of atoms) {
      if (atom.id !== ID_CHAPTER_ATOM) continue;
      collectChapterAtom(bytes, atom, chapters, elementCount, 0);
    }
  }

  return chapters;
}

function collectChapterAtom(
  bytes: Uint8Array,
  atom: EbmlElement,
  out: MkvChapter[],
  elementCount: { value: number },
  depth: number,
): void {
  if (depth > MAX_CHAPTER_DEPTH) return;

  const children = parseFlatChildren(bytes, atom, elementCount);

  const startElem = findChild(children, ID_CHAPTER_TIME_START);
  if (startElem) {
    if (out.length >= MAX_CHAPTERS) {
      throw new MkvTooManyChaptersError(MAX_CHAPTERS);
    }

    const uidElem = findChild(children, ID_CHAPTER_UID);
    const uid = uidElem ? readUint(bytes.subarray(uidElem.payloadOffset, uidElem.nextOffset)) : 0n;

    const startNs = Number(readUint(bytes.subarray(startElem.payloadOffset, startElem.nextOffset)));

    const endElem = findChild(children, ID_CHAPTER_TIME_END);
    const endNs = endElem
      ? Number(readUint(bytes.subarray(endElem.payloadOffset, endElem.nextOffset)))
      : undefined;

    let title: string | undefined;
    let language: string | undefined;
    const displayElem = findChild(children, ID_CHAPTER_DISPLAY);
    if (displayElem) {
      const displayChildren = parseFlatChildren(bytes, displayElem, elementCount);

      const chapStringElem = findChild(displayChildren, ID_CHAP_STRING);
      if (chapStringElem) {
        title = readUtf8(bytes.subarray(chapStringElem.payloadOffset, chapStringElem.nextOffset));
      }

      const chapLangElem = findChild(displayChildren, ID_CHAP_LANGUAGE);
      if (chapLangElem) {
        language = readString(bytes.subarray(chapLangElem.payloadOffset, chapLangElem.nextOffset));
      }
    }

    out.push({ uid, startNs, endNs, title, language });
  }

  // Flatten nested ChapterAtoms (e.g. sub-chapters).
  for (const child of children) {
    if (child.id === ID_CHAPTER_ATOM) {
      collectChapterAtom(bytes, child, out, elementCount, depth + 1);
    }
  }
}
