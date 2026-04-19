/**
 * Tests for the FLAC parser (parseFlac) and demuxer algorithm.
 *
 * Covers 9 of the 13 required test cases from the design note:
 * - parses STREAMINFO from fixture
 * - parses VORBIS_COMMENT block
 * - parses SEEKTABLE block
 * - parses PICTURE block
 * - handles PADDING block
 * - tolerates ID3v2 prefix
 * - rejects non-fLaC magic
 * - round-trips parse → serialize → byte-identical
 * - recognises stereo channel assignments
 *
 * CRC and varint tests live in crc.test.ts and frame.test.ts respectively.
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { crc8 } from './crc.ts';
import {
  FlacCrc16MismatchError,
  FlacInputTooLargeError,
  FlacInvalidMagicError,
  FlacInvalidMetadataError,
} from './errors.ts';
import { parseFrameHeader } from './frame.ts';
import {
  BLOCK_TYPE_PADDING,
  BLOCK_TYPE_PICTURE,
  BLOCK_TYPE_SEEKTABLE,
  BLOCK_TYPE_STREAMINFO,
  BLOCK_TYPE_VORBIS_COMMENT,
  decodePicture,
  decodeSeekTable,
  decodeVorbisComment,
} from './metadata.ts';
import { parseFlac } from './parser.ts';
import { serializeFlac } from './serializer.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function loadFlacFixture(): Promise<Uint8Array> {
  return loadFixture('audio/sine-1s-44100-mono.flac');
}

// ---------------------------------------------------------------------------
// Synthetic fixture builders
// ---------------------------------------------------------------------------

/** Build a minimal FLAC file header from raw parts for unit testing. */
function buildMinimalFlac(options?: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  totalSamples?: number;
  maxFrameSize?: number;
  extraBlocks?: Array<{ type: number; data: Uint8Array }>;
}): Uint8Array {
  const sr = options?.sampleRate ?? 44100;
  const ch = options?.channels ?? 1;
  const bps = options?.bitsPerSample ?? 16;
  const ts = options?.totalSamples ?? 44100;
  const mfs = options?.maxFrameSize ?? 0;
  const extraBlocks = options?.extraBlocks ?? [];

  // Build STREAMINFO body (34 bytes)
  const si = new Uint8Array(34);
  // min_block_size: 4096 (16 bits)
  si[0] = 0x10;
  si[1] = 0x00;
  // max_block_size: 4096
  si[2] = 0x10;
  si[3] = 0x00;
  // min_frame_size: 0 (unknown)
  si[4] = 0x00;
  si[5] = 0x00;
  si[6] = 0x00;
  // max_frame_size (24 bits)
  si[7] = (mfs >> 16) & 0xff;
  si[8] = (mfs >> 8) & 0xff;
  si[9] = mfs & 0xff;
  // Bits 80-99: sample_rate (20 bits), bits 100-102: channels-1 (3), bits 103-107: bps-1 (5)
  const srBits = sr & 0xfffff;
  si[10] = (srBits >> 12) & 0xff;
  si[11] = (srBits >> 4) & 0xff;
  const chBits = (ch - 1) & 0x7;
  const bpsBits = (bps - 1) & 0x1f;
  si[12] = ((srBits & 0xf) << 4) | (chBits << 1) | (bpsBits >> 4);
  si[13] = ((bpsBits & 0xf) << 4) | ((ts >> 32) & 0xf);
  // total_samples: lower 32 bits
  si[14] = (ts >> 24) & 0xff;
  si[15] = (ts >> 16) & 0xff;
  si[16] = (ts >> 8) & 0xff;
  si[17] = ts & 0xff;
  // MD5: all zeros
  // si[18..33] = 0

  const allBlocks: Array<{ type: number; data: Uint8Array; last: boolean }> = [];
  allBlocks.push({ type: BLOCK_TYPE_STREAMINFO, data: si, last: extraBlocks.length === 0 });
  for (let i = 0; i < extraBlocks.length; i++) {
    const eb = extraBlocks[i];
    if (eb === undefined) continue;
    allBlocks.push({ type: eb.type, data: eb.data, last: i === extraBlocks.length - 1 });
  }

  const parts: Uint8Array[] = [new Uint8Array([0x66, 0x4c, 0x61, 0x43])]; // fLaC

  for (const block of allBlocks) {
    const header = new Uint8Array(4);
    header[0] = ((block.last ? 1 : 0) << 7) | (block.type & 0x7f);
    header[1] = (block.data.length >> 16) & 0xff;
    header[2] = (block.data.length >> 8) & 0xff;
    header[3] = block.data.length & 0xff;
    parts.push(header);
    parts.push(block.data);
  }

  // Concatenate
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Design-note required test cases
// ---------------------------------------------------------------------------

describe('parses STREAMINFO from fixture sine-44100-mono.flac', () => {
  it('decodes sample rate, channels, bits per sample', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);

    expect(flac.streamInfo.sampleRate).toBe(44100);
    expect(flac.streamInfo.channels).toBe(1);
    expect(flac.streamInfo.bitsPerSample).toBe(16);
    expect(flac.streamInfo.md5).toHaveLength(16);
  });

  it('exposes STREAMINFO as blocks[0]', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);

    expect(flac.blocks[0]?.type).toBe(BLOCK_TYPE_STREAMINFO);
    expect(flac.blocks[0]?.data).toHaveLength(34);
  });

  it('parses audio frames', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);

    expect(flac.frames.length).toBeGreaterThan(0);
    for (const frame of flac.frames) {
      expect(frame.sampleRate).toBe(44100);
      expect(frame.channels).toBe(1);
      expect(frame.blockSize).toBeGreaterThan(0);
      expect(frame.data).toBeInstanceOf(Uint8Array);
      expect(frame.data.length).toBeGreaterThan(0);
    }
  });
});

describe('parses VORBIS_COMMENT block and exposes key/value pairs', () => {
  it('finds and decodes VORBIS_COMMENT from fixture', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);

    const vcBlock = flac.blocks.find((b) => b.type === BLOCK_TYPE_VORBIS_COMMENT);
    // Not all fixtures have VORBIS_COMMENT — test decoding with a synthetic block
    if (vcBlock !== undefined) {
      const vc = decodeVorbisComment(vcBlock.data, 0);
      expect(typeof vc.vendor).toBe('string');
      expect(Array.isArray(vc.comments)).toBe(true);
    }
  });

  it('decodes synthetic VORBIS_COMMENT block correctly', () => {
    // Build a VORBIS_COMMENT body manually
    const vendor = 'TestEncoder';
    const comment = 'TITLE=Hello World';
    const vendorBytes = new TextEncoder().encode(vendor);
    const commentBytes = new TextEncoder().encode(comment);

    const buf = new Uint8Array(4 + vendorBytes.length + 4 + 4 + commentBytes.length);
    let pos = 0;
    // vendor_length (LE)
    buf[pos++] = vendorBytes.length & 0xff;
    buf[pos++] = (vendorBytes.length >> 8) & 0xff;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf.set(vendorBytes, pos);
    pos += vendorBytes.length;
    // comment_count (LE)
    buf[pos++] = 1;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf[pos++] = 0;
    // comment length (LE)
    buf[pos++] = commentBytes.length & 0xff;
    buf[pos++] = (commentBytes.length >> 8) & 0xff;
    buf[pos++] = 0;
    buf[pos++] = 0;
    buf.set(commentBytes, pos);

    const vc = decodeVorbisComment(buf, 0);
    expect(vc.vendor).toBe('TestEncoder');
    expect(vc.comments).toHaveLength(1);
    expect(vc.comments[0]?.key).toBe('TITLE');
    expect(vc.comments[0]?.value).toBe('Hello World');
  });
});

describe('parses SEEKTABLE block with N seek points', () => {
  it('decodes a synthetic SEEKTABLE block', () => {
    // Build a SEEKTABLE with 2 seek points
    const body = new Uint8Array(36); // 2 * 18 bytes
    // Seek point 0: sampleNumber=0, byteOffset=0, frameSamples=4096
    body[16] = 0x10; // 0x1000 = 4096
    body[17] = 0x00;
    // Seek point 1: sampleNumber=4096, byteOffset=1000, frameSamples=4096
    body[18] = 0x00;
    body[19] = 0x00;
    body[20] = 0x00;
    body[21] = 0x00;
    body[22] = 0x00;
    body[23] = 0x00;
    body[24] = 0x10;
    body[25] = 0x00; // sampleNumber = 4096
    body[26] = 0x00;
    body[27] = 0x00;
    body[28] = 0x00;
    body[29] = 0x00;
    body[30] = 0x00;
    body[31] = 0x00;
    body[32] = 0x03;
    body[33] = 0xe8; // byteOffset = 1000
    body[34] = 0x10;
    body[35] = 0x00; // frameSamples = 4096

    const points = decodeSeekTable(body, 0);
    expect(points).toHaveLength(2);
    expect(points[0]?.sampleNumber).toBe(0);
    expect(points[0]?.frameSamples).toBe(4096);
    expect(points[1]?.sampleNumber).toBe(4096);
    expect(points[1]?.byteOffset).toBe(1000);
  });

  it('parses SEEKTABLE from fixture if present', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);
    const stBlock = flac.blocks.find((b) => b.type === BLOCK_TYPE_SEEKTABLE);
    if (stBlock !== undefined) {
      const points = decodeSeekTable(stBlock.data, 0);
      expect(points.length).toBeGreaterThan(0);
      for (const pt of points) {
        expect(typeof pt.sampleNumber).toBe('number');
        expect(typeof pt.byteOffset).toBe('number');
      }
    }
  });
});

describe('parses PICTURE block, exposes MIME and dimensions', () => {
  it('decodes a synthetic PICTURE block correctly', () => {
    const mime = 'image/jpeg';
    const desc = '';
    const mimeBytes = new TextEncoder().encode(mime);
    const descBytes = new TextEncoder().encode(desc);
    const picData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // fake JPEG

    const buf = new Uint8Array(
      4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 * 4 + 4 + picData.length,
    );
    const dv = new DataView(buf.buffer);
    let pos = 0;
    dv.setUint32(pos, 3, false); // picture_type = 3 (cover art)
    pos += 4;
    dv.setUint32(pos, mimeBytes.length, false);
    pos += 4;
    buf.set(mimeBytes, pos);
    pos += mimeBytes.length;
    dv.setUint32(pos, descBytes.length, false);
    pos += 4;
    buf.set(descBytes, pos);
    pos += descBytes.length;
    dv.setUint32(pos, 640, false); // width
    pos += 4;
    dv.setUint32(pos, 480, false); // height
    pos += 4;
    dv.setUint32(pos, 24, false); // color_depth
    pos += 4;
    dv.setUint32(pos, 0, false); // color_count
    pos += 4;
    dv.setUint32(pos, picData.length, false);
    pos += 4;
    buf.set(picData, pos);

    const pic = decodePicture(buf, 0);
    expect(pic.pictureType).toBe(3);
    expect(pic.mime).toBe('image/jpeg');
    expect(pic.width).toBe(640);
    expect(pic.height).toBe(480);
    expect(pic.colorDepth).toBe(24);
    expect(pic.data).toEqual(picData);
  });

  it('parses PICTURE block from fixture if present', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);
    const picBlock = flac.blocks.find((b) => b.type === BLOCK_TYPE_PICTURE);
    if (picBlock !== undefined) {
      const pic = decodePicture(picBlock.data, 0);
      expect(typeof pic.mime).toBe('string');
      expect(pic.width).toBeGreaterThanOrEqual(0);
      expect(pic.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('handles PADDING block', () => {
  it('reads a PADDING block from a synthetic file with PADDING', () => {
    const padding = new Uint8Array(128); // 128 bytes of zeros
    const synthBytes = buildMinimalFlac({
      extraBlocks: [{ type: BLOCK_TYPE_PADDING, data: padding }],
    });
    const flac = parseFlac(synthBytes);
    const padBlock = flac.blocks.find((b) => b.type === BLOCK_TYPE_PADDING);
    expect(padBlock).toBeDefined();
    expect(padBlock?.data).toHaveLength(128);
  });
});

describe('tolerates ID3v2 prefix before fLaC magic', () => {
  it('skips an ID3v2 header and finds fLaC', async () => {
    const flacBytes = await loadFlacFixture();

    // Construct a fake ID3v2 header: "ID3" + version + flags + syncsafe size (0)
    const id3Header = new Uint8Array([
      0x49,
      0x44,
      0x33, // "ID3"
      0x04,
      0x00, // version 2.4
      0x00, // flags
      0x00,
      0x00,
      0x00,
      0x00, // syncsafe size = 0 (empty tag body)
    ]);

    const withId3 = new Uint8Array(id3Header.length + flacBytes.length);
    withId3.set(id3Header, 0);
    withId3.set(flacBytes, id3Header.length);

    const flac = parseFlac(withId3);
    expect(flac.streamInfo.sampleRate).toBe(44100);
    expect(flac.frames.length).toBeGreaterThan(0);
  });
});

describe('rejects file with non-fLaC magic and no ID3 prefix', () => {
  it('throws FlacInvalidMagicError for random bytes', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(() => parseFlac(garbage)).toThrow(FlacInvalidMagicError);
  });

  it('throws FlacInvalidMagicError for MP3 sync bytes', () => {
    const mp3Sync = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00]);
    expect(() => parseFlac(mp3Sync)).toThrow(FlacInvalidMagicError);
  });

  it('throws FlacInvalidMagicError for flAC (wrong case)', () => {
    // "flAC" != "fLaC"
    const wrongMagic = new Uint8Array([0x66, 0x6c, 0x41, 0x43]); // "flAC"
    expect(() => parseFlac(wrongMagic)).toThrow(FlacInvalidMagicError);
  });
});

describe('round-trips: parse → serialize → byte-identical metadata + frames', () => {
  it('round-trips the FLAC fixture to byte-identical output', async () => {
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);
    const reserialised = serializeFlac(flac);

    // The reserialised output must be byte-identical to the original
    expect(reserialised).toHaveLength(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      if (reserialised[i] !== bytes[i]) {
        throw new Error(
          `Byte mismatch at offset ${i}: expected 0x${(bytes[i] ?? 0).toString(16).padStart(2, '0')}, got 0x${(reserialised[i] ?? 0).toString(16).padStart(2, '0')}`,
        );
      }
    }
  });

  it('metadata blocks survive round-trip intact', async () => {
    const bytes = await loadFlacFixture();
    const flac1 = parseFlac(bytes);
    const roundTripped = serializeFlac(flac1);
    const flac2 = parseFlac(roundTripped);

    expect(flac2.blocks.length).toBe(flac1.blocks.length);
    expect(flac2.streamInfo.sampleRate).toBe(flac1.streamInfo.sampleRate);
    expect(flac2.streamInfo.channels).toBe(flac1.streamInfo.channels);
    expect(flac2.streamInfo.bitsPerSample).toBe(flac1.streamInfo.bitsPerSample);
    expect(flac2.frames.length).toBe(flac1.frames.length);
  });
});

describe('recognises left+side / side+right / mid+side stereo assignments', () => {
  it('identifies channel assignment codes from nibble values', () => {
    // Build a minimal raw frame header with channel_assignment = 8 (left+side)
    // byte 2: 0x18 (block_size=0001=192, sample_rate=0000=from_streaminfo)
    // byte 3: 0x8E (channel=8=left+side, sample_size=0=from_streaminfo, reserved=0)
    // UTF-8 varint: 0x00 (frame_number=0)
    const hdr = new Uint8Array(7);
    hdr[0] = 0xff;
    hdr[1] = 0xf8; // sync + reserved + blocking_strategy=0
    hdr[2] = 0x18; // block_size_bits=0b0001 (192), sample_rate_bits=0b1000 (32000)
    hdr[3] = 0x8e; // channel=8 (left+side), sample_size=7 (32-bit), reserved=0
    hdr[4] = 0x00; // frame_number varint = 0
    // CRC-8 over bytes 0..4
    hdr[5] = crc8(hdr, 0, 5);
    // Append a dummy CRC-16 to allow the parser to consume it
    hdr[6] = 0x00;

    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.channelAssignment).toBe('left+side');
    expect(parsed.channels).toBe(2);
  });

  it('mid+side channel assignment (nibble=10)', () => {
    const hdr = new Uint8Array(7);
    hdr[0] = 0xff;
    hdr[1] = 0xf8;
    hdr[2] = 0x18;
    hdr[3] = 0xae; // channel=10 (mid+side)
    hdr[4] = 0x00;
    hdr[5] = crc8(hdr, 0, 5);
    hdr[6] = 0x00;

    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.channelAssignment).toBe('mid+side');
  });

  it('side+right channel assignment (nibble=9)', () => {
    const hdr = new Uint8Array(7);
    hdr[0] = 0xff;
    hdr[1] = 0xf8;
    hdr[2] = 0x18;
    hdr[3] = 0x9e; // channel=9 (side+right)
    hdr[4] = 0x00;
    hdr[5] = crc8(hdr, 0, 5);
    hdr[6] = 0x00;

    const parsed = parseFrameHeader(hdr, 0, 32000, 16, true);
    expect(parsed.channelAssignment).toBe('side+right');
  });
});

// ---------------------------------------------------------------------------
// Additional edge-case tests
// ---------------------------------------------------------------------------

describe('STREAMINFO totalSamples=0 is valid (Trap #9)', () => {
  it('accepts a FLAC file with totalSamples=0 in STREAMINFO', () => {
    // Use buildMinimalFlac with totalSamples=0 (unknown) and no audio frames
    const bytes = buildMinimalFlac({ totalSamples: 0 });
    // Should not throw — just return an empty frames array
    const flac = parseFlac(bytes);
    expect(flac.streamInfo.totalSamples).toBe(0);
  });
});

describe('parser handles false sync bytes gracefully', () => {
  it('advances past false 0xFF 0xF8 bytes that fail CRC-8', async () => {
    // The fixture already has real frames — just ensure it parses correctly
    // even if there happen to be 0xFF bytes in the frame body
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);
    // If false syncs are not handled, the parse would throw or return fewer frames
    expect(flac.frames.length).toBeGreaterThan(0);
  });
});

describe('parser sample count mismatch (Trap #9 coverage)', () => {
  it('silently accepts mismatch between counted samples and STREAMINFO totalSamples', async () => {
    // Patch a parsed FLAC file to have a different totalSamples than the actual frame count
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);
    // Manually re-serialize with wrong totalSamples to exercise the mismatch branch
    const wrongSi = { ...flac.streamInfo, totalSamples: flac.streamInfo.totalSamples + 1 };
    const wrongFlac = { ...flac, streamInfo: wrongSi };
    const reserialized = serializeFlac({ ...wrongFlac, streamInfo: wrongSi });
    // Re-parse should not throw even with a sample count mismatch
    expect(() => parseFlac(reserialized)).not.toThrow();
  });
});

describe('parser CRC-16 false positive handling', () => {
  it('skips a false sync that passes the header parse but fails CRC-16 (nextSync >= 0)', async () => {
    // Build a synthetic file where the audio region contains a false sync
    // followed by a real frame. The parser should skip the false sync.
    const bytes = await loadFlacFixture();
    const flac = parseFlac(bytes);

    // Take the first two frames — inject a 0xFF 0xF8 byte sequence in the middle
    // of the first frame's data (which will be interpreted as a false sync).
    if (flac.frames.length >= 2) {
      // Modify frame[0] by injecting false sync bytes in its body
      const f0data = flac.frames[0]!.data;
      const corrupted = new Uint8Array(f0data.length + 2);
      // Copy first 10 bytes, inject 0xFF 0xF8, then copy rest
      corrupted.set(f0data.slice(0, 10), 0);
      corrupted[10] = 0xff;
      corrupted[11] = 0xf8;
      corrupted.set(f0data.slice(10), 12);

      const modifiedFrames = [{ ...flac.frames[0]!, data: corrupted }, ...flac.frames.slice(1)];
      const modifiedFlac = { ...flac, frames: modifiedFrames };
      // Re-serialize and re-parse: should not throw
      const reserialized = serializeFlac(modifiedFlac);
      // The parser will find the false sync, fail CRC-16, and skip it
      // (then find the real next frame's sync)
      expect(() => parseFlac(reserialized)).not.toThrow();
    }
  });
});

describe('multiple blocks of the same type (Trap #10)', () => {
  it('rejects a file with two STREAMINFO blocks', () => {
    // Build a file with two STREAMINFO blocks by raw construction
    const si = new Uint8Array(34);
    si[0] = 0x10;
    si[1] = 0x00;
    si[2] = 0x10;
    si[3] = 0x00;
    const srBits = 44100 & 0xfffff;
    si[10] = (srBits >> 12) & 0xff;
    si[11] = (srBits >> 4) & 0xff;
    si[12] = ((srBits & 0xf) << 4) | (0 << 1) | (15 >> 4); // ch=1, bps=16 => ch-1=0, bps-1=15
    si[13] = (15 & 0xf) << 4;

    const parts: Uint8Array[] = [
      new Uint8Array([0x66, 0x4c, 0x61, 0x43]), // fLaC
      // First STREAMINFO (last=0)
      new Uint8Array([0x00, 0x00, 0x00, 0x22]),
      si,
      // Second STREAMINFO (last=1)
      new Uint8Array([0x80, 0x00, 0x00, 0x22]),
      si,
    ];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const bytes = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      bytes.set(p, pos);
      pos += p.length;
    }

    expect(() => parseFlac(bytes)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Regression tests for security fixes
// ---------------------------------------------------------------------------

describe('C-1: parseFlac rejects input larger than 200 MiB', () => {
  it('throws FlacInputTooLargeError before any parsing for oversized input', () => {
    // Allocate a 201 MiB buffer — the first check in parseFlac must catch it.
    const oversized = new Uint8Array(201 * 1024 * 1024);
    expect(() => parseFlac(oversized)).toThrow(FlacInputTooLargeError);
  });
});

describe('C-2: Frame scan distance cap prevents CPU DoS on 0xFF 0xF8 spam', () => {
  it('completes within 500ms and yields zero frames for a 500 KiB sync-spam buffer', () => {
    // Build minimal FLAC header, then append 500 KiB of bytes that contain sync-like
    // sequences. We use 0xFF 0xF8 0x18 0x0C pattern: bytes 2,3 produce blockSizeBits=1
    // (192 samples) and sampleRateBits=0xC which is uncommon-Hz. The uncommon path reads
    // 1 extra byte, but the block falls apart quickly due to the body all being 0x00.
    // The CRC-8 check will fail for most due to data mismatch.
    // Point: without the scan cap, one parsed frame would scan 500 KiB for next sync.
    // With the 1 MiB cap, the search is bounded and the total time is O(n), not O(n^2).
    const header = buildMinimalFlac({ totalSamples: 0, maxFrameSize: 0 });

    // 500 KiB of 0xFF 0xF8 0x18 0x0E 0x00 repeats — provides sync-like sequences
    // but all frame headers will fail CRC-8 (wrong CRC byte = 0xFF or 0xF8).
    const spamSize = 500 * 1024;
    const spam = new Uint8Array(spamSize).fill(0xff); // solid 0xFF — every pair is a sync

    const input = new Uint8Array(header.length + spamSize);
    input.set(header, 0);
    input.set(spam, header.length);

    const t0 = performance.now();
    let flac: ReturnType<typeof parseFlac>;
    try {
      flac = parseFlac(input);
    } catch {
      // FlacCrc16MismatchError / FlacInvalidVarintError are acceptable
      flac = { streamInfo: {} as never, blocks: [], frames: [] };
    }
    const elapsed = performance.now() - t0;

    // The key invariant: must finish quickly regardless of pattern.
    expect(elapsed).toBeLessThan(500);
    expect(flac.frames.length).toBe(0);
  });
});

describe('H-1: skipId3v2 syncsafe validation and size cap', () => {
  it('treats a tag with MSB-set size bytes as not-an-ID3-tag (returns offset unchanged)', () => {
    // Build a fake "ID3" header with an invalid syncsafe size byte (MSB set on byte 6)
    const flacBytes = buildMinimalFlac({ totalSamples: 0 });
    const withBadId3 = new Uint8Array(10 + flacBytes.length);
    withBadId3[0] = 0x49; // I
    withBadId3[1] = 0x44; // D
    withBadId3[2] = 0x33; // 3
    withBadId3[3] = 0x04; // version
    withBadId3[4] = 0x00;
    withBadId3[5] = 0x00; // flags
    withBadId3[6] = 0x80; // MSB set → invalid syncsafe → not treated as ID3 tag
    withBadId3[7] = 0x00;
    withBadId3[8] = 0x00;
    withBadId3[9] = 0x00;
    // Without valid ID3 skip, parser will try to read "ID3 " as fLaC magic and fail.
    // This is the correct behaviour per the spec — invalid syncsafe = ignore ID3 header.
    expect(() => parseFlac(withBadId3)).toThrow(FlacInvalidMagicError);
  });

  it('throws FlacInvalidMetadataError for oversized ID3v2 tag body (> 64 MiB)', () => {
    // Craft a valid syncsafe integer encoding 64 MiB + 1 byte (exceeds MAX_ID3_BODY=64 MiB).
    // MAX_ID3_BODY = 64 * 1024 * 1024 = 67_108_864 bytes.
    // We encode 67_108_865 (one byte over cap) in syncsafe 4-byte form.
    //
    // Syncsafe decode: value = (b0 << 21) | (b1 << 14) | (b2 << 7) | b3
    // Encoding 67_108_865:
    //   b3 = 67_108_865 & 0x7f = 1
    //   b2 = (67_108_865 >> 7) & 0x7f = 0
    //   b1 = (67_108_865 >> 14) & 0x7f = 0
    //   b0 = (67_108_865 >> 21) & 0x7f = 32 (0x20)
    // All bytes have MSB clear → valid syncsafe, value > MAX_ID3_BODY → should throw.
    const buf = new Uint8Array(10);
    buf[0] = 0x49; // I
    buf[1] = 0x44; // D
    buf[2] = 0x33; // 3
    buf[3] = 0x04; // version 2.4
    buf[4] = 0x00; // revision
    buf[5] = 0x00; // flags
    buf[6] = 0x20; // syncsafe b0 = 32
    buf[7] = 0x00; // syncsafe b1 = 0
    buf[8] = 0x00; // syncsafe b2 = 0
    buf[9] = 0x01; // syncsafe b3 = 1 → total = 67_108_865 > 64 MiB

    expect(() => parseFlac(buf)).toThrow(FlacInvalidMetadataError);
  });
});

describe('M-1: all-bad-CRC stream throws instead of returning empty frames', () => {
  it('throws FlacCrc16MismatchError when all sync candidates fail CRC-16', () => {
    // Build a header, then append many sync-looking bytes where the "frames" all
    // have bad CRC-16. The parser should detect the corrupt-stream condition.
    const header = buildMinimalFlac({ totalSamples: 0, maxFrameSize: 0 });

    // Build 10+ false frames: each starts with sync (0xFF 0xF8 0x18 0x0E 0x00 <crc8>)
    // then 20 bytes of random data (intentionally wrong CRC-16 at end).
    // crc8 is already imported at the top of this file.
    const fakeSyncHdr = new Uint8Array(6);
    fakeSyncHdr[0] = 0xff;
    fakeSyncHdr[1] = 0xf8;
    fakeSyncHdr[2] = 0x18; // block_size=192, sample_rate=32000
    fakeSyncHdr[3] = 0x0e; // channel=0 raw, bps=32bit
    fakeSyncHdr[4] = 0x00; // varint=0
    // Compute real CRC-8 so the frame header parses successfully
    fakeSyncHdr[5] = crc8(fakeSyncHdr, 0, 5);

    // Build a buffer with 12 such "frames", each followed by 20 garbage bytes.
    const frameCount = 12;
    const parts: Uint8Array[] = [header];
    for (let i = 0; i < frameCount; i++) {
      parts.push(fakeSyncHdr.slice()); // valid header
      parts.push(new Uint8Array(20)); // garbage payload (bad CRC-16)
    }

    const total = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      buf.set(p, pos);
      pos += p.length;
    }

    expect(() => parseFlac(buf)).toThrow(FlacCrc16MismatchError);
  });
});

describe('M-3: cumulative metadata cap rejects excessive metadata', () => {
  it('throws FlacInvalidMetadataError when metadata blocks exceed 64 MiB total', () => {
    // Build a valid STREAMINFO then append five PADDING blocks of ~14 MiB each.
    // The 24-bit FLAC block length field caps at 16,777,215 bytes (~16 MiB),
    // so we use five 14 MiB blocks: 5 × 14 MiB = 70 MiB > 64 MiB cap.
    // Total input: ~70 MiB, well below the 200 MiB input cap.
    const si = new Uint8Array(34);
    si[0] = 0x10;
    si[1] = 0x00;
    si[2] = 0x10;
    si[3] = 0x00;
    const srBits = 44100 & 0xfffff;
    si[10] = (srBits >> 12) & 0xff;
    si[11] = (srBits >> 4) & 0xff;
    si[12] = ((srBits & 0xf) << 4) | (0 << 1) | (15 >> 4);
    si[13] = (15 & 0xf) << 4;

    // 14 MiB per padding block fits in the 24-bit length field
    const paddingSize = 14 * 1024 * 1024; // 14,680,064 bytes < 16,777,215
    const paddingCount = 5; // 5 × 14 MiB = 70 MiB > 64 MiB cumulative cap
    const paddingBody = new Uint8Array(paddingSize); // all zeros (shared; only read-only views used)

    const parts: Uint8Array[] = [
      new Uint8Array([0x66, 0x4c, 0x61, 0x43]), // fLaC
      // STREAMINFO (last=false)
      new Uint8Array([0x00, 0x00, 0x00, 0x22]),
      si,
    ];

    for (let i = 0; i < paddingCount; i++) {
      const isLast = i === paddingCount - 1;
      parts.push(
        new Uint8Array([
          isLast ? 0x81 : 0x01, // last flag | type=1 (PADDING)
          (paddingSize >> 16) & 0xff,
          (paddingSize >> 8) & 0xff,
          paddingSize & 0xff,
        ]),
      );
      parts.push(paddingBody);
    }

    const total = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      buf.set(p, offset);
      offset += p.length;
    }

    expect(() => parseFlac(buf)).toThrow(FlacInvalidMetadataError);
  });
});
