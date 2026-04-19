/**
 * Opus header decode tests.
 */

import { describe, expect, it } from 'vitest';
import { MAX_COMMENT_BYTES, MAX_COMMENT_COUNT } from './constants.ts';
import { OggOpusHeaderError } from './errors.ts';
import { decodeOpusHead, decodeOpusTags, isOpusHeadPacket, isOpusTagsPacket } from './opus.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid OpusHead packet (19 bytes, family 0). */
function buildOpusHead(opts: {
  version?: number;
  channels?: number;
  preSkip?: number;
  inputSampleRate?: number;
  outputGain?: number;
  channelMappingFamily?: number;
}): Uint8Array {
  const {
    version = 1,
    channels = 1,
    preSkip = 312,
    inputSampleRate = 48000,
    outputGain = 0,
    channelMappingFamily = 0,
  } = opts;

  const buf = new Uint8Array(19);
  const view = new DataView(buf.buffer);
  // "OpusHead" magic
  buf[0] = 0x4f;
  buf[1] = 0x70;
  buf[2] = 0x75;
  buf[3] = 0x73;
  buf[4] = 0x48;
  buf[5] = 0x65;
  buf[6] = 0x61;
  buf[7] = 0x64;
  buf[8] = version;
  buf[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, outputGain, true);
  buf[18] = channelMappingFamily;
  return buf;
}

/** Build a minimal valid OpusTags packet. */
function buildOpusTags(vendor: string, comments: string[]): Uint8Array {
  const enc = new TextEncoder();
  const vendorBytes = enc.encode(vendor);
  const commentByteArrays = comments.map((c) => enc.encode(c));
  const totalSize =
    8 + 4 + vendorBytes.length + 4 + commentByteArrays.reduce((s, c) => s + 4 + c.length, 0);

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let pos = 0;

  // "OpusTags" magic
  buf[pos++] = 0x4f;
  buf[pos++] = 0x70;
  buf[pos++] = 0x75;
  buf[pos++] = 0x73;
  buf[pos++] = 0x54;
  buf[pos++] = 0x61;
  buf[pos++] = 0x67;
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

  return buf;
}

// ---------------------------------------------------------------------------
// decodeOpusHead
// ---------------------------------------------------------------------------

describe('decodeOpusHead', () => {
  it('decodes a valid OpusHead packet', () => {
    const data = buildOpusHead({
      channels: 2,
      preSkip: 312,
      inputSampleRate: 48000,
      outputGain: 0,
    });
    const head = decodeOpusHead(data);
    expect(head.version).toBe(1);
    expect(head.channelCount).toBe(2);
    expect(head.preSkip).toBe(312);
    expect(head.inputSampleRate).toBe(48000);
    expect(head.outputGain).toBe(0);
    expect(head.channelMappingFamily).toBe(0);
  });

  it('decodes pre_skip correctly (design note trap §9)', () => {
    const data = buildOpusHead({ preSkip: 3840 });
    const head = decodeOpusHead(data);
    expect(head.preSkip).toBe(3840); // OPUS_DEFAULT_PRE_SKIP = 3840
  });

  it('decodes negative output_gain (Q7.8 signed)', () => {
    const data = buildOpusHead({ outputGain: -256 }); // -1.0 dB in Q7.8
    const head = decodeOpusHead(data);
    expect(head.outputGain).toBe(-256);
  });

  it('throws OggOpusHeaderError for wrong magic', () => {
    const data = buildOpusHead({});
    data[0] = 0x00; // corrupt magic
    expect(() => decodeOpusHead(data)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for version 0', () => {
    const data = buildOpusHead({ version: 0 });
    expect(() => decodeOpusHead(data)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for zero channels', () => {
    const data = buildOpusHead({ channels: 0 });
    expect(() => decodeOpusHead(data)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for truncated packet', () => {
    expect(() => decodeOpusHead(new Uint8Array(10))).toThrow(OggOpusHeaderError);
  });
});

// ---------------------------------------------------------------------------
// decodeOpusTags
// ---------------------------------------------------------------------------

describe('decodeOpusTags', () => {
  it('decodes vendor and user comments', () => {
    const data = buildOpusTags('libopus 1.3.1', ['TITLE=Test', 'ALBUM=Sine']);
    const tags = decodeOpusTags(data);
    expect(tags.vendor).toBe('libopus 1.3.1');
    expect(tags.userComments.length).toBe(2);
    expect(tags.userComments[0]).toEqual({ key: 'TITLE', value: 'Test' });
    expect(tags.userComments[1]).toEqual({ key: 'ALBUM', value: 'Sine' });
  });

  it('decodes empty comment list', () => {
    const data = buildOpusTags('encoder', []);
    const tags = decodeOpusTags(data);
    expect(tags.vendor).toBe('encoder');
    expect(tags.userComments.length).toBe(0);
  });

  it('throws OggOpusHeaderError for wrong magic', () => {
    const data = buildOpusTags('v', []);
    data[4] = 0x00; // corrupt "OpusTags" magic
    expect(() => decodeOpusTags(data)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for truncated packet', () => {
    expect(() => decodeOpusTags(new Uint8Array(5))).toThrow(OggOpusHeaderError);
  });
});

// ---------------------------------------------------------------------------
// isOpusHeadPacket / isOpusTagsPacket
// ---------------------------------------------------------------------------

describe('isOpusHeadPacket', () => {
  it('returns true for OpusHead data', () => {
    expect(isOpusHeadPacket(buildOpusHead({}))).toBe(true);
  });

  it('returns false for OpusTags data', () => {
    expect(isOpusHeadPacket(buildOpusTags('v', []))).toBe(false);
  });

  it('returns false for short data', () => {
    expect(isOpusHeadPacket(new Uint8Array([0x4f, 0x70]))).toBe(false);
  });
});

describe('isOpusTagsPacket', () => {
  it('returns true for OpusTags data', () => {
    expect(isOpusTagsPacket(buildOpusTags('v', []))).toBe(true);
  });

  it('returns false for OpusHead data', () => {
    expect(isOpusTagsPacket(buildOpusHead({}))).toBe(false);
  });

  it('returns false for short data', () => {
    expect(isOpusTagsPacket(new Uint8Array(3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage
// ---------------------------------------------------------------------------

describe('decodeOpusTags (branch coverage)', () => {
  it('throws OggOpusHeaderError for too many comments', () => {
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('libopus');
    const buf = new Uint8Array(8 + 4 + vendorBytes.length + 4 + 1);
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x4f;
    buf[pos++] = 0x70;
    buf[pos++] = 0x75;
    buf[pos++] = 0x73;
    buf[pos++] = 0x54;
    buf[pos++] = 0x61;
    buf[pos++] = 0x67;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, MAX_COMMENT_COUNT + 1, true); // exceed cap
    expect(() => decodeOpusTags(buf)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for truncated comment body', () => {
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('test');
    const buf = new Uint8Array(8 + 4 + vendorBytes.length + 4 + 4 + 2); // short
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x4f;
    buf[pos++] = 0x70;
    buf[pos++] = 0x75;
    buf[pos++] = 0x73;
    buf[pos++] = 0x54;
    buf[pos++] = 0x61;
    buf[pos++] = 0x67;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, 1, true);
    pos += 4; // 1 comment
    view.setUint32(pos, 9999, true); // claims 9999 bytes but only 2 remain
    expect(() => decodeOpusTags(buf)).toThrow(OggOpusHeaderError);
  });

  it('handles comment without = separator', () => {
    const data = buildOpusTags('encoder', ['TAGWITHOUTEQ']);
    const tags = decodeOpusTags(data);
    expect(tags.userComments[0]).toEqual({ key: 'TAGWITHOUTEQ', value: '' });
  });
});

// ---------------------------------------------------------------------------
// H-2: channel_mapping_family != 0 rejection
// ---------------------------------------------------------------------------

describe('decodeOpusHead (H-2: channel_mapping_family)', () => {
  it('throws OggOpusHeaderError for channel_mapping_family = 1 with 255 channels', () => {
    // 19-byte OpusHead with family=1, channelCount=255.
    const buf = new Uint8Array(19);
    const view = new DataView(buf.buffer);
    buf[0] = 0x4f;
    buf[1] = 0x70;
    buf[2] = 0x75;
    buf[3] = 0x73;
    buf[4] = 0x48;
    buf[5] = 0x65;
    buf[6] = 0x61;
    buf[7] = 0x64;
    buf[8] = 1; // version
    buf[9] = 255; // channel_count
    view.setUint16(10, 312, true);
    view.setUint32(12, 48000, true);
    view.setInt16(16, 0, true);
    buf[18] = 1; // channel_mapping_family = 1 (surround, not supported)
    expect(() => decodeOpusHead(buf)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for channel_mapping_family = 255', () => {
    const data = buildOpusHead({ channelMappingFamily: 255 });
    expect(() => decodeOpusHead(data)).toThrow(OggOpusHeaderError);
  });

  it('accepts channel_mapping_family = 0 (mono/stereo)', () => {
    const data = buildOpusHead({ channelMappingFamily: 0 });
    expect(() => decodeOpusHead(data)).not.toThrow();
  });
});

describe('decodeOpusHead (version boundary)', () => {
  it('rejects version with high nibble set (major != 1)', () => {
    const data = buildOpusHead({ version: 0x20 }); // major=2
    expect(() => decodeOpusHead(data)).toThrow(OggOpusHeaderError);
  });
});

describe('decodeOpusTags (vendor and comment length caps)', () => {
  it('throws OggOpusHeaderError for vendor string too long', () => {
    // Craft a packet where vendor_length > MAX_COMMENT_BYTES.
    const buf = new Uint8Array(8 + 4 + 1); // magic + vendor_len + 1 padding
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x4f;
    buf[pos++] = 0x70;
    buf[pos++] = 0x75;
    buf[pos++] = 0x73;
    buf[pos++] = 0x54;
    buf[pos++] = 0x61;
    buf[pos++] = 0x67;
    buf[pos++] = 0x73;
    view.setUint32(pos, MAX_COMMENT_BYTES + 1, true); // exceeds cap
    expect(() => decodeOpusTags(buf)).toThrow(OggOpusHeaderError);
  });

  it('throws OggOpusHeaderError for individual comment too long', () => {
    const enc = new TextEncoder();
    const vendorBytes = enc.encode('test');
    // magic(8) + vendor_len(4) + vendor + comment_count(4) + comment_len(4) + padding(1)
    const buf = new Uint8Array(8 + 4 + vendorBytes.length + 4 + 4 + 1);
    const view = new DataView(buf.buffer);
    let pos = 0;
    buf[pos++] = 0x4f;
    buf[pos++] = 0x70;
    buf[pos++] = 0x75;
    buf[pos++] = 0x73;
    buf[pos++] = 0x54;
    buf[pos++] = 0x61;
    buf[pos++] = 0x67;
    buf[pos++] = 0x73;
    view.setUint32(pos, vendorBytes.length, true);
    pos += 4;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    view.setUint32(pos, 1, true); // 1 comment
    pos += 4;
    view.setUint32(pos, MAX_COMMENT_BYTES + 1, true); // comment too long
    expect(() => decodeOpusTags(buf)).toThrow(OggOpusHeaderError);
  });
});
