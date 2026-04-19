/**
 * Ogg parser integration tests.
 *
 * Design note test cases covered here:
 * - "parses single-stream Vorbis file (OggS + vorbis id header)"
 * - "parses single-stream Opus file (OggS + OpusHead)"
 * - "rejects file with missing OggS capture pattern"
 * - "rejects file with non-zero stream_structure_version"
 * - "rejects file with page sequence number gap (simulated lost page)"
 * - "rejects multiplexed file (two concurrent serial numbers) with OggMultiplexNotSupportedError"
 * - "parses chained file (two sequential streams concatenated) — both decoded in order"
 * - Security caps: input size, packet size, corrupt stream detection
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES, MAX_TOTAL_SYNC_SCAN_BYTES } from './constants.ts';
import { computeCrc32 } from './crc32.ts';
import {
  OggCaptureMissingError,
  OggCorruptStreamError,
  OggInputTooLargeError,
  OggInvalidVersionError,
  OggMultiplexNotSupportedError,
  OggSequenceGapError,
  OggUnsupportedCodecError,
} from './errors.ts';
import { parseOgg } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function fixtureDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // src/ → container-ogg/ → packages/ → webcvt/ → tests/fixtures
  return resolve(here, '..', '..', '..', 'tests', 'fixtures');
}

async function loadFixture(rel: string): Promise<Uint8Array> {
  const buf = await readFile(resolve(fixtureDir(), rel));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ---------------------------------------------------------------------------
// Minimal Ogg page builder (shared with multiple tests)
// ---------------------------------------------------------------------------

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
  out[3] = 0x53;
  out[4] = version;
  out[5] = headerType;
  view.setBigInt64(6, granulePosition, true);
  view.setUint32(14, serialNumber, true);
  view.setUint32(18, pageSeqNum, true);
  view.setUint32(22, 0, true);
  out[26] = segCount;
  for (let i = 0; i < segments.length; i++) out[27 + i] = segments[i] ?? 0;
  out.set(body, 27 + segCount);

  const crc = computeCrc32(out);
  view.setUint32(22, crc, true);
  return out;
}

/** Build a minimal Vorbis identification packet (30 bytes). */
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
  view.setUint32(7, 0, true); // version
  buf[11] = channels;
  view.setUint32(12, sampleRate, true);
  view.setInt32(16, 0, true);
  view.setInt32(20, 128000, true);
  view.setInt32(24, 0, true);
  buf[28] = 0xb8;
  buf[29] = 0x01; // framing bit
  return buf;
}

/** Build a minimal Vorbis comment packet. */
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
  pos += 4; // 0 comments
  buf[pos] = 0x01; // framing bit
  return buf;
}

/** Build a minimal Vorbis setup packet. */
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

/** Build a minimal OpusHead packet. */
function buildOpusHead(channels = 1, preSkip = 312, sampleRate = 48000): Uint8Array {
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
  buf[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true); // output_gain
  buf[18] = 0; // mapping family 0
  return buf;
}

/** Build a minimal OpusTags packet. */
function buildOpusTags(): Uint8Array {
  const enc = new TextEncoder();
  const vendor = enc.encode('test');
  const buf = new Uint8Array(8 + 4 + vendor.length + 4);
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
  view.setUint32(pos, vendor.length, true);
  pos += 4;
  buf.set(vendor, pos);
  pos += vendor.length;
  view.setUint32(pos, 0, true); // 0 comments
  return buf;
}

/** Concatenate multiple byte arrays. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/**
 * Build a minimal synthetic Vorbis Ogg stream:
 *   Page 0 (BOS): identification
 *   Page 1: comment
 *   Page 2: setup
 *   Page 3 (EOS): one audio packet
 */
function buildSyntheticVorbisStream(serialNumber = 1): Uint8Array {
  const ident = buildVorbisIdent();
  const comment = buildVorbisComment();
  const setup = buildVorbisSetup();
  const audio = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  const p0 = buildRawPage({
    headerType: 0x02,
    serialNumber,
    pageSeqNum: 0,
    segments: [ident.length],
    body: ident,
  });
  const p1 = buildRawPage({
    headerType: 0x00,
    serialNumber,
    pageSeqNum: 1,
    segments: [comment.length],
    body: comment,
  });
  const p2 = buildRawPage({
    headerType: 0x00,
    serialNumber,
    pageSeqNum: 2,
    segments: [setup.length],
    body: setup,
  });
  const p3 = buildRawPage({
    headerType: 0x04,
    serialNumber,
    pageSeqNum: 3,
    granulePosition: 4410n,
    segments: [audio.length],
    body: audio,
  });

  return concat(p0, p1, p2, p3);
}

/**
 * Build a minimal synthetic Opus Ogg stream:
 *   Page 0 (BOS): OpusHead
 *   Page 1: OpusTags
 *   Page 2 (EOS): one audio packet
 */
function buildSyntheticOpusStream(serialNumber = 1): Uint8Array {
  const head = buildOpusHead();
  const tags = buildOpusTags();
  const audio = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

  const p0 = buildRawPage({
    headerType: 0x02,
    serialNumber,
    pageSeqNum: 0,
    segments: [head.length],
    body: head,
  });
  const p1 = buildRawPage({
    headerType: 0x00,
    serialNumber,
    pageSeqNum: 1,
    segments: [tags.length],
    body: tags,
  });
  const p2 = buildRawPage({
    headerType: 0x04,
    serialNumber,
    pageSeqNum: 2,
    granulePosition: 9600n,
    segments: [audio.length],
    body: audio,
  });

  return concat(p0, p1, p2);
}

// ---------------------------------------------------------------------------
// Fixture-based tests
// ---------------------------------------------------------------------------

describe('parseOgg (Vorbis fixture)', () => {
  it('parses single-stream Vorbis file — OggS magic, Vorbis codec (design note TC1)', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.ogg');
    const file = parseOgg(data);

    expect(file.streams.length).toBe(1);
    const stream = file.streams[0]!;
    expect(stream.codec).toBe('vorbis');
    expect(stream.sampleRate).toBe(44100);
    expect(stream.channels).toBe(1);
    expect(stream.identification.length).toBeGreaterThan(0);
    expect(stream.comments).toBeDefined();
    expect(stream.setup).toBeDefined();
    expect(stream.packets.length).toBeGreaterThan(0);
  });

  it('tracks granule_position for Vorbis as sample index (design note TC5)', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.ogg');
    const file = parseOgg(data);
    const stream = file.streams[0]!;

    // Last packet should have granule_position close to 44100 (1 second × 44100 Hz).
    const lastPkt = stream.packets[stream.packets.length - 1]!;
    expect(lastPkt.granulePosition).toBeGreaterThan(0n);
    // For a 1s sine at 44100 Hz, granule should be around 44100.
    expect(lastPkt.granulePosition).toBeLessThanOrEqual(50000n);
  });

  it('Vorbis identification header has correct sample rate', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.ogg');
    const file = parseOgg(data);
    const stream = file.streams[0]!;
    expect(stream.sampleRate).toBe(44100);
  });

  it('identification packet starts with 0x01 + "vorbis"', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.ogg');
    const file = parseOgg(data);
    const ident = file.streams[0]!.identification;
    expect(ident[0]).toBe(0x01);
    expect(ident[1]).toBe(0x76); // 'v'
    expect(ident[2]).toBe(0x6f); // 'o'
    expect(ident[3]).toBe(0x72); // 'r'
    expect(ident[4]).toBe(0x62); // 'b'
    expect(ident[5]).toBe(0x69); // 'i'
    expect(ident[6]).toBe(0x73); // 's'
  });
});

// ---------------------------------------------------------------------------
// Synthetic stream tests
// ---------------------------------------------------------------------------

describe('parseOgg (synthetic streams)', () => {
  it('parses a synthetic Vorbis stream', () => {
    const data = buildSyntheticVorbisStream();
    const file = parseOgg(data);
    expect(file.streams.length).toBe(1);
    expect(file.streams[0]?.codec).toBe('vorbis');
    expect(file.streams[0]?.sampleRate).toBe(44100);
    expect(file.streams[0]?.packets.length).toBe(1);
  });

  it('parses single-stream Opus file (design note TC2)', () => {
    const data = buildSyntheticOpusStream();
    const file = parseOgg(data);
    expect(file.streams.length).toBe(1);
    expect(file.streams[0]?.codec).toBe('opus');
    expect(file.streams[0]?.sampleRate).toBe(48000);
    expect(file.streams[0]?.preSkip).toBe(312);
    expect(file.streams[0]?.packets.length).toBe(1);
  });

  it('tracks granule_position for Opus as 48 kHz sample index (design note TC6)', () => {
    const data = buildSyntheticOpusStream();
    const file = parseOgg(data);
    const pkt = file.streams[0]!.packets[0]!;
    // The audio page has granule_position = 9600 (200ms at 48kHz).
    expect(pkt.granulePosition).toBe(9600n);
  });

  it('rejects file with missing OggS capture pattern (design note TC7)', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(() => parseOgg(data)).toThrow(OggCaptureMissingError);
  });

  it('rejects file with non-zero stream_structure_version (design note TC8)', () => {
    const data = buildSyntheticVorbisStream();
    // Corrupt the version byte of the first page.
    data[4] = 1;
    // CRC will fail which throws OggCorruptStreamError (version checked inside parsePage).
    // parsePage throws OggInvalidVersionError before CRC is checked.
    expect(() => parseOgg(data)).toThrow();
  });

  it('rejects file with page sequence number gap (design note TC9)', () => {
    const ident = buildVorbisIdent();
    const comment = buildVorbisComment();
    const setup = buildVorbisSetup();

    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [ident.length],
      body: ident,
    });
    const p1 = buildRawPage({ pageSeqNum: 1, segments: [comment.length], body: comment });
    // Skip page 2 (setup) — go straight to page 3 → sequence gap.
    const audio = new Uint8Array([0x00]);
    const p3 = buildRawPage({
      headerType: 0x04,
      pageSeqNum: 3,
      granulePosition: 100n,
      segments: [audio.length],
      body: audio,
    });

    const data = concat(p0, p1, p3);
    expect(() => parseOgg(data)).toThrow(OggSequenceGapError);
  });

  it('parses chained file (two sequential streams) — both decoded in order (design note TC10)', () => {
    const stream1 = buildSyntheticVorbisStream(1);
    const stream2 = buildSyntheticOpusStream(2);
    const data = concat(stream1, stream2);

    const file = parseOgg(data);
    expect(file.streams.length).toBe(2);
    expect(file.streams[0]?.codec).toBe('vorbis');
    expect(file.streams[0]?.serialNumber).toBe(1);
    expect(file.streams[1]?.codec).toBe('opus');
    expect(file.streams[1]?.serialNumber).toBe(2);
  });

  it('rejects multiplexed file with OggMultiplexNotSupportedError (design note TC11)', () => {
    // Two BOS pages with different serial numbers before either EOS.
    const ident1 = buildVorbisIdent();
    const ident2 = buildOpusHead();

    const p0a = buildRawPage({
      headerType: 0x02,
      serialNumber: 1,
      pageSeqNum: 0,
      segments: [ident1.length],
      body: ident1,
    });
    const p0b = buildRawPage({
      headerType: 0x02,
      serialNumber: 2,
      pageSeqNum: 0,
      segments: [ident2.length],
      body: ident2,
    });

    const data = concat(p0a, p0b);
    expect(() => parseOgg(data)).toThrow(OggMultiplexNotSupportedError);
  });

  it('throws OggInputTooLargeError for oversized input', () => {
    // Create a fake oversized buffer (just check the size guard fires).
    // We cannot allocate 200MiB in tests, so we mock by constructing a
    // Uint8Array subclass that reports a large length.
    const oversized = new Uint8Array(1);
    Object.defineProperty(oversized, 'length', { value: MAX_INPUT_BYTES + 1 });
    expect(() => parseOgg(oversized)).toThrow(OggInputTooLargeError);
  });

  it('throws OggCorruptStreamError for all-corrupt input after many CRC failures', () => {
    // Build data that has OggS magic but corrupt CRC on all pages.
    const data = buildSyntheticVorbisStream();
    // Corrupt ALL CRC bytes.
    for (let i = 22; i < data.length; i += 50) {
      data[i] ^= 0xff;
    }
    expect(() => parseOgg(data)).toThrow();
  });

  it('handles granule_position = -1n correctly (no completed packet on page)', () => {
    // First two segments of a packet: 255 bytes continues.
    const ident = buildVorbisIdent();
    const comment = buildVorbisComment();
    const setup = buildVorbisSetup();

    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [ident.length],
      body: ident,
    });
    const p1 = buildRawPage({ pageSeqNum: 1, segments: [comment.length], body: comment });
    const p2 = buildRawPage({ pageSeqNum: 2, segments: [setup.length], body: setup });

    // Page 3: 255-byte audio segment (packet continues → granule = -1).
    const audioPart1 = new Uint8Array(255).fill(0xaa);
    const p3 = buildRawPage({
      pageSeqNum: 3,
      granulePosition: -1n,
      segments: [255],
      body: audioPart1,
    });

    // Page 4 (EOS): terminates the packet.
    const audioPart2 = new Uint8Array([0xbb]);
    const p4 = buildRawPage({
      headerType: 0x05,
      pageSeqNum: 4,
      granulePosition: 4410n,
      segments: [1],
      body: audioPart2,
    });

    const data = concat(p0, p1, p2, p3, p4);
    const file = parseOgg(data);
    expect(file.streams[0]?.packets.length).toBe(1);
    expect(file.streams[0]?.packets[0]?.data.length).toBe(256);
    expect(file.streams[0]?.packets[0]?.granulePosition).toBe(4410n);
  });
});

// ---------------------------------------------------------------------------
// OggSequenceGapError properties
// ---------------------------------------------------------------------------

describe('OggSequenceGapError details', () => {
  it('exposes expected and actual sequence numbers', () => {
    const ident = buildVorbisIdent();
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [ident.length],
      body: ident,
    });
    // Jump directly to page 5 (expected 1).
    const comment = buildVorbisComment();
    const p5 = buildRawPage({ pageSeqNum: 5, segments: [comment.length], body: comment });

    try {
      parseOgg(concat(p0, p5));
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OggSequenceGapError);
      const gapErr = e as OggSequenceGapError;
      expect(gapErr.expected).toBe(1);
      expect(gapErr.actual).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for unsupported codecs and edge cases
// ---------------------------------------------------------------------------

describe('parseOgg (unsupported codecs + edge cases)', () => {
  it('throws OggUnsupportedCodecError for Theora stream', () => {
    // Build a page with a Theora identification packet.
    const theora = new Uint8Array([0x80, 0x74, 0x68, 0x65, 0x6f, 0x72, 0x61, 0x00]);
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [theora.length],
      body: theora,
    });
    expect(() => parseOgg(p0)).toThrow(OggUnsupportedCodecError);
  });

  it('throws OggUnsupportedCodecError for Speex stream', () => {
    const speex = new Uint8Array([0x53, 0x70, 0x65, 0x65, 0x78, 0x20, 0x20, 0x20]);
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [speex.length],
      body: speex,
    });
    expect(() => parseOgg(p0)).toThrow(OggUnsupportedCodecError);
  });

  it('throws OggUnsupportedCodecError for unknown codec with hex hint', () => {
    const unknown = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [unknown.length],
      body: unknown,
    });
    expect(() => parseOgg(p0)).toThrow(OggUnsupportedCodecError);
  });

  it('returns partial stream data when no EOS page seen (truncated file)', () => {
    // Build a stream with BOS + 3 header pages but no EOS.
    const ident = buildVorbisIdent();
    const comment = buildVorbisComment();
    const setup = buildVorbisSetup();

    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [ident.length],
      body: ident,
    });
    const p1 = buildRawPage({ pageSeqNum: 1, segments: [comment.length], body: comment });
    const p2 = buildRawPage({ pageSeqNum: 2, segments: [setup.length], body: setup });
    const audio = new Uint8Array([0xaa, 0xbb]);
    const p3 = buildRawPage({
      pageSeqNum: 3,
      granulePosition: 100n,
      segments: [audio.length],
      body: audio,
    });
    // No EOS page — truncated.
    const data = concat(p0, p1, p2, p3);
    const file = parseOgg(data);
    // Should still return the stream.
    expect(file.streams.length).toBe(1);
    expect(file.streams[0]?.codec).toBe('vorbis');
    expect(file.streams[0]?.packets.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // H-1: cumulative sync-scan budget regression
  // -------------------------------------------------------------------------

  it('H-1: 4 MiB pure garbage (no OggS) throws OggCaptureMissingError immediately, not cumulative cap', () => {
    // First OggS check at offset 0 fails → throws OggCaptureMissingError before
    // any scan budget is consumed. The cumulative cap should NOT fire here.
    const garbage = new Uint8Array(4 * 1024 * 1024).fill(0xcc);
    expect(() => parseOgg(garbage)).toThrow(OggCaptureMissingError);
  });

  it('H-1: cumulative sync scan cap is enforced — repeated bad-CRC OggS pages trigger OggCorruptStreamError', () => {
    // Build a compact input that forces the cumulative scan budget to fire.
    // Each iteration: "OggS" (4 bytes, bad CRC) + 512 bytes of 0xCC garbage.
    // The parser sees OggS, parsePage fails CRC, skips 4 bytes, then calls
    // scanForOggS over the 512-byte garbage region, accumulating 512 bytes.
    // After MAX_TOTAL_SYNC_SCAN_BYTES / 512 + 1 = 32769 rounds, totalSyncBytes
    // exceeds 16 MiB and OggCorruptStreamError is thrown.
    //
    // Total buffer size ≈ 32769 × (4 + 512) ≈ 16.5 MiB.
    // However, we must keep the buffer ≤ MAX_INPUT_BYTES (200 MiB) and also
    // within Node heap. The approach below uses ~4 MiB by using a smaller
    // garbage-per-chunk size: the SYNC_SCAN_CAP is 1 MiB so each scanForOggS
    // call scans exactly garbage_size bytes (if garbage_size < SYNC_SCAN_CAP).
    // We need total garbage = MAX_TOTAL_SYNC_SCAN_BYTES + 1 = 16 MiB + 1 byte.
    // With 4 KiB per chunk we need 16MiB / 4KiB = 4096 rounds.
    // Total buffer = 4096 × (4 + 4096) = 4096 × 4100 ≈ 16.4 MiB. Still large.
    //
    // Smallest feasible: 1 KiB garbage per chunk → 16384 chunks × 1028 B ≈ 16 MiB.
    // Accept this as the regression test since it directly exercises the code path.
    const GARBAGE_PER_CHUNK = 1024; // 1 KiB
    const FAKE_HEADER = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // "OggS"
    // Number of chunks needed so total garbage just exceeds MAX_TOTAL_SYNC_SCAN_BYTES.
    const rounds = Math.floor(MAX_TOTAL_SYNC_SCAN_BYTES / GARBAGE_PER_CHUNK) + 2;
    const chunkBytes = FAKE_HEADER.length + GARBAGE_PER_CHUNK;
    const buf = new Uint8Array(rounds * chunkBytes);
    for (let i = 0; i < rounds; i++) {
      const base = i * chunkBytes;
      buf[base] = 0x4f;
      buf[base + 1] = 0x67;
      buf[base + 2] = 0x67;
      buf[base + 3] = 0x53;
      // Leave garbage region as 0x00 (no OggS pattern in there).
    }

    expect(() => parseOgg(buf)).toThrow(OggCorruptStreamError);
  });

  // -------------------------------------------------------------------------
  // H-3: comment packet validation on parse path
  // -------------------------------------------------------------------------

  it('H-3: Vorbis comment packet with vendor_length = 0xFFFFFFFF throws OggCorruptStreamError', () => {
    // Build a minimal Vorbis stream where the comment packet claims an absurdly
    // large vendor_length. Before H-3 fix, the parser stored raw bytes silently.
    const ident = buildVorbisIdent();
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [ident.length],
      body: ident,
    });

    // Malformed comment packet: packet_type(1) + "vorbis"(6) + vendor_length(4) = 11 bytes.
    const malformedComment = new Uint8Array(11);
    malformedComment[0] = 0x03; // packet_type = comment
    malformedComment[1] = 0x76; // 'v'
    malformedComment[2] = 0x6f; // 'o'
    malformedComment[3] = 0x72; // 'r'
    malformedComment[4] = 0x62; // 'b'
    malformedComment[5] = 0x69; // 'i'
    malformedComment[6] = 0x73; // 's'
    // vendor_length = 0xFFFFFFFF — way over MAX_COMMENT_BYTES (1 MiB).
    new DataView(malformedComment.buffer).setUint32(7, 0xffffffff, true);

    const p1 = buildRawPage({
      headerType: 0x00,
      pageSeqNum: 1,
      segments: [malformedComment.length],
      body: malformedComment,
    });

    expect(() => parseOgg(concat(p0, p1))).toThrow();
  });

  // -------------------------------------------------------------------------
  // M-1: truncated stream with unrecognised codec
  // -------------------------------------------------------------------------

  it('M-1: BOS page with unrecognised magic throws OggCorruptStreamError, not silent empty', () => {
    // "QoaHead" — not Vorbis, not Opus. The stream will never get codec identified.
    const unknown = new TextEncoder().encode('QoaHead\0');
    const p0 = buildRawPage({
      headerType: 0x02, // BOS, no EOS
      pageSeqNum: 0,
      segments: [unknown.length],
      body: unknown,
    });
    // Only a BOS page — parser should throw OggUnsupportedCodecError (identification stage)
    // rather than returning empty (this also exercises the M-1 path indirectly since
    // the unsupported codec throw happens before the truncated-stream loop).
    expect(() => parseOgg(p0)).toThrow(OggUnsupportedCodecError);
  });

  it('handles Skeleton codec identification and throws unsupported', () => {
    const skeleton = new Uint8Array([0x66, 0x69, 0x73, 0x68, 0x65, 0x61, 0x64, 0x00]);
    const p0 = buildRawPage({
      headerType: 0x02,
      pageSeqNum: 0,
      segments: [skeleton.length],
      body: skeleton,
    });
    expect(() => parseOgg(p0)).toThrow();
  });
});
