/**
 * MP3 muxer — serialize an Mp3File back to a Uint8Array.
 *
 * Phase 1 policy:
 * - Frames are written verbatim (no re-encoding).
 * - MPEG 2.5 frames are rejected (Mp3Mpeg25EncodeNotSupportedError).
 * - ID3v2 written without unsynchronisation.
 * - ID3v1 preserved verbatim if present in input.
 * - Xing header frame written verbatim (the silent frame data from the original).
 */

import { Mp3Mpeg25EncodeNotSupportedError } from './errors.ts';
import type { Mp3Frame } from './frame-header.ts';
import type { Id3v1Tag } from './id3v1.ts';
import { serializeId3v1 } from './id3v1.ts';
import type { Id3v2Tag } from './id3v2.ts';
import { serializeId3v2 } from './id3v2.ts';
import type { Mp3File } from './parser.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize an Mp3File to a canonical MP3 byte stream.
 *
 * Throws:
 * - `Mp3Mpeg25EncodeNotSupportedError` — if any frame has version '2.5'
 */
export function serializeMp3(file: Mp3File): Uint8Array {
  // Validate: reject MPEG 2.5 frames.
  for (const frame of file.frames) {
    if (frame.header.version === '2.5') {
      throw new Mp3Mpeg25EncodeNotSupportedError();
    }
  }

  const parts: Uint8Array[] = [];

  // 1. ID3v2 tag.
  if (file.id3v2 !== undefined) {
    parts.push(serializeId3v2(file.id3v2));
  }

  // 2. Xing/Info/VBRI frame (verbatim — stored as the original silent frame).
  if (file.xingHeader !== undefined && file.xingHeader._frameData !== undefined) {
    parts.push(file.xingHeader._frameData);
  }

  // 3. Audio frames (verbatim).
  for (const frame of file.frames) {
    parts.push(frame.data);
  }

  // 4. ID3v1 tag.
  if (file.id3v1 !== undefined) {
    parts.push(serializeId3v1(file.id3v1));
  }

  return concatBytes(parts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Re-export types used by consumers.
export type { Mp3File, Mp3Frame, Id3v2Tag, Id3v1Tag };
