/**
 * Segment Info element (ID 0x1549A966) decode and encode for Matroska.
 *
 * MKV Info adds: SegmentUID (optional 16-byte binary), Title (optional utf-8),
 * DateUTC (optional). These are preserved on round-trip.
 *
 * TimecodeScale default is 1_000_000 ns — Trap §4.
 */

import {
  concatBytes,
  findChild,
  readFloat,
  readUintNumber,
  readUtf8,
  writeFloat64,
  writeUint,
  writeVintId,
  writeVintSize,
} from '@catlabtech/webcvt-ebml';
import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import {
  DEFAULT_TIMECODE_SCALE,
  ID_DATE_UTC,
  ID_DURATION,
  ID_INFO,
  ID_MUXING_APP,
  ID_SEGMENT_UID,
  ID_TIMECODE_SCALE,
  ID_TITLE,
  ID_WRITING_APP,
} from '../constants.ts';
import {
  encodeBinaryElement,
  encodeMasterElement,
  encodeUintElement,
  encodeUtf8Element,
} from './header.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MkvInfo {
  /** Nanoseconds per TimecodeScale tick. Default 1_000_000. */
  timecodeScale: number;
  /** Duration in TimecodeScale units (float). Optional. */
  duration?: number;
  /** Muxing application string. */
  muxingApp: string;
  /** Writing application string. */
  writingApp: string;
  /** Optional 16-byte SegmentUID. */
  segmentUid?: Uint8Array;
  /** Optional file title. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/**
 * Decode the Info element from its children.
 * Trap §4: TimecodeScale defaults to 1_000_000 ns if absent.
 */
export function decodeInfo(bytes: Uint8Array, children: EbmlElement[]): MkvInfo {
  const timecodeScaleElem = findChild(children, ID_TIMECODE_SCALE);
  const timecodeScale = timecodeScaleElem
    ? readUintNumber(bytes.subarray(timecodeScaleElem.payloadOffset, timecodeScaleElem.nextOffset))
    : DEFAULT_TIMECODE_SCALE;

  const durationElem = findChild(children, ID_DURATION);
  const duration = durationElem
    ? readFloat(bytes.subarray(durationElem.payloadOffset, durationElem.nextOffset))
    : undefined;

  const muxingAppElem = findChild(children, ID_MUXING_APP);
  const muxingApp = muxingAppElem
    ? readUtf8(bytes.subarray(muxingAppElem.payloadOffset, muxingAppElem.nextOffset))
    : '';

  const writingAppElem = findChild(children, ID_WRITING_APP);
  const writingApp = writingAppElem
    ? readUtf8(bytes.subarray(writingAppElem.payloadOffset, writingAppElem.nextOffset))
    : '';

  const segmentUidElem = findChild(children, ID_SEGMENT_UID);
  const segmentUid = segmentUidElem
    ? bytes.subarray(segmentUidElem.payloadOffset, segmentUidElem.nextOffset).slice()
    : undefined;

  const titleElem = findChild(children, ID_TITLE);
  const title = titleElem
    ? readUtf8(bytes.subarray(titleElem.payloadOffset, titleElem.nextOffset))
    : undefined;

  return { timecodeScale, duration, muxingApp, writingApp, segmentUid, title };
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/** Canonical muxing/writing app string for files this package produces. */
export const WEBCVT_MKV_APP_STRING = '@catlabtech/webcvt-container-mkv';

/**
 * Encode the Info element to bytes.
 */
export function encodeInfo(info: MkvInfo): Uint8Array {
  const parts: Uint8Array[] = [encodeUintElement(ID_TIMECODE_SCALE, BigInt(info.timecodeScale))];

  if (info.duration !== undefined && !Number.isNaN(info.duration)) {
    const idBytes = writeVintId(ID_DURATION);
    const payload = writeFloat64(info.duration);
    const sizeBytes = writeVintSize(BigInt(payload.length));
    parts.push(concatBytes([idBytes, sizeBytes, payload]));
  }

  if (info.segmentUid !== undefined && info.segmentUid.length === 16) {
    parts.push(encodeBinaryElement(ID_SEGMENT_UID, info.segmentUid));
  }

  if (info.title !== undefined) {
    parts.push(encodeUtf8Element(ID_TITLE, info.title));
  }

  parts.push(encodeUtf8Element(ID_MUXING_APP, info.muxingApp || WEBCVT_MKV_APP_STRING));
  parts.push(encodeUtf8Element(ID_WRITING_APP, info.writingApp || WEBCVT_MKV_APP_STRING));

  return encodeMasterElement(ID_INFO, concatBytes(parts));
}
