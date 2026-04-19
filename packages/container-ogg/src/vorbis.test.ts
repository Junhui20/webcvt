/**
 * Vorbis header decode tests.
 */

import { describe, expect, it } from 'vitest';
import { MAX_COMMENT_BYTES, MAX_COMMENT_COUNT } from './constants.ts';
import { OggVorbisCommentError, OggVorbisHeaderError } from './errors.ts';
import {
  decodeVorbisComment,
  decodeVorbisIdentification,
  isVorbisHeaderPacket,
  isVorbisSetupPacket,
} from './vorbis.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Vorbis identification packet (30 bytes). */
function buildVorbisIdent(opts: {
  packetType?: number;
  vorbisVersion?: number;
  channels?: number;
  sampleRate?: number;
  blocksize?: number; // byte at offset 28
  framingBit?: number;
}): Uint8Array {
  const {
    packetType = 0x01,
    vorbisVersion = 0,
    channels = 2,
    sampleRate = 44100,
    blocksize = 0xb8, // default blocksize_0=11 (2048), blocksize_1=8 (256) — valid combo
    framingBit = 1,
  } = opts;

  const buf = new Uint8Array(30);
  const view = new DataView(buf.buffer);
  buf[0] = packetType;
  buf[1] = 0x76;
  buf[2] = 0x6f;
  buf[3] = 0x72;
  buf[4] = 0x62;
  buf[5] = 0x69;
  buf[6] = 0x73; // "vorbis"
  view.setUint32(7, vorbisVersion, true);
  buf[11] = channels;
  view.setUint32(12, sampleRate, true);
  view.setInt32(16, 0, true); // bitrate_maximum
  view.setInt32(20, 128000, true); // bitrate_nominal
  view.setInt32(24, 0, true); // bitrate_minimum
  buf[28] = blocksize;
  buf[29] = framingBit;
  return buf;
}

/** Build a minimal valid Vorbis comment packet. */
function buildVorbisComment(vendor: string, comments: string[]): Uint8Array {
  const enc = new TextEncoder();
  const vendorBytes = enc.encode(vendor);
  const commentByteArrays = comments.map((c) => enc.encode(c));
  const totalSize =
    1 +
    6 +
    4 +
    vendorBytes.length +
    4 +
    commentByteArrays.reduce((s, c) => s + 4 + c.length, 0) +
    1; // framing bit byte

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let pos = 0;

  buf[pos++] = 0x03; // packet_type
  buf[pos++] = 0x76;
  buf[pos++] = 0x6f;
  buf[pos++] = 0x72;
  buf[pos++] = 0x62;
  buf[pos++] = 0x69;
  buf[pos++] = 0x73;

  view.setUint32(pos, vendorBytes.length, true);
  pos += 4;
  buf.set(vendorBytes, pos);
  pos += vendorBytes.length;

  view.setUint32(pos, commentByteArrays.length, true);
  pos += 4;
  for (const cb of commentByteArrays) {
    view.setUint32(pos, cb.length, true);
    pos += 4;
    buf.set(cb, pos);
    pos += cb.length;
  }
  buf[pos] = 0x01; // framing bit

  return buf;
}

// ---------------------------------------------------------------------------
// decodeVorbisIdentification
// ---------------------------------------------------------------------------

describe('decodeVorbisIdentification', () => {
  it('decodes a valid identification packet', () => {
    const data = buildVorbisIdent({ channels: 1, sampleRate: 44100 });
    const ident = decodeVorbisIdentification(data);
    expect(ident.audioChannels).toBe(1);
    expect(ident.audioSampleRate).toBe(44100);
    expect(ident.vorbisVersion).toBe(0);
    expect(ident.bitrateNominal).toBe(128000);
  });

  it('throws OggVorbisHeaderError for wrong packet type', () => {
    const data = buildVorbisIdent({ packetType: 0x03 });
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for non-zero vorbis_version', () => {
    const data = buildVorbisIdent({ vorbisVersion: 1 });
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for zero channels', () => {
    const data = buildVorbisIdent({ channels: 0 });
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for zero sample rate', () => {
    const data = buildVorbisIdent({ sampleRate: 0 });
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for zero framing bit', () => {
    const data = buildVorbisIdent({ framingBit: 0 });
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for truncated packet', () => {
    expect(() => decodeVorbisIdentification(new Uint8Array(10))).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for wrong magic bytes', () => {
    const data = buildVorbisIdent({});
    data[2] = 0x00; // corrupt "vorbis" magic
    expect(() => decodeVorbisIdentification(data)).toThrow(OggVorbisHeaderError);
  });
});

// ---------------------------------------------------------------------------
// decodeVorbisComment
// ---------------------------------------------------------------------------

describe('decodeVorbisComment', () => {
  it('decodes vendor and user comments', () => {
    const data = buildVorbisComment('Xiph.Org libVorbis I', ['TITLE=Test Track', 'ARTIST=Sine']);
    const comment = decodeVorbisComment(data);
    expect(comment.vendor).toBe('Xiph.Org libVorbis I');
    expect(comment.userComments.length).toBe(2);
    expect(comment.userComments[0]).toEqual({ key: 'TITLE', value: 'Test Track' });
    expect(comment.userComments[1]).toEqual({ key: 'ARTIST', value: 'Sine' });
  });

  it('decodes empty comment list', () => {
    const data = buildVorbisComment('encoder', []);
    const comment = decodeVorbisComment(data);
    expect(comment.vendor).toBe('encoder');
    expect(comment.userComments.length).toBe(0);
  });

  it('throws OggVorbisHeaderError for wrong packet type', () => {
    const data = buildVorbisComment('vendor', []);
    data[0] = 0x01; // wrong type
    expect(() => decodeVorbisComment(data)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for truncated input', () => {
    expect(() => decodeVorbisComment(new Uint8Array(5))).toThrow(OggVorbisHeaderError);
  });
});

// ---------------------------------------------------------------------------
// isVorbisHeaderPacket / isVorbisSetupPacket
// ---------------------------------------------------------------------------

describe('isVorbisHeaderPacket', () => {
  it('returns true for identification packet', () => {
    expect(isVorbisHeaderPacket(buildVorbisIdent({}))).toBe(true);
  });

  it('returns true for comment packet', () => {
    expect(isVorbisHeaderPacket(buildVorbisComment('v', []))).toBe(true);
  });

  it('returns false for audio-looking data', () => {
    expect(isVorbisHeaderPacket(new Uint8Array([0x00, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]))).toBe(
      false,
    );
  });

  it('returns false for short data', () => {
    expect(isVorbisHeaderPacket(new Uint8Array([0x01]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Q-5: Vorbis framing bit enforcement
// ---------------------------------------------------------------------------

describe('decodeVorbisComment (framing bit Q-5)', () => {
  it('throws OggVorbisCommentError when framing bit is 0', () => {
    // Build an otherwise valid comment packet but with framing_bit = 0x00.
    const enc = new TextEncoder();
    const vendor = enc.encode('test');
    const buf = new Uint8Array(1 + 6 + 4 + vendor.length + 4 + 1);
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x03;
    buf[pos++] = 0x76;
    buf[pos++] = 0x6f;
    buf[pos++] = 0x72;
    buf[pos++] = 0x62;
    buf[pos++] = 0x69;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendor.length, true);
    pos += 4;
    buf.set(vendor, pos);
    pos += vendor.length;
    view.setUint32(pos, 0, true); // 0 comments
    pos += 4;
    buf[pos] = 0x00; // framing bit = 0 — INVALID per Vorbis spec §5.2.1
    expect(() => decodeVorbisComment(buf)).toThrow(OggVorbisCommentError);
  });

  it('accepts framing bit = 1 (valid)', () => {
    const data = buildVorbisComment('encoder', []);
    // buildVorbisComment already sets framing bit to 0x01 — should not throw.
    expect(() => decodeVorbisComment(data)).not.toThrow();
  });
});

describe('isVorbisSetupPacket', () => {
  it('returns true for a setup packet', () => {
    const data = new Uint8Array(10);
    data[0] = 0x05; // setup type
    data[1] = 0x76;
    data[2] = 0x6f;
    data[3] = 0x72;
    data[4] = 0x62;
    data[5] = 0x69;
    data[6] = 0x73;
    expect(isVorbisSetupPacket(data)).toBe(true);
  });

  it('returns false for identification packet', () => {
    expect(isVorbisSetupPacket(buildVorbisIdent({}))).toBe(false);
  });

  it('returns false for short data', () => {
    expect(isVorbisSetupPacket(new Uint8Array(3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage for comment truncation paths
// ---------------------------------------------------------------------------

describe('decodeVorbisComment (branch coverage)', () => {
  it('throws OggVorbisHeaderError for too many comments (cap exceeded)', () => {
    // Build a comment packet with commentCount > MAX_COMMENT_COUNT.
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('test');
    const buf = new Uint8Array(1 + 6 + 4 + vendorBytes.length + 4 + 1);
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x03;
    buf[pos++] = 0x76;
    buf[pos++] = 0x6f;
    buf[pos++] = 0x72;
    buf[pos++] = 0x62;
    buf[pos++] = 0x69;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, MAX_COMMENT_COUNT + 1, true); // exceed cap
    buf[buf.length - 1] = 0x01;
    expect(() => decodeVorbisComment(buf)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for comment body truncated', () => {
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('test');
    // Build valid header + 1 comment with length > remaining data.
    const buf = new Uint8Array(1 + 6 + 4 + vendorBytes.length + 4 + 4 + 3); // intentionally short
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x03;
    buf[pos++] = 0x76;
    buf[pos++] = 0x6f;
    buf[pos++] = 0x72;
    buf[pos++] = 0x62;
    buf[pos++] = 0x69;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, 1, true);
    pos += 4; // 1 comment
    view.setUint32(pos, 9999, true); // comment length claims 9999 bytes but data is short
    expect(() => decodeVorbisComment(buf)).toThrow(OggVorbisHeaderError);
  });

  it('handles comment without = separator', () => {
    const data = buildVorbisComment('test', ['COMMENTWITHOUTEQ']);
    const comment = decodeVorbisComment(data);
    expect(comment.userComments[0]).toEqual({ key: 'COMMENTWITHOUTEQ', value: '' });
  });

  it('throws OggVorbisHeaderError for vendor string too long', () => {
    // Craft a packet where vendor_length > MAX_COMMENT_BYTES.
    const buf = new Uint8Array(1 + 6 + 4 + 1); // just enough for the vendor_length field
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x03;
    buf[pos++] = 0x76;
    buf[pos++] = 0x6f;
    buf[pos++] = 0x72;
    buf[pos++] = 0x62;
    buf[pos++] = 0x69;
    buf[pos++] = 0x73;
    view.setUint32(pos, MAX_COMMENT_BYTES + 1, true); // vendor length exceeds cap
    expect(() => decodeVorbisComment(buf)).toThrow(OggVorbisHeaderError);
  });

  it('throws OggVorbisHeaderError for individual comment too long', () => {
    // Build a valid comment packet with 1 comment whose length > MAX_COMMENT_BYTES.
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('test');
    // Packet: header(7) + vendor_len(4) + vendor + comment_count(4) + comment_len(4) + framing(1)
    const buf = new Uint8Array(1 + 6 + 4 + vendorBytes.length + 4 + 4 + 1);
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x03;
    buf[pos++] = 0x76;
    buf[pos++] = 0x6f;
    buf[pos++] = 0x72;
    buf[pos++] = 0x62;
    buf[pos++] = 0x69;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, 1, true); // 1 comment
    pos += 4;
    view.setUint32(pos, MAX_COMMENT_BYTES + 1, true); // comment length exceeds cap
    expect(() => decodeVorbisComment(buf)).toThrow(OggVorbisHeaderError);
  });
});
