/**
 * Tests for metadata block parsing utilities.
 *
 * Covers error paths and edge cases in decodeSeekTable, decodeVorbisComment,
 * decodePicture, parseBlockHeader, and encodeBlockHeader.
 */

import { describe, expect, it } from 'vitest';
import { FlacInvalidMetadataError } from './errors.ts';
import {
  decodePicture,
  decodeSeekTable,
  decodeVorbisComment,
  encodeBlockHeader,
  parseBlockHeader,
} from './metadata.ts';

// ---------------------------------------------------------------------------
// parseBlockHeader
// ---------------------------------------------------------------------------

describe('parseBlockHeader', () => {
  it('parses a standard non-last block header', () => {
    // type=4 (VORBIS_COMMENT), last=false, length=100
    const bytes = new Uint8Array([0x04, 0x00, 0x00, 0x64, 0x00]);
    const hdr = parseBlockHeader(bytes, 0);
    expect(hdr.lastBlock).toBe(false);
    expect(hdr.type).toBe(4);
    expect(hdr.length).toBe(100);
  });

  it('parses a last-block header', () => {
    // type=1 (PADDING), last=true, length=256
    const bytes = new Uint8Array([0x81, 0x00, 0x01, 0x00]);
    const hdr = parseBlockHeader(bytes, 0);
    expect(hdr.lastBlock).toBe(true);
    expect(hdr.type).toBe(1);
    expect(hdr.length).toBe(256);
  });

  it('parses a block header at non-zero offset', () => {
    const bytes = new Uint8Array([0xaa, 0xbb, 0x80, 0x00, 0x00, 0x22]);
    // STREAMINFO at offset 2, last=true, length=34
    const hdr = parseBlockHeader(bytes, 2);
    expect(hdr.lastBlock).toBe(true);
    expect(hdr.type).toBe(0);
    expect(hdr.length).toBe(34);
  });

  it('throws FlacInvalidMetadataError on truncated header', () => {
    const bytes = new Uint8Array([0x00, 0x00]); // only 2 bytes
    expect(() => parseBlockHeader(bytes, 0)).toThrow(FlacInvalidMetadataError);
  });
});

// ---------------------------------------------------------------------------
// encodeBlockHeader
// ---------------------------------------------------------------------------

describe('encodeBlockHeader', () => {
  it('encodes a non-last block header', () => {
    const hdr = encodeBlockHeader(false, 4, 100);
    expect(hdr[0]).toBe(0x04);
    expect(hdr[1]).toBe(0x00);
    expect(hdr[2]).toBe(0x00);
    expect(hdr[3]).toBe(0x64);
  });

  it('encodes a last-block header', () => {
    const hdr = encodeBlockHeader(true, 1, 256);
    expect(hdr[0]).toBe(0x81); // last=1 | type=1
    expect(hdr[2]).toBe(0x01); // 256 = 0x0100
    expect(hdr[3]).toBe(0x00);
  });

  it('round-trips with parseBlockHeader', () => {
    for (const type of [0, 1, 2, 3, 4, 5, 6]) {
      const encoded = encodeBlockHeader(false, type, 500);
      const decoded = parseBlockHeader(encoded, 0);
      expect(decoded.type).toBe(type);
      expect(decoded.length).toBe(500);
      expect(decoded.lastBlock).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// decodeSeekTable error paths
// ---------------------------------------------------------------------------

describe('decodeSeekTable error paths', () => {
  it('throws FlacInvalidMetadataError when body length is not a multiple of 18', () => {
    const bad = new Uint8Array(17);
    expect(() => decodeSeekTable(bad, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('returns empty array for zero-length body', () => {
    const empty = new Uint8Array(0);
    const pts = decodeSeekTable(empty, 0);
    expect(pts).toHaveLength(0);
  });

  it('decodes placeholder seek point (sampleNumber = 0xFFFFFFFFFFFFFFFF)', () => {
    // All bytes 0xFF for the first 8 bytes = sampleNumber = MAX_SAFE_INTEGER-ish
    const body = new Uint8Array(18).fill(0xff);
    const pts = decodeSeekTable(body, 0);
    expect(pts).toHaveLength(1);
    // The value will be very large (Number representation of 0xFFFFFFFFFFFFFFFF is imprecise)
    expect(pts[0]?.sampleNumber).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// decodeVorbisComment error paths
// ---------------------------------------------------------------------------

describe('decodeVorbisComment error paths', () => {
  it('throws when vendor string is truncated', () => {
    // vendor_length = 100 but only 10 bytes total
    const buf = new Uint8Array([100, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws when comment count truncates body', () => {
    // Build a valid vendor, then claim 100 comments with no data
    const vendor = 'OK';
    const vendorBytes = new TextEncoder().encode(vendor);
    const buf = new Uint8Array(4 + vendorBytes.length + 4);
    buf[0] = vendorBytes.length;
    buf.set(vendorBytes, 4);
    // comment count = 100 (no comment data follows)
    buf[4 + vendorBytes.length] = 100;
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws when comment body is truncated', () => {
    const vendor = 'OK';
    const vendorBytes = new TextEncoder().encode(vendor);
    // claim 1 comment of length 1000 but no bytes follow
    const buf = new Uint8Array(4 + vendorBytes.length + 4 + 4);
    buf[0] = vendorBytes.length;
    buf.set(vendorBytes, 4);
    buf[4 + vendorBytes.length] = 1; // 1 comment
    const commentLenOffset = 4 + vendorBytes.length + 4;
    buf[commentLenOffset] = 0xe8; // 1000 LE
    buf[commentLenOffset + 1] = 0x03;
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('skips malformed comments without = sign', () => {
    const vendor = 'Enc';
    const vendorBytes = new TextEncoder().encode(vendor);
    const noEq = new TextEncoder().encode('NOEQUALS');
    const buf = new Uint8Array(4 + vendorBytes.length + 4 + 4 + noEq.length);
    let pos = 0;
    buf[pos++] = vendorBytes.length;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    buf[pos++] = 1; // 1 comment
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf[pos++] = noEq.length;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf.set(noEq, pos);

    const vc = decodeVorbisComment(buf, 0);
    // malformed comment skipped
    expect(vc.comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decodePicture error paths
// ---------------------------------------------------------------------------

describe('decodePicture error paths', () => {
  it('throws when MIME type is truncated', () => {
    // Only 4 bytes (picture_type) + 4 bytes (mime_len = 1000) but no mime data
    const buf = new Uint8Array(8);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 3, false); // picture_type = 3
    dv.setUint32(4, 1000, false); // mime_len = 1000 (no data)
    expect(() => decodePicture(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws when description is truncated', () => {
    const mime = 'image/jpeg';
    const mimeBytes = new TextEncoder().encode(mime);
    const buf = new Uint8Array(4 + 4 + mimeBytes.length + 4);
    const dv = new DataView(buf.buffer);
    let pos = 0;
    dv.setUint32(pos, 3, false);
    pos += 4;
    dv.setUint32(pos, mimeBytes.length, false);
    pos += 4;
    buf.set(mimeBytes, pos);
    pos += mimeBytes.length;
    dv.setUint32(pos, 5000, false); // desc_len = 5000 (no data)
    expect(() => decodePicture(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws when picture data is truncated', () => {
    const mime = 'image/jpeg';
    const mimeBytes = new TextEncoder().encode(mime);
    const descBytes = new Uint8Array(0);
    const buf = new Uint8Array(4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 * 4 + 4);
    const dv = new DataView(buf.buffer);
    let pos = 0;
    dv.setUint32(pos, 3, false);
    pos += 4;
    dv.setUint32(pos, mimeBytes.length, false);
    pos += 4;
    buf.set(mimeBytes, pos);
    pos += mimeBytes.length;
    dv.setUint32(pos, 0, false);
    pos += 4; // empty desc
    dv.setUint32(pos, 640, false);
    pos += 4;
    dv.setUint32(pos, 480, false);
    pos += 4;
    dv.setUint32(pos, 24, false);
    pos += 4;
    dv.setUint32(pos, 0, false);
    pos += 4;
    dv.setUint32(pos, 99999, false); // data_len = 99999 but no data follows
    expect(() => decodePicture(buf, 0)).toThrow(FlacInvalidMetadataError);
  });
});

// ---------------------------------------------------------------------------
// readUint32LE / readUint32BE throw branches
// ---------------------------------------------------------------------------

describe('readUint32LE throws on truncated data in decodeVorbisComment', () => {
  it('throws when comment count (readUint32LE) goes past end', () => {
    // vendor_length = 0, but then only 3 bytes remain (not 4 for comment count)
    const buf = new Uint8Array([0, 0, 0, 0, 1, 2, 3]); // vendor_length=0, then 3 bytes
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });
});

describe('readUint32BE throws on truncated data in decodePicture', () => {
  it('throws when picture_type field (readUint32BE) goes past end', () => {
    // Only 2 bytes — not enough for 4-byte picture_type
    const buf = new Uint8Array([0x00, 0x00]);
    expect(() => decodePicture(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws when width field is truncated after valid mime+desc', () => {
    const mime = 'a';
    const mimeBytes = new TextEncoder().encode(mime);
    // picture_type + mime_len + mime + desc_len + desc = ok; then width truncated
    const buf = new Uint8Array(4 + 4 + mimeBytes.length + 4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 3, false);
    dv.setUint32(4, mimeBytes.length, false);
    buf.set(mimeBytes, 8);
    dv.setUint32(8 + mimeBytes.length, 0, false); // empty desc
    // No more bytes — width readUint32BE will throw
    expect(() => decodePicture(buf, 0)).toThrow(FlacInvalidMetadataError);
  });
});

// ---------------------------------------------------------------------------
// H-2: SEEKTABLE allocation cap
// ---------------------------------------------------------------------------

describe('H-2: decodeSeekTable MAX_SEEKPOINTS cap', () => {
  it('throws FlacInvalidMetadataError when count > 65536', () => {
    // 65_537 seek points * 18 bytes each = 1,179,666 bytes
    const count = 65_537;
    const body = new Uint8Array(count * 18); // all zeros → valid structure, just too many
    expect(() => decodeSeekTable(body, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('accepts exactly 65536 seek points (boundary)', () => {
    const count = 65_536;
    const body = new Uint8Array(count * 18);
    // Should not throw
    const pts = decodeSeekTable(body, 0);
    expect(pts).toHaveLength(count);
  });
});

// ---------------------------------------------------------------------------
// H-3: VORBIS_COMMENT count and per-comment length caps
// ---------------------------------------------------------------------------

describe('H-3: decodeVorbisComment caps', () => {
  it('throws FlacInvalidMetadataError when commentCount > 100_000', () => {
    // Craft a body with vendor="" then commentCount = 100_001
    const buf = new Uint8Array(4 + 4); // vendor_length=0, comment_count=100001
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0, true); // vendor_length = 0 (LE)
    dv.setUint32(4, 100_001, true); // comment_count = 100_001 (LE)
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });

  it('throws FlacInvalidMetadataError when a single comment exceeds 1 MiB', () => {
    // vendor="" + commentCount=1 + commentLen=1MiB+1
    const bigLen = 1 * 1024 * 1024 + 1;
    const buf = new Uint8Array(4 + 4 + 4); // vendor=0, count=1, len=bigLen (no data needed — throws on cap)
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0, true); // vendor_length = 0
    dv.setUint32(4, 1, true); // comment_count = 1
    dv.setUint32(8, bigLen, true); // comment length = 1 MiB + 1
    expect(() => decodeVorbisComment(buf, 0)).toThrow(FlacInvalidMetadataError);
  });
});

// ---------------------------------------------------------------------------
// serializer error paths (covered here since serializer.ts has uncovered lines)
// ---------------------------------------------------------------------------

describe('serializeFlac error paths', () => {
  it('throws FlacInvalidMetadataError when STREAMINFO is not the first block', async () => {
    const { serializeFlac } = await import('./serializer.ts');
    const { parseFlac } = await import('./parser.ts');
    const { loadFixture } = await import('@catlabtech/webcvt-test-utils');

    const bytes = await loadFixture('audio/sine-1s-44100-mono.flac');
    const flac = parseFlac(bytes);

    // Swap blocks so STREAMINFO is not first
    const swapped = {
      ...flac,
      blocks: [...flac.blocks].reverse(),
    };

    expect(() => serializeFlac(swapped)).toThrow(FlacInvalidMetadataError);
  });

  it('recomputes totalSamples when original is 0', async () => {
    const { serializeFlac } = await import('./serializer.ts');
    const { parseFlac } = await import('./parser.ts');
    const { loadFixture } = await import('@catlabtech/webcvt-test-utils');

    const bytes = await loadFixture('audio/sine-1s-44100-mono.flac');
    const flac = parseFlac(bytes);

    // Patch totalSamples to 0 in streamInfo
    const modified = { ...flac, streamInfo: { ...flac.streamInfo, totalSamples: 0 } };
    const serialized = serializeFlac(modified);
    // Re-parse and check totalSamples is now computed from frames
    const reparsed = parseFlac(serialized);
    expect(reparsed.streamInfo.totalSamples).toBeGreaterThan(0);
  });
});
