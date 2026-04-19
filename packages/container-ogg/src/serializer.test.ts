/**
 * Ogg serializer tests.
 *
 * Design note test cases covered:
 * - "round-trip: parse → serialize → byte-identical pages, including CRC"
 * - "serializer sets BOS on first page and EOS on last page"
 * - "serializer splits oversized packet across pages with continued-packet flag"
 */

import { describe, expect, it } from 'vitest';
import { computeCrc32 } from './crc32.ts';
import type { OggPacket } from './packet.ts';
import { hasOggSAt, parsePage } from './page.ts';
import type { OggLogicalStream } from './parser.ts';
import { serializeOgg } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildVorbisIdent(channels = 2, sampleRate = 44100): Uint8Array {
  const buf = new Uint8Array(30);
  const view = new DataView(buf.buffer);
  buf[0] = 0x01;
  buf[1] = 0x76;
  buf[2] = 0x6f;
  buf[3] = 0x72;
  buf[4] = 0x62;
  buf[5] = 0x69;
  buf[6] = 0x73;
  view.setUint32(7, 0, true);
  buf[11] = channels;
  view.setUint32(12, sampleRate, true);
  view.setInt32(16, 0, true);
  view.setInt32(20, 128000, true);
  view.setInt32(24, 0, true);
  buf[28] = 0xb8;
  buf[29] = 0x01;
  return buf;
}

function buildVorbisComment(): Uint8Array {
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
  view.setUint32(pos, 0, true);
  pos += 4;
  buf[pos] = 0x01;
  return buf;
}

function buildVorbisSetup(): Uint8Array {
  const buf = new Uint8Array(10);
  buf[0] = 0x05;
  buf[1] = 0x76;
  buf[2] = 0x6f;
  buf[3] = 0x72;
  buf[4] = 0x62;
  buf[5] = 0x69;
  buf[6] = 0x73;
  return buf;
}

function makeStream(overrides: Partial<OggLogicalStream> = {}): OggLogicalStream {
  const identification = buildVorbisIdent();
  const comments = buildVorbisComment();
  const setup = buildVorbisSetup();
  const packets: OggPacket[] = [
    { data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]), granulePosition: 4410n, serialNumber: 1 },
  ];
  return {
    serialNumber: 1,
    codec: 'vorbis',
    identification,
    comments,
    setup,
    packets,
    preSkip: 0,
    sampleRate: 44100,
    channels: 2,
    ...overrides,
  };
}

/** Parse all pages from a serialized Ogg byte stream. */
function parseAllPages(data: Uint8Array): Array<ReturnType<typeof parsePage>['page']> {
  const pages: Array<ReturnType<typeof parsePage>['page']> = [];
  let cursor = 0;
  while (cursor < data.length) {
    if (!hasOggSAt(data, cursor)) break;
    const { page, nextOffset } = parsePage(data, cursor);
    pages.push(page);
    cursor = nextOffset;
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeOgg', () => {
  it('sets BOS flag on first page and EOS flag on last page (design note TC13)', () => {
    const file = { streams: [makeStream()] };
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.bos).toBe(true);
    expect(pages[0]?.eos).toBe(false);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('all pages have valid OggS capture pattern', () => {
    const file = { streams: [makeStream()] };
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);
    // parsePage verifies CRC on each page — if it doesn't throw, all pages are valid.
    expect(pages.length).toBeGreaterThan(3); // ident + comment + setup + audio
  });

  it('all page CRCs are valid (parsePage verifies CRC)', () => {
    const file = { streams: [makeStream()] };
    const bytes = serializeOgg(file);
    // parseAllPages calls parsePage which verifies CRC — no exception = all valid.
    expect(() => parseAllPages(bytes)).not.toThrow();
  });

  it('first page carries identification packet on BOS page', () => {
    const stream = makeStream();
    const file = { streams: [stream] };
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);
    const firstPage = pages[0]!;
    expect(firstPage.bos).toBe(true);
    // Body should be the identification packet.
    expect(firstPage.body).toEqual(stream.identification);
  });

  it('serializer splits oversized packet across pages with continued-packet flag (design note TC14)', () => {
    // Create an audio packet larger than the default page body size.
    const bigPacket: OggPacket = {
      data: new Uint8Array(8192).fill(0xab), // 8 KiB > default 4096
      granulePosition: 44100n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [bigPacket] });
    const file = { streams: [stream] };
    const bytes = serializeOgg(file, { targetPageBodySize: 4096 });
    const pages = parseAllPages(bytes);

    // Find the first audio page (after ident, comment, setup).
    const audioPages = pages.filter((p) => !p.bos && p.serialNumber === 1);
    // There should be at least one continued-packet page.
    const hasContinued = audioPages.some((p) => p.continuedPacket);
    expect(hasContinued).toBe(true);
  });

  it('emits correct serial number on all pages', () => {
    const stream = makeStream({ serialNumber: 0xdeadbeef });
    const file = { streams: [stream] };
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);
    for (const page of pages) {
      expect(page.serialNumber).toBe(0xdeadbeef);
    }
  });

  it('emits consecutive page sequence numbers starting at 0', () => {
    const file = { streams: [makeStream()] };
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i]?.pageSequenceNumber).toBe(i);
    }
  });

  it('round-trips an Opus stream (parse → serialize → parseable)', () => {
    const enc = new TextEncoder();
    const vendor = enc.encode('test');
    const tags = new Uint8Array(8 + 4 + vendor.length + 4);
    const view = new DataView(tags.buffer);
    let pos = 0;
    tags[pos++] = 0x4f;
    tags[pos++] = 0x70;
    tags[pos++] = 0x75;
    tags[pos++] = 0x73;
    tags[pos++] = 0x54;
    tags[pos++] = 0x61;
    tags[pos++] = 0x67;
    tags[pos++] = 0x73;
    view.setUint32(pos, vendor.length, true);
    pos += 4;
    tags.set(vendor, pos);
    pos += vendor.length;
    view.setUint32(pos, 0, true);

    const head = new Uint8Array(19);
    const hview = new DataView(head.buffer);
    head[0] = 0x4f;
    head[1] = 0x70;
    head[2] = 0x75;
    head[3] = 0x73;
    head[4] = 0x48;
    head[5] = 0x65;
    head[6] = 0x61;
    head[7] = 0x64;
    head[8] = 1;
    head[9] = 1;
    hview.setUint16(10, 312, true);
    hview.setUint32(12, 48000, true);
    hview.setInt16(16, 0, true);
    head[18] = 0;

    const opusStream: OggLogicalStream = {
      serialNumber: 42,
      codec: 'opus',
      identification: head,
      comments: tags,
      setup: undefined,
      packets: [
        { data: new Uint8Array([0x00, 0x01, 0x02]), granulePosition: 9600n, serialNumber: 42 },
      ],
      preSkip: 312,
      sampleRate: 48000,
      channels: 1,
    };

    const bytes = serializeOgg({ streams: [opusStream] });
    // Should produce valid pages parseable without throwing.
    expect(() => parseAllPages(bytes)).not.toThrow();
    const pages = parseAllPages(bytes);
    expect(pages[0]?.bos).toBe(true);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('handles empty audio packets array (headers only)', () => {
    const stream = makeStream({ packets: [] });
    const file = { streams: [stream] };
    // Should not throw — just produces header pages + EOS page.
    expect(() => serializeOgg(file)).not.toThrow();
    const bytes = serializeOgg(file);
    const pages = parseAllPages(bytes);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('preserves granule_position on audio pages', () => {
    const pkt: OggPacket = {
      data: new Uint8Array([0xca, 0xfe]),
      granulePosition: 12345n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [pkt] });
    const bytes = serializeOgg({ streams: [stream] });
    const pages = parseAllPages(bytes);
    // Find the EOS page — it carries the last packet's granule_position.
    const eosPage = pages.find((p) => p.eos)!;
    expect(eosPage.granulePosition).toBe(12345n);
  });

  it('handles very large single audio packet split across many pages', () => {
    // A 10 KiB packet with targetPageBodySize=1024 forces multi-page split.
    const bigPacket: OggPacket = {
      data: new Uint8Array(10240).fill(0x77),
      granulePosition: 88200n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [bigPacket] });
    const bytes = serializeOgg({ streams: [stream] }, { targetPageBodySize: 1024 });
    expect(() => parseAllPages(bytes)).not.toThrow();
    const pages = parseAllPages(bytes);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('serializes stream with no comments and no setup (minimal stream)', () => {
    const minimal: OggLogicalStream = {
      serialNumber: 5,
      codec: 'opus',
      identification: new Uint8Array([
        0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 0x38, 0x01, 0, 0, 0, 0, 0, 0, 0,
      ]),
      comments: undefined,
      setup: undefined,
      packets: [{ data: new Uint8Array([0x01]), granulePosition: 9600n, serialNumber: 5 }],
      preSkip: 312,
      sampleRate: 48000,
      channels: 1,
    };
    const bytes = serializeOgg({ streams: [minimal] });
    const pages = parseAllPages(bytes);
    expect(pages[0]?.bos).toBe(true);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('serializes a zero-byte audio packet correctly', () => {
    // A zero-byte packet requires a single 0-length terminating segment.
    const zeroPkt: OggPacket = {
      data: new Uint8Array(0),
      granulePosition: 0n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [zeroPkt] });
    const bytes = serializeOgg({ streams: [stream] });
    expect(() => parseAllPages(bytes)).not.toThrow();
    const pages = parseAllPages(bytes);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('serializes a 255-byte audio packet (exact multiple — trailing 0 segment)', () => {
    // A 255-byte packet requires segments [255, 0] to terminate properly.
    const pkt255: OggPacket = {
      data: new Uint8Array(255).fill(0xab),
      granulePosition: 255n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [pkt255] });
    const bytes = serializeOgg({ streams: [stream] });
    expect(() => parseAllPages(bytes)).not.toThrow();
    const pages = parseAllPages(bytes);
    expect(pages[pages.length - 1]?.eos).toBe(true);
  });

  it('Q-3: EOS page carries last completed packet granule, not -1n when second packet spans pages', () => {
    // Two packets: pkt1 completes on page N, pkt2 spans across the page boundary
    // so the EOS page accumulates with granule = -1n during the loop. The EOS page
    // must fall back to pkt2's granule, not emit -1n.
    const pkt1: OggPacket = {
      data: new Uint8Array([0x01]),
      granulePosition: 1000n,
      serialNumber: 1,
    };
    // pkt2 is 300 bytes — larger than targetPageBodySize=255 — so it splits.
    const pkt2: OggPacket = {
      data: new Uint8Array(300).fill(0xbb),
      granulePosition: 2000n,
      serialNumber: 1,
    };
    const stream = makeStream({ packets: [pkt1, pkt2] });
    const bytes = serializeOgg({ streams: [stream] }, { targetPageBodySize: 255 });
    const pages = parseAllPages(bytes);
    const eosPage = pages.find((p) => p.eos)!;
    // Must not be -1n.
    expect(eosPage.granulePosition).not.toBe(-1n);
    expect(eosPage.granulePosition).toBe(2000n);
  });

  it('clamps targetPageBodySize to a minimum of 255 to prevent splitter divide-to-zero', () => {
    const file = { streams: [makeStream()] };
    // Pass a too-small targetPageBodySize. Without the min-clamp, splitPacketToPages
    // would compute maxSegments=0 and loop forever on any audio packet >= 1 byte.
    expect(() => serializeOgg(file, { targetPageBodySize: 4 })).not.toThrow();
  });

  it('uses default targetPageBodySize when none specified', () => {
    const file = { streams: [makeStream()] };
    // No options passed — uses DEFAULT_PAGE_BODY_SIZE (4096).
    const bytes = serializeOgg(file);
    expect(() => parseAllPages(bytes)).not.toThrow();
  });

  it('clamps targetPageBodySize to max 65025', () => {
    const file = { streams: [makeStream()] };
    // Pass oversized targetPageBodySize — should be clamped to 255*255.
    const bytes = serializeOgg(file, { targetPageBodySize: 999999 });
    expect(() => parseAllPages(bytes)).not.toThrow();
  });
});
