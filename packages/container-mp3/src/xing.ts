/**
 * Xing / Info / VBRI VBR header detection and decode.
 *
 * These headers appear in the payload of the first MPEG audio frame (which is
 * otherwise silent) to provide total frame count, byte count, seek table, and
 * quality information for VBR files. CBR files use "Info" (same layout as Xing).
 *
 * Xing/Info offset from frame start:
 *   MPEG-1 stereo: 4 (header) + 32 (side info) = 36
 *   MPEG-1 mono:   4 (header) + 17 (side info) = 21
 *   MPEG-2/2.5 stereo: 4 (header) + 17 (side info) = 21
 *   MPEG-2/2.5 mono:   4 (header) +  9 (side info) = 13
 *
 * VBRI offset: always 32 bytes from frame start (4 header + 28 fixed).
 *
 * Ref: https://www.codeproject.com/Articles/8295/MPEG-Audio-Frame-Header
 * Ref: http://gabriel.mp3-tech.org/mp3infotag.html
 */

import type { Mp3FrameHeader } from './frame-header.ts';
import { sideInfoSize } from './frame-header.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LameExtension {
  /** e.g. "Lavc60.31" */
  encoderString: string;
}

export interface XingHeader {
  kind: 'Xing' | 'Info' | 'VBRI';
  totalFrames?: number;
  totalBytes?: number;
  /** 100-byte seek table (TOC). */
  toc?: Uint8Array;
  qualityIndicator?: number;
  lame?: LameExtension;
  /**
   * Raw bytes of the original metadata frame (header + payload), stored for
   * verbatim round-trip serialization. Not part of the public API surface.
   * @internal
   */
  _frameData?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XING_MAGIC = [0x58, 0x69, 0x6e, 0x67]; // "Xing"
const INFO_MAGIC = [0x49, 0x6e, 0x66, 0x6f]; // "Info"
const VBRI_MAGIC = [0x56, 0x42, 0x52, 0x49]; // "VBRI"
const LAME_MAGIC = [0x4c, 0x61, 0x6d, 0x65]; // "Lame" prefix

/** Xing flags bits */
const XING_FLAG_FRAMES = 0x1;
const XING_FLAG_BYTES = 0x2;
const XING_FLAG_TOC = 0x4;
const XING_FLAG_QUALITY = 0x8;

/** VBRI header is always at offset 32 from frame start. */
const VBRI_FIXED_OFFSET = 32;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a Xing/Info or VBRI header from the first frame.
 *
 * `frameData` is the raw bytes of the complete first frame (including the
 * 4-byte header). `frameHeader` is the already-parsed header for the same frame.
 *
 * Returns `null` if neither a Xing/Info nor a VBRI signature is found.
 */
export function parseXingHeader(
  frameData: Uint8Array,
  frameHeader: Mp3FrameHeader,
): XingHeader | null {
  // Try Xing/Info at the version/channel-mode-derived offset.
  const xingOffset = 4 + sideInfoSize(frameHeader);
  const xing = tryParseXingInfo(frameData, xingOffset);
  if (xing !== null) return xing;

  // Try VBRI at fixed offset 32.
  const vbri = tryParseVbri(frameData, VBRI_FIXED_OFFSET);
  if (vbri !== null) return vbri;

  return null;
}

// ---------------------------------------------------------------------------
// Xing / Info parser
// ---------------------------------------------------------------------------

function tryParseXingInfo(frameData: Uint8Array, offset: number): XingHeader | null {
  if (offset + 4 > frameData.length) return null;

  const isXing = matchMagic(frameData, offset, XING_MAGIC);
  const isInfo = matchMagic(frameData, offset, INFO_MAGIC);
  if (!isXing && !isInfo) return null;

  const kind: 'Xing' | 'Info' = isXing ? 'Xing' : 'Info';

  if (offset + 8 > frameData.length) return { kind };

  const flags = readUint32BE(frameData, offset + 4);
  let cursor = offset + 8;

  let totalFrames: number | undefined;
  let totalBytes: number | undefined;
  let toc: Uint8Array | undefined;
  let qualityIndicator: number | undefined;

  if (flags & XING_FLAG_FRAMES) {
    if (cursor + 4 > frameData.length) return { kind };
    totalFrames = readUint32BE(frameData, cursor);
    cursor += 4;
  }

  if (flags & XING_FLAG_BYTES) {
    if (cursor + 4 > frameData.length) return { kind, totalFrames };
    totalBytes = readUint32BE(frameData, cursor);
    cursor += 4;
  }

  if (flags & XING_FLAG_TOC) {
    if (cursor + 100 > frameData.length) return { kind, totalFrames, totalBytes };
    toc = frameData.slice(cursor, cursor + 100);
    cursor += 100;
  }

  if (flags & XING_FLAG_QUALITY) {
    if (cursor + 4 > frameData.length) return { kind, totalFrames, totalBytes, toc };
    qualityIndicator = readUint32BE(frameData, cursor);
    cursor += 4;
  }

  // Try to detect LAME extension: starts with "Lame" or "Lavc" etc.
  let lame: LameExtension | undefined;
  if (cursor + 9 <= frameData.length && matchMagic(frameData, cursor, LAME_MAGIC)) {
    lame = parseLameExtension(frameData, cursor);
  } else if (cursor + 9 <= frameData.length) {
    // Also accept "Lavc"-style encoder strings (FFmpeg).
    const encoderStr = readAsciiUntilNull(frameData, cursor, 9);
    if (encoderStr.length > 0) {
      lame = { encoderString: encoderStr };
    }
  }

  return { kind, totalFrames, totalBytes, toc, qualityIndicator, lame };
}

// ---------------------------------------------------------------------------
// VBRI parser (Fraunhofer variant)
// ---------------------------------------------------------------------------

function tryParseVbri(frameData: Uint8Array, offset: number): XingHeader | null {
  if (offset + 4 > frameData.length) return null;
  if (!matchMagic(frameData, offset, VBRI_MAGIC)) return null;

  // VBRI header layout (after the 4-byte magic):
  //   2: version (usually 1)
  //   2: delay
  //   2: quality
  //   4: numBytes
  //   4: numFrames
  //   ... (seek table and more fields follow)
  if (offset + 18 > frameData.length) return { kind: 'VBRI' };

  const quality = readUint16BE(frameData, offset + 8);
  const totalBytes = readUint32BE(frameData, offset + 10);
  const totalFrames = readUint32BE(frameData, offset + 14);

  return {
    kind: 'VBRI',
    totalFrames,
    totalBytes,
    qualityIndicator: quality,
  };
}

// ---------------------------------------------------------------------------
// LAME extension parser
// ---------------------------------------------------------------------------

function parseLameExtension(frameData: Uint8Array, offset: number): LameExtension {
  // Read up to 9 bytes of encoder string (e.g. "Lame3.100").
  const encoderString = readAsciiUntilNull(frameData, offset, 9);
  return { encoderString };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchMagic(buf: Uint8Array, offset: number, magic: readonly number[]): boolean {
  if (offset + magic.length > buf.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[offset + i] !== magic[i]) return false;
  }
  return true;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    (((buf[offset] ?? 0) << 24) |
      ((buf[offset + 1] ?? 0) << 16) |
      ((buf[offset + 2] ?? 0) << 8) |
      (buf[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint16BE(buf: Uint8Array, offset: number): number {
  return (((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0)) & 0xffff;
}

function readAsciiUntilNull(buf: Uint8Array, offset: number, maxLen: number): string {
  let result = '';
  for (let i = 0; i < maxLen && offset + i < buf.length; i++) {
    const ch = buf[offset + i] ?? 0;
    if (ch === 0) break;
    result += String.fromCharCode(ch);
  }
  return result;
}
