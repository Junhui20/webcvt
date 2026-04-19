/**
 * Vorbis codec header decoder.
 *
 * Vorbis uses three header packets (RFC 3533 §6 + Vorbis I spec):
 *   1. Identification packet (30 bytes) — sample rate, channels, block sizes
 *   2. Comment packet — vendor string + user comments (Vorbis-comment format)
 *   3. Setup packet — codebooks, floors, residues (variable size, often 5-20 KB)
 *
 * All three must arrive BEFORE any audio packet. The parser defers declaring
 * the stream "ready" until all three have been seen.
 *
 * Reference: https://xiph.org/vorbis/doc/Vorbis_I_spec.html §5
 */

import { MAX_COMMENT_BYTES, MAX_COMMENT_COUNT } from './constants.ts';
import { OggVorbisCommentError, OggVorbisHeaderError } from './errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VORBIS_MAGIC = new Uint8Array([0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // "vorbis"
const PACKET_TYPE_IDENTIFICATION = 0x01;
const PACKET_TYPE_COMMENT = 0x03;
const PACKET_TYPE_SETUP = 0x05;

// Shared TextDecoder singleton — avoids per-call allocation (security cap #7).
const UTF8_DECODER = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VorbisIdentification {
  readonly vorbisVersion: number;
  readonly audioChannels: number;
  readonly audioSampleRate: number;
  readonly bitrateMaximum: number;
  readonly bitrateNominal: number;
  readonly bitrateMinimum: number;
  readonly blocksize0: number;
  readonly blocksize1: number;
}

export interface VorbisComment {
  readonly vendor: string;
  readonly userComments: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

// ---------------------------------------------------------------------------
// Identification header decoder
// ---------------------------------------------------------------------------

/**
 * Decode a Vorbis identification packet.
 *
 * Expected layout (30 bytes):
 *   [0]    packet_type = 0x01
 *   [1..6] "vorbis" magic
 *   [7..10] vorbis_version (LE u32, must be 0)
 *   [11]   audio_channels
 *   [12..15] audio_sample_rate (LE u32)
 *   [16..19] bitrate_maximum (LE i32)
 *   [20..23] bitrate_nominal (LE i32)
 *   [24..27] bitrate_minimum (LE i32)
 *   [28]   blocksize_0 (upper 4 bits) / blocksize_1 (lower 4 bits)
 *   [29]   framing_bit (must be 1 in bit 0)
 *
 * @throws OggVorbisHeaderError on malformed packet.
 */
export function decodeVorbisIdentification(data: Uint8Array): VorbisIdentification {
  if (data.length < 30) {
    throw new OggVorbisHeaderError(
      `Identification packet too short: ${data.length} bytes (expected ≥ 30).`,
    );
  }

  const packetType = data[0] ?? 0;
  if (packetType !== PACKET_TYPE_IDENTIFICATION) {
    throw new OggVorbisHeaderError(
      `Wrong packet type: 0x${packetType.toString(16)} (expected 0x01 for identification).`,
    );
  }

  // Check "vorbis" magic bytes [1..6]
  for (let i = 0; i < 6; i++) {
    if (data[1 + i] !== VORBIS_MAGIC[i]) {
      throw new OggVorbisHeaderError(
        `Missing "vorbis" magic at byte ${1 + i}: got 0x${(data[1 + i] ?? 0).toString(16)}.`,
      );
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const vorbisVersion = view.getUint32(7, true);
  if (vorbisVersion !== 0) {
    throw new OggVorbisHeaderError(`Unsupported vorbis_version ${vorbisVersion} (must be 0).`);
  }

  const audioChannels = data[11] ?? 0;
  if (audioChannels === 0) {
    throw new OggVorbisHeaderError('audio_channels must be ≥ 1.');
  }

  const audioSampleRate = view.getUint32(12, true);
  if (audioSampleRate === 0) {
    throw new OggVorbisHeaderError('audio_sample_rate must be > 0.');
  }

  const bitrateMaximum = view.getInt32(16, true);
  const bitrateNominal = view.getInt32(20, true);
  const bitrateMinimum = view.getInt32(24, true);

  const blocksizeByte = data[28] ?? 0;
  const blocksize0 = 1 << ((blocksizeByte >> 4) & 0x0f);
  const blocksize1 = 1 << (blocksizeByte & 0x0f);

  const framingBit = (data[29] ?? 0) & 0x01;
  if (framingBit !== 1) {
    throw new OggVorbisHeaderError('Framing bit must be 1.');
  }

  return {
    vorbisVersion,
    audioChannels,
    audioSampleRate,
    bitrateMaximum,
    bitrateNominal,
    bitrateMinimum,
    blocksize0,
    blocksize1,
  };
}

// ---------------------------------------------------------------------------
// Comment header decoder
// ---------------------------------------------------------------------------

/**
 * Decode a Vorbis-comment packet (packet_type = 0x03).
 *
 * Layout:
 *   [0]       packet_type = 0x03
 *   [1..6]    "vorbis" magic
 *   [7..10]   vendor_length (LE u32)
 *   [11..]    vendor_string (UTF-8)
 *   [...]     user_comment_list_length (LE u32)
 *   [...]     for each comment:
 *               length (LE u32) + UTF-8 string "KEY=value"
 *   [last]    framing_bit (must be 1 in bit 0)
 *
 * @throws OggVorbisHeaderError on malformed packet.
 */
export function decodeVorbisComment(data: Uint8Array): VorbisComment {
  if (data.length < 11) {
    throw new OggVorbisHeaderError(
      `Comment packet too short: ${data.length} bytes (expected ≥ 11).`,
    );
  }

  const packetType = data[0] ?? 0;
  if (packetType !== PACKET_TYPE_COMMENT) {
    throw new OggVorbisHeaderError(
      `Wrong packet type: 0x${packetType.toString(16)} (expected 0x03 for comment).`,
    );
  }

  for (let i = 0; i < 6; i++) {
    if (data[1 + i] !== VORBIS_MAGIC[i]) {
      throw new OggVorbisHeaderError(`Missing "vorbis" magic in comment packet at byte ${1 + i}.`);
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = 7;

  // Vendor string
  if (cursor + 4 > data.length) {
    throw new OggVorbisHeaderError('Truncated vendor_length in comment packet.');
  }
  const vendorLength = view.getUint32(cursor, true);
  cursor += 4;

  if (vendorLength > MAX_COMMENT_BYTES) {
    throw new OggVorbisHeaderError(
      `Vendor string too long: ${vendorLength} bytes (cap ${MAX_COMMENT_BYTES}).`,
    );
  }
  if (cursor + vendorLength > data.length) {
    throw new OggVorbisHeaderError('Truncated vendor string in comment packet.');
  }
  const vendor = UTF8_DECODER.decode(data.subarray(cursor, cursor + vendorLength));
  cursor += vendorLength;

  // User comments
  if (cursor + 4 > data.length) {
    throw new OggVorbisHeaderError('Truncated user_comment_list_length in comment packet.');
  }
  const commentCount = view.getUint32(cursor, true);
  cursor += 4;

  if (commentCount > MAX_COMMENT_COUNT) {
    throw new OggVorbisHeaderError(
      `Too many user comments: ${commentCount} (cap ${MAX_COMMENT_COUNT}).`,
    );
  }

  const userComments: Array<{ key: string; value: string }> = [];

  for (let i = 0; i < commentCount; i++) {
    if (cursor + 4 > data.length) {
      throw new OggVorbisHeaderError(`Truncated comment length at index ${i}.`);
    }
    const commentLength = view.getUint32(cursor, true);
    cursor += 4;

    if (commentLength > MAX_COMMENT_BYTES) {
      throw new OggVorbisHeaderError(
        `Comment ${i} too long: ${commentLength} bytes (cap ${MAX_COMMENT_BYTES}).`,
      );
    }
    if (cursor + commentLength > data.length) {
      throw new OggVorbisHeaderError(`Truncated comment body at index ${i}.`);
    }

    const raw = UTF8_DECODER.decode(data.subarray(cursor, cursor + commentLength));
    cursor += commentLength;

    const eqIdx = raw.indexOf('=');
    if (eqIdx < 0) {
      userComments.push({ key: raw.toUpperCase(), value: '' });
    } else {
      userComments.push({
        key: raw.slice(0, eqIdx).toUpperCase(),
        value: raw.slice(eqIdx + 1),
      });
    }
  }

  // Q-5: Vorbis spec §5.2.1 requires framing_bit = 1 at the end of the comment packet.
  const framingByte = data[cursor] ?? 0;
  if ((framingByte & 0x01) === 0) {
    throw new OggVorbisCommentError(
      `Framing bit missing (byte at offset ${cursor} is 0x${framingByte.toString(16).padStart(2, '0')}; bit 0 must be 1).`,
    );
  }

  return { vendor, userComments };
}

// ---------------------------------------------------------------------------
// Setup header identification helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `data` is a Vorbis setup packet (packet_type = 0x05).
 * Does not fully decode the setup — it is preserved verbatim for round-trip.
 */
export function isVorbisSetupPacket(data: Uint8Array): boolean {
  if (data.length < 7) return false;
  if ((data[0] ?? 0) !== PACKET_TYPE_SETUP) return false;
  for (let i = 0; i < 6; i++) {
    if (data[1 + i] !== VORBIS_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Returns true if `data` begins with a Vorbis header packet_type byte
 * and "vorbis" magic (i.e., it is any Vorbis header packet).
 */
export function isVorbisHeaderPacket(data: Uint8Array): boolean {
  if (data.length < 7) return false;
  const t = data[0] ?? 0;
  if (t !== PACKET_TYPE_IDENTIFICATION && t !== PACKET_TYPE_COMMENT && t !== PACKET_TYPE_SETUP) {
    return false;
  }
  for (let i = 0; i < 6; i++) {
    if (data[1 + i] !== VORBIS_MAGIC[i]) return false;
  }
  return true;
}
