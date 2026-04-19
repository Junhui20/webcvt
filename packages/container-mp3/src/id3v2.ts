/**
 * ID3v2 tag parse and serialize.
 *
 * Supported: ID3v2.3 and ID3v2.4 (major versions 3 and 4).
 * Handles: unsynchronisation flag, footer flag, extended header (skipped).
 *
 * Ref: https://id3.org/id3v2.4.0-structure
 * Ref: https://id3.org/id3v2.3.0
 */

import { Mp3UnsynchronisationError } from './errors.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Id3v2Frame {
  id: string;
  /** 2-byte frame-level flags field (raw). */
  flags: number;
  data: Uint8Array;
}

export interface Id3v2Tag {
  version: [major: number, revision: number];
  flags: number;
  frames: Id3v2Frame[];
  /** true if the tag body had unsynchronisation applied on input */
  unsynced: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ID3_MAGIC = [0x49, 0x44, 0x33]; // "ID3"
const ID3_HEADER_SIZE = 10;
const ID3_FOOTER_SIZE = 10;

/** Reject tags that claim a body larger than this — pathological for music metadata. */
const MAX_ID3_BODY = 64 * 1024 * 1024; // 64 MiB

/** Flag bit positions in the ID3v2 header flags byte. */
const FLAG_UNSYNC = 0x80;
const FLAG_EXTENDED = 0x40;
const FLAG_FOOTER = 0x10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an ID3v2 tag starting at offset 0 of `bytes`.
 *
 * Returns `null` if the file does not start with the "ID3" magic.
 *
 * The returned `tagSize` is the total number of bytes consumed at the start of
 * the file (including the 10-byte header and optional footer).
 */
export function parseId3v2(bytes: Uint8Array): { tag: Id3v2Tag; tagSize: number } | null {
  if (
    bytes.length < ID3_HEADER_SIZE ||
    bytes[0] !== ID3_MAGIC[0] ||
    bytes[1] !== ID3_MAGIC[1] ||
    bytes[2] !== ID3_MAGIC[2]
  ) {
    return null;
  }

  const major = bytes[3] ?? 0;
  const revision = bytes[4] ?? 0;
  const flags = bytes[5] ?? 0;

  const synchsafeSize = decodeSynchsafe(bytes, 6);
  const hasFooter = (flags & FLAG_FOOTER) !== 0;
  const hasUnsync = (flags & FLAG_UNSYNC) !== 0;
  const hasExtended = (flags & FLAG_EXTENDED) !== 0;

  // Total tag size on disk = 10-byte header + synchsafe body size + optional footer.
  const bodySize = synchsafeSize;
  const tagSize = ID3_HEADER_SIZE + bodySize + (hasFooter ? ID3_FOOTER_SIZE : 0);

  // Reject pathologically large body declarations before any allocation.
  if (bodySize > MAX_ID3_BODY) {
    return null;
  }

  if (ID3_HEADER_SIZE + bodySize > bytes.length) {
    // Truncated tag — return what we have.
    return null;
  }

  // Slice the tag body (the bytes after the 10-byte header, before the footer).
  let body = bytes.subarray(ID3_HEADER_SIZE, ID3_HEADER_SIZE + bodySize);

  // Apply unsynchronisation: remove every 0x00 that follows a 0xFF.
  if (hasUnsync) {
    body = decodeUnsynchronisation(body);
  }

  // Skip extended header if present (we don't parse it).
  let cursor = 0;
  if (hasExtended && body.length >= 4) {
    const extSize = major === 4 ? decodeSynchsafe(body, 0) : readUint32BE(body, 0);
    cursor += extSize;
    // Guard: a crafted extSize larger than the body would silently skip all frames.
    if (cursor > body.length) {
      return null;
    }
  }

  // Parse ID3v2 frames.
  const frames: Id3v2Frame[] = [];
  while (cursor + 10 <= body.length) {
    const frameId = readAscii(body, cursor, 4);

    // A zero byte in the frame id signals padding — stop.
    if (frameId.charCodeAt(0) === 0) break;

    // Read frame size: v2.4 uses synchsafe; v2.3 uses plain uint32.
    const frameSize =
      major === 4 ? decodeSynchsafe(body, cursor + 4) : readUint32BE(body, cursor + 4);
    const frameFlags = readUint16BE(body, cursor + 8);

    const dataStart = cursor + 10;
    const dataEnd = dataStart + frameSize;

    if (dataEnd > body.length) break;

    frames.push({
      id: frameId,
      flags: frameFlags,
      data: body.subarray(dataStart, dataEnd),
    });

    cursor = dataEnd;
  }

  return {
    tag: {
      version: [major, revision],
      flags,
      frames,
      unsynced: hasUnsync,
    },
    tagSize,
  };
}

/**
 * Serialize an ID3v2 tag.
 *
 * Phase 1 policy: always writes ID3v2.4, never applies unsynchronisation,
 * always uses synchsafe sizes. This is tolerated by all modern decoders.
 */
export function serializeId3v2(tag: Id3v2Tag): Uint8Array {
  // Serialize all frames.
  const frameParts: Uint8Array[] = [];
  for (const frame of tag.frames) {
    const frameBytes = serializeId3v2Frame(frame);
    frameParts.push(frameBytes);
  }

  const bodySize = frameParts.reduce((sum, p) => sum + p.length, 0);

  // Build output: 10-byte header + body.
  const out = new Uint8Array(ID3_HEADER_SIZE + bodySize);

  // Write "ID3" magic.
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x33;

  // Version: use original version from tag (preserve v2.3 or v2.4).
  out[3] = tag.version[0];
  out[4] = tag.version[1];

  // Flags: clear unsync and footer bits on output (Phase 1: no unsync on write).
  out[5] = tag.flags & ~(FLAG_UNSYNC | FLAG_FOOTER);

  // Synchsafe size (body only, not header, not footer).
  encodeSynchsafe(out, 6, bodySize);

  // Write frame data.
  let offset = ID3_HEADER_SIZE;
  for (const part of frameParts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Frame serialize helper
// ---------------------------------------------------------------------------

function serializeId3v2Frame(frame: Id3v2Frame): Uint8Array {
  // 4-byte id + 4-byte size (synchsafe) + 2-byte flags + data.
  const out = new Uint8Array(10 + frame.data.length);

  writeAscii(out, 0, frame.id, 4);
  encodeSynchsafe(out, 4, frame.data.length);
  out[8] = (frame.flags >>> 8) & 0xff;
  out[9] = frame.flags & 0xff;
  out.set(frame.data, 10);

  return out;
}

// ---------------------------------------------------------------------------
// Unsynchronisation (§6.1 of ID3v2.4 spec)
// ---------------------------------------------------------------------------

/**
 * Remove unsynchronisation bytes: collapse every `0xFF 0x00` pair to `0xFF`.
 *
 * This must be applied to the raw tag body bytes *before* parsing frames.
 */
function decodeUnsynchronisation(body: Uint8Array): Uint8Array {
  // Count pairs first to know the output size.
  let pairCount = 0;
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === 0xff && body[i + 1] === 0x00) {
      pairCount++;
      i++; // skip the 0x00; it will be consumed
    }
  }

  if (pairCount === 0) return body;

  const out = new Uint8Array(body.length - pairCount);
  let outIdx = 0;

  for (let i = 0; i < body.length; i++) {
    const byte = body[i] ?? 0;
    out[outIdx++] = byte;
    if (byte === 0xff && i + 1 < body.length && body[i + 1] === 0x00) {
      i++; // consume and discard the 0x00
    }
  }

  if (outIdx !== out.length) {
    throw new Mp3UnsynchronisationError(
      `expected ${out.length} output bytes but produced ${outIdx}`,
    );
  }

  return out;
}

/**
 * Apply unsynchronisation to arbitrary bytes: insert a 0x00 after every 0xFF.
 * Also insert 0x00 after 0xFF at the very end of the buffer (to prevent
 * false syncs with the next byte in the stream).
 */
export function encodeUnsynchronisation(data: Uint8Array): Uint8Array {
  let extraBytes = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0xff) extraBytes++;
  }

  if (extraBytes === 0) return data;

  const out = new Uint8Array(data.length + extraBytes);
  let outIdx = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    out[outIdx++] = byte;
    if (byte === 0xff) {
      out[outIdx++] = 0x00;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Synchsafe integer helpers
// ---------------------------------------------------------------------------

/**
 * Decode a 4-byte synchsafe integer from `buf` at `offset`.
 * Each byte contributes only its low 7 bits.
 * Result: (b0 << 21) | (b1 << 14) | (b2 << 7) | b3.
 */
function decodeSynchsafe(buf: Uint8Array, offset: number): number {
  const b0 = (buf[offset] ?? 0) & 0x7f;
  const b1 = (buf[offset + 1] ?? 0) & 0x7f;
  const b2 = (buf[offset + 2] ?? 0) & 0x7f;
  const b3 = (buf[offset + 3] ?? 0) & 0x7f;
  return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
}

/**
 * Write a value as a 4-byte synchsafe integer to `buf` at `offset`.
 * Value must be < 2^28.
 */
function encodeSynchsafe(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 21) & 0x7f;
  buf[offset + 1] = (value >>> 14) & 0x7f;
  buf[offset + 2] = (value >>> 7) & 0x7f;
  buf[offset + 3] = value & 0x7f;
}

// ---------------------------------------------------------------------------
// Low-level read helpers
// ---------------------------------------------------------------------------

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

function readAscii(buf: Uint8Array, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(buf[offset + i] ?? 0);
  }
  return result;
}

function writeAscii(buf: Uint8Array, offset: number, str: string, length: number): void {
  for (let i = 0; i < length; i++) {
    buf[offset + i] = i < str.length ? str.charCodeAt(i) & 0xff : 0;
  }
}
