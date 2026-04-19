/**
 * Opus codec header decoder.
 *
 * Opus in Ogg (RFC 7845) uses two header packets:
 *   1. OpusHead — identification header
 *   2. OpusTags — comment header (Vorbis-comment-like with "OpusTags" magic)
 *
 * Reference: RFC 7845 §5
 */

import { MAX_COMMENT_BYTES, MAX_COMMENT_COUNT } from './constants.ts';
import { OggOpusHeaderError } from './errors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPUS_HEAD_MAGIC = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
const OPUS_TAGS_MAGIC = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // "OpusTags"

/** Minimum OpusHead size (channel_mapping_family 0, no mapping table). */
const OPUS_HEAD_MIN_SIZE = 19;

// Shared TextDecoder singleton — avoids per-call allocation (security cap #7).
const UTF8_DECODER = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpusHead {
  /** Must be 1 per RFC 7845. */
  readonly version: number;
  readonly channelCount: number;
  /** Pre-skip in 48 kHz samples; decoder discards these from the start. */
  readonly preSkip: number;
  /**
   * Input sample rate (informational — playback is always 48 kHz).
   * This is the original sample rate of the content before encoding.
   */
  readonly inputSampleRate: number;
  /** Output gain in Q7.8 dB (signed). Decoder applies this gain. */
  readonly outputGain: number;
  /** Channel mapping family (0 = mono/stereo, 1 = surround, 255 = undefined). */
  readonly channelMappingFamily: number;
}

export interface OpusTags {
  readonly vendor: string;
  readonly userComments: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

// ---------------------------------------------------------------------------
// OpusHead decoder
// ---------------------------------------------------------------------------

/**
 * Decode an OpusHead identification packet (RFC 7845 §5.1).
 *
 * Expected layout:
 *   [0..7]   "OpusHead" magic (8 bytes)
 *   [8]      version (must be 1)
 *   [9]      channel_count
 *   [10..11] pre_skip (LE u16)
 *   [12..15] input_sample_rate (LE u32)
 *   [16..17] output_gain (LE i16, Q7.8 dB)
 *   [18]     channel_mapping_family
 *   [19+]    optional channel mapping table (family != 0)
 *
 * @throws OggOpusHeaderError on malformed packet.
 */
export function decodeOpusHead(data: Uint8Array): OpusHead {
  if (data.length < OPUS_HEAD_MIN_SIZE) {
    throw new OggOpusHeaderError(
      `OpusHead packet too short: ${data.length} bytes (expected ≥ ${OPUS_HEAD_MIN_SIZE}).`,
    );
  }

  // Check "OpusHead" magic
  for (let i = 0; i < 8; i++) {
    if (data[i] !== OPUS_HEAD_MAGIC[i]) {
      throw new OggOpusHeaderError(
        `Missing "OpusHead" magic at byte ${i}: got 0x${(data[i] ?? 0).toString(16).padStart(2, '0')}.`,
      );
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const version = data[8] ?? 0;
  // RFC 7845 §5.1: version field's upper 4 bits define major version;
  // values with major=1 are compatible. We accept version 1 (0x01).
  // Per the spec, values 2..255 with major=1 should still be parseable.
  if ((version & 0xf0) !== 0x00 || version === 0) {
    throw new OggOpusHeaderError(
      `Unsupported OpusHead version: ${version}. Only version 1 is supported.`,
    );
  }

  const channelCount = data[9] ?? 0;
  if (channelCount === 0) {
    throw new OggOpusHeaderError('channel_count must be ≥ 1.');
  }

  const preSkip = view.getUint16(10, true);
  const inputSampleRate = view.getUint32(12, true);
  const outputGain = view.getInt16(16, true);
  const channelMappingFamily = data[18] ?? 0;

  // H-2: mapping table for family != 0 has variable-length content we don't parse.
  // Reject until Phase 3+ surround audio support is implemented.
  if (channelMappingFamily !== 0) {
    throw new OggOpusHeaderError(
      `channel_mapping_family ${channelMappingFamily} is not supported (Phase 1: mono/stereo only, family 0).`,
    );
  }

  return {
    version,
    channelCount,
    preSkip,
    inputSampleRate,
    outputGain,
    channelMappingFamily,
  };
}

// ---------------------------------------------------------------------------
// OpusTags decoder
// ---------------------------------------------------------------------------

/**
 * Decode an OpusTags comment packet (RFC 7845 §5.2).
 *
 * Layout mirrors Vorbis-comment but with "OpusTags" prefix instead of
 * the Vorbis packet_type + "vorbis" magic:
 *   [0..7]    "OpusTags" magic (8 bytes)
 *   [8..11]   vendor_length (LE u32)
 *   [12..]    vendor_string (UTF-8)
 *   [...]     user_comment_list_length (LE u32)
 *   [...]     for each: length (LE u32) + UTF-8 "KEY=value"
 *
 * @throws OggOpusHeaderError on malformed packet.
 */
export function decodeOpusTags(data: Uint8Array): OpusTags {
  if (data.length < 16) {
    throw new OggOpusHeaderError(
      `OpusTags packet too short: ${data.length} bytes (expected ≥ 16).`,
    );
  }

  // Check "OpusTags" magic
  for (let i = 0; i < 8; i++) {
    if (data[i] !== OPUS_TAGS_MAGIC[i]) {
      throw new OggOpusHeaderError(
        `Missing "OpusTags" magic at byte ${i}: got 0x${(data[i] ?? 0).toString(16).padStart(2, '0')}.`,
      );
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = 8;

  // Vendor string
  if (cursor + 4 > data.length) {
    throw new OggOpusHeaderError('Truncated vendor_length in OpusTags packet.');
  }
  const vendorLength = view.getUint32(cursor, true);
  cursor += 4;

  if (vendorLength > MAX_COMMENT_BYTES) {
    throw new OggOpusHeaderError(
      `Vendor string too long: ${vendorLength} bytes (cap ${MAX_COMMENT_BYTES}).`,
    );
  }
  if (cursor + vendorLength > data.length) {
    throw new OggOpusHeaderError('Truncated vendor string in OpusTags packet.');
  }
  const vendor = UTF8_DECODER.decode(data.subarray(cursor, cursor + vendorLength));
  cursor += vendorLength;

  // User comments
  if (cursor + 4 > data.length) {
    throw new OggOpusHeaderError('Truncated user_comment_list_length in OpusTags packet.');
  }
  const commentCount = view.getUint32(cursor, true);
  cursor += 4;

  if (commentCount > MAX_COMMENT_COUNT) {
    throw new OggOpusHeaderError(
      `Too many user comments: ${commentCount} (cap ${MAX_COMMENT_COUNT}).`,
    );
  }

  const userComments: Array<{ key: string; value: string }> = [];

  for (let i = 0; i < commentCount; i++) {
    if (cursor + 4 > data.length) {
      throw new OggOpusHeaderError(`Truncated comment length at index ${i}.`);
    }
    const commentLength = view.getUint32(cursor, true);
    cursor += 4;

    if (commentLength > MAX_COMMENT_BYTES) {
      throw new OggOpusHeaderError(
        `Comment ${i} too long: ${commentLength} bytes (cap ${MAX_COMMENT_BYTES}).`,
      );
    }
    if (cursor + commentLength > data.length) {
      throw new OggOpusHeaderError(`Truncated comment body at index ${i}.`);
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

  return { vendor, userComments };
}

// ---------------------------------------------------------------------------
// Identification helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `data` begins with the "OpusHead" magic.
 */
export function isOpusHeadPacket(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== OPUS_HEAD_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Returns true if `data` begins with the "OpusTags" magic.
 */
export function isOpusTagsPacket(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== OPUS_TAGS_MAGIC[i]) return false;
  }
  return true;
}
