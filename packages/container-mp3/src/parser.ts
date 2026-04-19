/**
 * MP3 demuxer — parse a Uint8Array into an Mp3File.
 *
 * Algorithm:
 * 1. Skip ID3v2 tag if present.
 * 2. Check for ID3v1 at end; mark audio scan boundary.
 * 3. Frame scan: find sync, parse header, check for Xing in first frame.
 * 4. Collect all audio frames.
 *
 * Ref: ISO/IEC 11172-3:1993 §2.4
 */

import { Mp3InvalidFrameError } from './errors.ts';
import type { Mp3Frame } from './frame-header.ts';
import { parseMp3FrameHeader } from './frame-header.ts';
import type { Id3v1Tag } from './id3v1.ts';
import { parseId3v1 } from './id3v1.ts';
import type { Id3v2Tag } from './id3v2.ts';
import { parseId3v2 } from './id3v2.ts';
import type { XingHeader } from './xing.ts';
import { parseXingHeader } from './xing.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Mp3File {
  id3v2?: Id3v2Tag;
  /** If first frame is a Xing/Info/VBRI metadata frame, it lives here. */
  xingHeader?: XingHeader;
  frames: Mp3Frame[];
  id3v1?: Id3v1Tag;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ID3V1_SIZE = 128;
const APE_MAGIC = [0x41, 0x50, 0x45, 0x54, 0x41, 0x47, 0x45, 0x58]; // "APETAGEX"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete MP3 file from raw bytes.
 *
 * Throws:
 * - `Mp3FreeFormatError` — free-format frame encountered (bitrate_index == 0)
 * - `Mp3InvalidFrameError` — no valid frame found, or header fields invalid
 */
export function parseMp3(input: Uint8Array): Mp3File {
  let cursor = 0;

  // Step 1: Parse ID3v2 tag at start.
  let id3v2: Id3v2Tag | undefined;
  const id3Result = parseId3v2(input);
  if (id3Result !== null) {
    id3v2 = id3Result.tag;
    cursor = id3Result.tagSize;
  }

  // Step 2: Determine end-of-audio boundary.
  // ID3v1 tag occupies the last 128 bytes.
  // APE tags may appear between last audio frame and ID3v1 — skip them.
  let audioEnd = input.length;
  let id3v1: Id3v1Tag | undefined;

  const v1 = parseId3v1(input);
  if (v1 !== null) {
    id3v1 = v1;
    audioEnd = input.length - ID3V1_SIZE;
  }

  // Scan backward to skip any APE tag that might precede the ID3v1 boundary.
  audioEnd = skipApeTag(input, audioEnd);

  // Step 3: Frame scan loop.
  const frames: Mp3Frame[] = [];
  let xingHeader: XingHeader | undefined;
  let isFirstFrame = true;

  while (cursor < audioEnd) {
    // Require sync at current position, or scan forward.
    cursor = findSync(input, cursor, audioEnd);
    if (cursor < 0) break;

    // Need at least 4 bytes for a frame header.
    if (cursor + 4 > audioEnd) break;

    // Try to parse the frame header; null means no sync here → scan forward.
    // Throws propagate to caller (Mp3FreeFormatError, Mp3InvalidFrameError).
    const header = parseMp3FrameHeader(input, cursor);

    if (header === null) {
      cursor++;
      continue;
    }

    // Validate that the frame fits in the audio region.
    const frameEnd = cursor + header.frameBytes;
    if (frameEnd > audioEnd) {
      // Frame extends past the audio boundary — could be the last partial frame or
      // a false sync. Stop scanning.
      break;
    }

    const frameData = input.subarray(cursor, frameEnd);

    // Check for Xing/Info/VBRI in the very first frame.
    if (isFirstFrame) {
      isFirstFrame = false;
      const xing = parseXingHeader(frameData, header);
      if (xing !== null) {
        // Store the raw frame bytes for verbatim round-trip.
        xingHeader = { ...xing, _frameData: frameData };
        cursor = frameEnd;
        continue; // do NOT add this frame to frames[]
      }
    }

    frames.push({ header, data: frameData });
    cursor = frameEnd;
  }

  if (frames.length === 0 && xingHeader === undefined && id3v2 === undefined) {
    throw new Mp3InvalidFrameError('no valid MPEG audio frames found in input', 0);
  }

  return { id3v2, xingHeader, frames, id3v1 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan forward from `start` to find the next 11-bit sync word (0xFFE).
 * Returns the offset of the sync, or -1 if not found before `limit`.
 */
function findSync(bytes: Uint8Array, start: number, limit: number): number {
  for (let i = start; i < limit - 1; i++) {
    if (bytes[i] === 0xff && ((bytes[i + 1] ?? 0) & 0xe0) === 0xe0) {
      return i;
    }
  }
  return -1;
}

/**
 * Scan backward from `audioEnd` to detect and skip an APE tag.
 * APE tags are identified by "APETAGEX" magic. We skip the tag body.
 */
function skipApeTag(bytes: Uint8Array, audioEnd: number): number {
  // Minimum APE footer size is 32 bytes.
  if (audioEnd < 32) return audioEnd;

  const footerStart = audioEnd - 32;
  for (let i = 0; i < APE_MAGIC.length; i++) {
    if (bytes[footerStart + i] !== APE_MAGIC[i]) return audioEnd;
  }

  // APE footer found. The tag size is at offset 12 (4 bytes LE).
  const tagSize =
    (bytes[footerStart + 12] ?? 0) |
    ((bytes[footerStart + 13] ?? 0) << 8) |
    ((bytes[footerStart + 14] ?? 0) << 16) |
    ((bytes[footerStart + 15] ?? 0) << 24);

  // APE footer's tagSize field includes the 32-byte footer itself but
  // excludes the optional header. Skip the whole tag.
  //
  // Security: tagSize < 32 is malformed — the footer alone is 32 bytes by spec.
  // Such a value would set newEnd inside the footer itself, exposing tag bytes
  // to the frame scanner. Treat it as absent.
  if (tagSize < 32) return audioEnd;
  const newEnd = audioEnd - tagSize;
  if (newEnd <= 0 || newEnd >= footerStart) return audioEnd;
  return newEnd;
}
