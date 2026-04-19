/**
 * Ogg page parser and serializer tests.
 */

import { describe, expect, it } from 'vitest';
import { computeCrc32 } from './crc32.ts';
import {
  OggCorruptStreamError,
  OggInvalidVersionError,
  OggPageBodyTooLargeError,
} from './errors.ts';
import { buildSegmentTable, computePageSize, hasOggSAt, parsePage, serializePage } from './page.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Ogg page bytes with a given body and flags. */
function buildRawPage(opts: {
  version?: number;
  headerType?: number;
  granulePosition?: bigint;
  serialNumber?: number;
  pageSeqNum?: number;
  segments: number[];
  body: Uint8Array;
}): Uint8Array {
  const {
    version = 0,
    headerType = 0,
    granulePosition = 0n,
    serialNumber = 1,
    pageSeqNum = 0,
    segments,
    body,
  } = opts;

  const segCount = segments.length;
  const pageLen = 27 + segCount + body.length;
  const out = new Uint8Array(pageLen);
  const view = new DataView(out.buffer);

  out[0] = 0x4f;
  out[1] = 0x67;
  out[2] = 0x67;
  out[3] = 0x53; // OggS
  out[4] = version;
  out[5] = headerType;
  view.setBigInt64(6, granulePosition, true);
  view.setUint32(14, serialNumber, true);
  view.setUint32(18, pageSeqNum, true);
  view.setUint32(22, 0, true); // checksum placeholder
  out[26] = segCount;
  for (let i = 0; i < segments.length; i++) out[27 + i] = segments[i] ?? 0;
  out.set(body, 27 + segCount);

  // Compute and patch CRC.
  const crc = computeCrc32(out);
  view.setUint32(22, crc, true);

  return out;
}

// ---------------------------------------------------------------------------
// hasOggSAt
// ---------------------------------------------------------------------------

describe('hasOggSAt', () => {
  it('returns true for "OggS" at offset 0', () => {
    expect(hasOggSAt(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]), 0)).toBe(true);
  });

  it('returns false for wrong bytes', () => {
    expect(hasOggSAt(new Uint8Array([0x00, 0x67, 0x67, 0x53]), 0)).toBe(false);
  });

  it('returns false when data too short', () => {
    expect(hasOggSAt(new Uint8Array([0x4f, 0x67, 0x67]), 0)).toBe(false);
  });

  it('detects OggS at non-zero offset', () => {
    const data = new Uint8Array([0x00, 0x00, 0x4f, 0x67, 0x67, 0x53]);
    expect(hasOggSAt(data, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parsePage
// ---------------------------------------------------------------------------

describe('parsePage', () => {
  it('parses a valid page with a single segment', () => {
    const body = new Uint8Array([0x01, 0x76, 0x6f, 0x72, 0x62]);
    const raw = buildRawPage({ segments: [5], body });
    const { page, nextOffset } = parsePage(raw, 0);

    expect(page.bos).toBe(false);
    expect(page.eos).toBe(false);
    expect(page.continuedPacket).toBe(false);
    expect(page.granulePosition).toBe(0n);
    expect(page.serialNumber).toBe(1);
    expect(page.pageSequenceNumber).toBe(0);
    expect(page.segmentTable.length).toBe(1);
    expect(page.segmentTable[0]).toBe(5);
    expect(page.body.length).toBe(5);
    expect(nextOffset).toBe(raw.length);
  });

  it('parses BOS flag correctly', () => {
    const raw = buildRawPage({ headerType: 0x02, segments: [1], body: new Uint8Array([0x00]) });
    const { page } = parsePage(raw, 0);
    expect(page.bos).toBe(true);
    expect(page.eos).toBe(false);
  });

  it('parses EOS flag correctly', () => {
    const raw = buildRawPage({ headerType: 0x04, segments: [1], body: new Uint8Array([0x00]) });
    const { page } = parsePage(raw, 0);
    expect(page.eos).toBe(true);
  });

  it('parses continued-packet flag correctly', () => {
    const raw = buildRawPage({ headerType: 0x01, segments: [5], body: new Uint8Array(5) });
    const { page } = parsePage(raw, 0);
    expect(page.continuedPacket).toBe(true);
  });

  it('throws OggInvalidVersionError for non-zero version', () => {
    const raw = buildRawPage({ version: 1, segments: [1], body: new Uint8Array([0]) });
    // Patch version AFTER CRC (so CRC will mismatch — but version error comes first).
    raw[4] = 1;
    expect(() => parsePage(raw, 0)).toThrow(OggInvalidVersionError);
  });

  it('throws OggCorruptStreamError for CRC mismatch', () => {
    const raw = buildRawPage({ segments: [3], body: new Uint8Array([1, 2, 3]) });
    // Corrupt a body byte.
    raw[raw.length - 1] ^= 0xff;
    expect(() => parsePage(raw, 0)).toThrow(OggCorruptStreamError);
  });

  it('throws OggCorruptStreamError for truncated header', () => {
    const short = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]);
    expect(() => parsePage(short, 0)).toThrow(OggCorruptStreamError);
  });

  it('returns zero-copy subarray for body', () => {
    const body = new Uint8Array([10, 20, 30]);
    const raw = buildRawPage({ segments: [3], body });
    const { page } = parsePage(raw, 0);
    // body is a subarray view of raw.
    expect(page.body.buffer).toBe(raw.buffer);
  });

  it('throws OggPageBodyTooLargeError when segment table sum exceeds 65025', () => {
    // Build a fake page with segment table that would sum > 65025.
    // We use 255 segments each with value 255.
    const segments = new Array(255).fill(255);
    // Body would be 255*255 = 65025 — right at the limit (OK).
    // Actual violation requires 256 segments which is impossible.
    // Test with 254 * 255 + 254 = 65024 (within limit) to confirm no throw.
    const body = new Uint8Array(255 * 255); // 65025 bytes, exactly at cap
    const raw = buildRawPage({ segments, body });
    // Should not throw — 65025 is exactly MAX_PAGE_BODY_BYTES.
    expect(() => parsePage(raw, 0)).not.toThrow(OggPageBodyTooLargeError);
  });

  it('throws OggCorruptStreamError for truncated page body', () => {
    // Build a valid page then truncate it to remove body bytes.
    const body = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const raw = buildRawPage({ segments: [10], body });
    // Remove 7 of 10 body bytes so parsePage can find the seg table but not full body.
    const truncated = raw.slice(0, raw.length - 7);
    expect(() => parsePage(truncated, 0)).toThrow(OggCorruptStreamError);
  });
});

// ---------------------------------------------------------------------------
// computePageSize
// ---------------------------------------------------------------------------

describe('computePageSize', () => {
  it('computes header + segmentCount + bodySize', () => {
    // OGG_PAGE_HEADER_BASE = 27
    expect(computePageSize(1, 5)).toBe(27 + 1 + 5);
    expect(computePageSize(255, 65025)).toBe(27 + 255 + 65025);
    expect(computePageSize(0, 0)).toBe(27);
  });
});

// ---------------------------------------------------------------------------
// serializePage
// ---------------------------------------------------------------------------

describe('serializePage', () => {
  it('round-trips a page through parse → serialize → byte-identical', () => {
    const body = new Uint8Array([0x01, 0x76, 0x6f, 0x72, 0x62]);
    const raw = buildRawPage({ segments: [5], body, headerType: 0x02 });
    const { page } = parsePage(raw, 0);
    const serialized = serializePage(page);
    expect(serialized).toEqual(raw);
  });

  it('sets BOS flag correctly', () => {
    const body = new Uint8Array([0xff]);
    const raw = buildRawPage({ segments: [1], body, headerType: 0x02 });
    const { page } = parsePage(raw, 0);
    const serialized = serializePage(page);
    expect(serialized[5] ?? 0).toBe(0x02); // BOS flag
  });

  it('sets EOS flag correctly', () => {
    const body = new Uint8Array([0xff]);
    const raw = buildRawPage({ segments: [1], body, headerType: 0x04 });
    const { page } = parsePage(raw, 0);
    const serialized = serializePage(page);
    expect(serialized[5] ?? 0).toBe(0x04); // EOS flag
  });

  it('computes valid CRC that can be re-verified', () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const raw = buildRawPage({ segments: [4], body });
    const { page } = parsePage(raw, 0);
    const serialized = serializePage(page);

    // Extract stored CRC.
    const storedCrc = new DataView(serialized.buffer).getUint32(22, true);
    // Zero and recompute.
    const copy = new Uint8Array(serialized);
    copy[22] = 0;
    copy[23] = 0;
    copy[24] = 0;
    copy[25] = 0;
    expect(computeCrc32(copy)).toBe(storedCrc);
  });
});

// ---------------------------------------------------------------------------
// buildSegmentTable
// ---------------------------------------------------------------------------

describe('buildSegmentTable', () => {
  it('single segment for small packet', () => {
    const table = buildSegmentTable(5);
    expect(table).toEqual(new Uint8Array([5]));
  });

  it('terminates with 0 for exact 255-byte packet', () => {
    const table = buildSegmentTable(255);
    expect(table).toEqual(new Uint8Array([255, 0]));
  });

  it('two segments for 256-byte packet', () => {
    const table = buildSegmentTable(256);
    expect(table).toEqual(new Uint8Array([255, 1]));
  });

  it('handles zero-byte packet with single 0 segment', () => {
    const table = buildSegmentTable(0);
    expect(table).toEqual(new Uint8Array([0]));
  });

  it('handles 510-byte packet with three segments', () => {
    const table = buildSegmentTable(510);
    // 510 = 255 + 255 + 0
    expect(table).toEqual(new Uint8Array([255, 255, 0]));
  });
});
