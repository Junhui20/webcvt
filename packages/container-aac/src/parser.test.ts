/**
 * Tests for the ADTS parser (parseAdts) — demuxer algorithm.
 *
 * Covers design-note test cases:
 * - parses ADTS frame stream from fixture sine-44100-mono.aac
 * - extracts sample rate 44100 from sampleRateIndex == 4
 * - extracts channel_configuration == 2 for stereo (or 1 for mono)
 * - computes correct frameBytes
 * - validates full header — random 0xFFF bytes in payload do not cause false frame starts
 * - Security caps: 200 MiB input guard, 1 MiB scan cap, truncated frame, corrupt stream
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from './constants.ts';
import {
  AdtsCorruptStreamError,
  AdtsInputTooLargeError,
  AdtsMultipleRawBlocksUnsupportedError,
  AdtsTruncatedFrameError,
} from './errors.ts';
import { parseAdts } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

async function loadAacFixture(): Promise<Uint8Array> {
  return loadFixture('audio/sine-1s-44100-mono.aac');
}

// ---------------------------------------------------------------------------
// Minimal ADTS frame builder (for synthetic tests)
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid single ADTS frame with the given channel config,
 * sampleRateIndex, profile, and a zero payload of payloadLength bytes.
 */
function buildAdtsFrame(options: {
  sfi?: number;
  channelConfig?: number;
  profile?: number;
  payloadLength?: number;
  rawBlocks?: number;
  protectionAbsent?: 0 | 1;
  crc?: number;
}): Uint8Array {
  const sfi = options.sfi ?? 4;
  const channelConfig = options.channelConfig ?? 2;
  const profile = options.profile ?? 1; // LC
  const payloadLength = options.payloadLength ?? 10;
  const rawBlocks = options.rawBlocks ?? 0;
  const pa = options.protectionAbsent ?? 1;
  const hasCrc = pa === 0;
  const headerSize = hasCrc ? 9 : 7;
  const frameBytes = headerSize + payloadLength;

  const frame = new Uint8Array(frameBytes);
  frame[0] = 0xff;
  frame[1] = 0xf0 | (0 << 3) | (0 << 1) | pa; // id=0(MPEG4), layer=0, pa

  const channelHigh = (channelConfig >> 2) & 0x1;
  frame[2] = (profile << 6) | (sfi << 2) | channelHigh;

  const channelLow = channelConfig & 0x3;
  const frameLenHigh = (frameBytes >> 11) & 0x3;
  frame[3] = (channelLow << 6) | frameLenHigh;

  frame[4] = (frameBytes >> 3) & 0xff;
  const frameLenLow = frameBytes & 0x7;
  frame[5] = (frameLenLow << 5) | 0x1f; // bufferFullness high 5 = 0x1f
  frame[6] = (0x3f << 2) | (rawBlocks & 0x3); // bufLow=0x3f (VBR), rawBlocks

  if (hasCrc) {
    const crc = options.crc ?? 0xabcd;
    frame[7] = (crc >> 8) & 0xff;
    frame[8] = crc & 0xff;
  }

  // Payload remains 0x00 (zero-fill)
  return frame;
}

/**
 * Concatenate multiple frame byte arrays into one buffer.
 */
function concat(...frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const f of frames) {
    out.set(f, pos);
    pos += f.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Design-note required test cases
// ---------------------------------------------------------------------------

describe('parses ADTS frame stream from fixture sine-44100-mono.aac', () => {
  it('returns non-empty frames array', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    expect(file.frames.length).toBeGreaterThan(0);
  });

  it('extracts sample rate 44100 from sampleRateIndex == 4', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    const first = file.frames[0];
    expect(first).toBeDefined();
    expect(first!.header.sampleRate).toBe(44100);
    expect(first!.header.sampleRateIndex).toBe(4);
  });

  it('extracts mono channel configuration from fixture', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    const first = file.frames[0];
    expect(first).toBeDefined();
    // The fixture is mono — channel_configuration should be 1
    expect(first!.header.channelConfiguration).toBe(1);
  });

  it('all frames have consistent sample rate', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    for (const frame of file.frames) {
      expect(frame.header.sampleRate).toBe(44100);
    }
  });

  it('all frames have valid frameBytes matching data length', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    for (const frame of file.frames) {
      expect(frame.data.length).toBe(frame.header.frameBytes);
    }
  });

  it('all frames have AAC-LC profile', async () => {
    const bytes = await loadAacFixture();
    const file = parseAdts(bytes);
    for (const frame of file.frames) {
      expect(frame.header.profile).toBe('LC');
    }
  });
});

describe('computes correct frameBytes for AAC-LC', () => {
  it('reports frameBytes matching the 13-bit field', () => {
    const frame = buildAdtsFrame({ payloadLength: 100 });
    const file = parseAdts(frame);
    expect(file.frames.length).toBe(1);
    expect(file.frames[0]!.header.frameBytes).toBe(107); // 7 (header) + 100 (payload)
  });
});

describe('reads 2-byte CRC when protection_absent == 0', () => {
  it('parses frame with CRC and sets hasCrc=true', () => {
    const frame = buildAdtsFrame({ protectionAbsent: 0, crc: 0x5a5a, payloadLength: 10 });
    // Need next frame to be present for sync validation, or be at EOF
    const file = parseAdts(frame);
    expect(file.frames.length).toBe(1);
    expect(file.frames[0]!.header.hasCrc).toBe(true);
    expect(file.frames[0]!.header.crc).toBe(0x5a5a);
  });
});

describe('validates full header — random 0xFFF bytes in payload do not cause false frame starts', () => {
  it('only one frame parsed when 0xFF 0xF0 bytes are embedded in payload', () => {
    // Build a frame with 0xFF 0xF1 embedded in the middle of the payload.
    // The parser must NOT treat those bytes as a new frame start.
    const payloadSize = 20;
    const frame = buildAdtsFrame({ payloadLength: payloadSize });
    // Inject a false sync at bytes 10-11 within the payload (offset 17-18 from frame start)
    frame[17] = 0xff;
    frame[18] = 0xf1;
    // Parsing this single frame: the parser should read the 27-byte frame in full,
    // then reach EOF — yielding exactly 1 frame.
    const file = parseAdts(frame);
    expect(file.frames.length).toBe(1);
  });

  it('parses multi-frame stream correctly ignoring payload 0xFF bytes', () => {
    const f1 = buildAdtsFrame({ payloadLength: 20 });
    const f2 = buildAdtsFrame({ payloadLength: 20 });
    // Inject false 0xFF 0xF0 at middle of f1 payload
    f1[15] = 0xff;
    f1[16] = 0xf0;
    const stream = concat(f1, f2);
    const file = parseAdts(stream);
    // Should parse exactly 2 frames (the false sync is inside f1's payload range)
    expect(file.frames.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Security cap tests
// ---------------------------------------------------------------------------

describe('C-1: parseAdts rejects input larger than 200 MiB', () => {
  it('throws AdtsInputTooLargeError for oversized input', () => {
    const oversized = new Uint8Array(MAX_INPUT_BYTES + 1);
    expect(() => parseAdts(oversized)).toThrow(AdtsInputTooLargeError);
  });
});

describe('C-3: truncated frame throws AdtsTruncatedFrameError', () => {
  it('throws when frameBytes exceeds available bytes', () => {
    // Build a frame that claims frameBytes=200 but only provides 100 bytes.
    const frame = buildAdtsFrame({ payloadLength: 193 }); // 7+193=200
    // Truncate to 100 bytes
    const truncated = frame.subarray(0, 100);
    expect(() => parseAdts(truncated)).toThrow(AdtsTruncatedFrameError);
  });
});

describe('C-4: corrupt stream throws AdtsCorruptStreamError', () => {
  it('throws AdtsCorruptStreamError when >8 sync candidates all fail lookahead', () => {
    // Build a stream where every sync candidate has a valid parseable header, but
    // the lookahead check fails because frameBytes lands on a non-sync byte, AND
    // there are more syncs beyond nextFrameOffset (so isTrailingJunk is false too).
    //
    // Strategy:
    // - Place 12 syncs with spacing=15 bytes (> 7-byte header, no overlapping writes).
    // - Each sync claims frameBytes=11 (= 7 header + 4 payload).
    // - nextFrameOffset = off + 11. With spacing 15, this falls on off+11 which is 0x00.
    // - Syncs are at offsets 0, 15, 30, ..., 165. nextFrameOffset for off=0 is 11.
    //   stream[11]=0x00 (not a sync) => hasSyncAt returns false. isTrailingJunk also
    //   false because bufSize - 11 = 4289 > 4096. So nextSyncValid = false => rejected.
    // - After >8 rejections with 0 valid frames => AdtsCorruptStreamError.
    const bufSize = 4300; // large enough: bufSize - nextFrameOffset(max=176) > 4096
    const stream = new Uint8Array(bufSize); // all zeros
    const frameBytes = 11; // 7-byte header + 4-byte payload
    const syncSpacing = 15; // spacing > 7 bytes so headers don't overlap
    const numSyncs = 12;
    for (let i = 0; i < numSyncs; i++) {
      const off = i * syncSpacing;
      if (off + 7 >= bufSize) break;
      stream[off] = 0xff;
      stream[off + 1] = 0xf1; // pa=1, layer=0, id=0 (MPEG-4)
      stream[off + 2] = (1 << 6) | (4 << 2) | 0; // LC profile, sfi=4 (44100), channelHigh=0
      const frameLenHigh = (frameBytes >> 11) & 0x3;
      stream[off + 3] = (1 << 6) | frameLenHigh; // channelLow=01 (mono), frameLenHigh
      stream[off + 4] = (frameBytes >> 3) & 0xff;
      const frameLenLow = frameBytes & 0x7;
      stream[off + 5] = (frameLenLow << 5) | 0x1f; // bufferFullness high 5 bits = VBR
      stream[off + 6] = 0xfc; // bufLow=0x3f (VBR), rawBlocks=0 (0xfc & 0x3 = 0)
      // bytes at off+7..off+10: 0x00 (payload — not a sync byte)
      // byte at off+11 (= nextFrameOffset): 0x00, not a sync => lookahead fails
    }
    // Verify our encoding: rawBlocks field of first sync
    // stream[6] = 0xfc = 0b11111100; rawBlocks = 0xfc & 0x3 = 0. Good.
    // stream[11] = 0x00 (since offset 11 is not a sync position). Good.
    // bufSize - 11 = 4289 > MAX_TRAILING_JUNK=4096 => isTrailingJunk=false. Good.
    expect(() => parseAdts(stream)).toThrow(AdtsCorruptStreamError);
  });

  it('throws AdtsTruncatedFrameError when frameBytes exceeds buffer (before corrupt check)', () => {
    // When frameBytes > input.length, TruncatedFrameError fires before CorruptStream check.
    // This is the correct behavior per spec — TruncatedFrame is a hard error.
    const corruptStream = new Uint8Array(50);
    corruptStream[0] = 0xff;
    corruptStream[1] = 0xf1;
    corruptStream[2] = (1 << 6) | (4 << 2) | 0;
    corruptStream[3] = (1 << 6) | 0;
    const fb = 200; // exceeds buffer
    corruptStream[4] = (fb >> 3) & 0xff;
    corruptStream[5] = ((fb & 0x7) << 5) | 0x1f;
    corruptStream[6] = 0xfc;
    expect(() => parseAdts(corruptStream)).toThrow(AdtsTruncatedFrameError);
  });
});

describe('Trap #8: throws AdtsMultipleRawBlocksUnsupportedError for rawBlocks > 0', () => {
  it('throws when rawBlocks=1 in frame header', () => {
    const frame = buildAdtsFrame({ rawBlocks: 1, payloadLength: 20 });
    expect(() => parseAdts(frame)).toThrow(AdtsMultipleRawBlocksUnsupportedError);
  });
});

describe('multiple valid frames parsed in sequence', () => {
  it('parses two back-to-back frames correctly', () => {
    const f1 = buildAdtsFrame({ sfi: 4, channelConfig: 2, payloadLength: 50 });
    const f2 = buildAdtsFrame({ sfi: 4, channelConfig: 2, payloadLength: 80 });
    const stream = concat(f1, f2);
    const file = parseAdts(stream);
    expect(file.frames.length).toBe(2);
    expect(file.frames[0]!.header.frameBytes).toBe(57);
    expect(file.frames[1]!.header.frameBytes).toBe(87);
  });

  it('parses five frames from a synthetic stream', () => {
    const frames = Array.from({ length: 5 }, (_, i) =>
      buildAdtsFrame({ payloadLength: 20 + i * 5 }),
    );
    const stream = concat(...frames);
    const file = parseAdts(stream);
    expect(file.frames.length).toBe(5);
  });
});

describe('handles trailing junk bytes', () => {
  it('parses single frame followed by a few junk bytes', () => {
    const frame = buildAdtsFrame({ payloadLength: 20 });
    const junk = new Uint8Array([0x00, 0x00, 0x00]);
    const stream = concat(frame, junk);
    const file = parseAdts(stream);
    expect(file.frames.length).toBe(1);
  });
});

describe('empty input returns empty frames', () => {
  it('returns zero frames for empty buffer', () => {
    const file = parseAdts(new Uint8Array(0));
    expect(file.frames).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// M-1: Global cumulative scan cap (MAX_TOTAL_SYNC_SCAN_BYTES)
// ---------------------------------------------------------------------------

describe('M-1: cumulative sync scan cap across parser loop', () => {
  it('does NOT throw for a valid frame followed by 4 KiB of null junk (within budget)', () => {
    // 4 KiB of 0x00 bytes has no sync candidates — scanForSync returns -1 quickly.
    // Verifies that a clean stream with trailing junk doesn't hit the cumulative cap.
    const validFrame = buildAdtsFrame({ payloadLength: 10 });
    const junk = new Uint8Array(4 * 1024); // all zeros — no sync candidates
    const stream = concat(validFrame, junk);
    expect(() => parseAdts(stream)).not.toThrow();
  });

  it('throws AdtsCorruptStreamError when cumulative sync scan exceeds MAX_TOTAL_SYNC_SCAN_BYTES (M-1)', () => {
    // Build a stream that forces repeated scanForSync calls, each consuming ~SYNC_SCAN_CAP (1 MiB).
    // Pattern: 17 valid-looking sync candidates spaced 2 MiB apart, each preceded by 2 MiB
    // of null bytes (no embedded sync) so scanForSync scans 1 MiB per rejection.
    // After 17 x 1 MiB scans = 17 MiB > MAX_TOTAL_SYNC_SCAN_BYTES (16 MiB) → throws.
    //
    // Each sync candidate: bytes 0xFF 0xF1 (protectionAbsent=1) with layer=0, but
    // the remaining header bytes will fail some validation (frameBytes=0 < headerSize=7)
    // so the candidate is rejected and the parser searches for the next sync.
    const SCAN_CAP = 1 * 1024 * 1024; // SYNC_SCAN_CAP
    const SEGMENT_SIZE = SCAN_CAP + 1; // just over 1 MiB between each sync candidate
    const NUM_SEGMENTS = 18; // 18 segments × 1 MiB scan = 18 MiB > 16 MiB cap
    const size = NUM_SEGMENTS * SEGMENT_SIZE;
    const stream = new Uint8Array(size); // zero-filled (no sync in null runs)

    // Place a rejected-candidate sync at the start of each segment.
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const off = i * SEGMENT_SIZE;
      if (off + 7 >= size) break;
      // Write sync word 0xFF 0xF1 (valid sync, but frame with frameBytes=0 is invalid)
      stream[off] = 0xff;
      stream[off + 1] = 0xf1; // protectionAbsent=1, layer=0, id=0
      stream[off + 2] = (1 << 6) | (4 << 2) | 0; // LC, sfi=4, channelHigh=0
      stream[off + 3] = (1 << 6) | 0; // channelLow=01 (mono), frameLenHigh=0
      // frameBytes encoded in bytes 3-5: set to 0 (< headerSize=7 → rejected)
      stream[off + 4] = 0;
      stream[off + 5] = 0;
      stream[off + 6] = 0xfc; // VBR, rawBlocks=0
      // Remainder of segment: 0x00 — scanForSync scans ~1 MiB of nulls and returns -1
      // BUT: hasSyncAt returns false for 0x00, so the parser calls scanForSync(cursor+1)
      // which scans up to SYNC_SCAN_CAP bytes of null before finding the next candidate.
    }

    expect(() => parseAdts(stream)).toThrow(AdtsCorruptStreamError);
  });
});

// ---------------------------------------------------------------------------
// M-2: "Mostly garbage" corrupt stream guard
// ---------------------------------------------------------------------------

describe('M-2: mostly-garbage stream guard (1 valid frame + large junk tail)', () => {
  it('throws AdtsCorruptStreamError for 1 valid frame followed by 0xFF junk (M-2)', () => {
    // One valid frame at the start, then 2000 bytes of 0xFF that each become a rejected
    // sync candidate (layer != 0 for 0xFF 0xFF). With 1 accepted and ≥32*4=128 rejected
    // candidates at >95% rejection rate, the parser throws AdtsCorruptStreamError.
    const validFrame = buildAdtsFrame({ payloadLength: 10 });
    // 2000 bytes of 0xFF: every byte is hasSyncAt=true (0xFF,0xFF top nibble=0xF),
    // each parsed as layer=3 (invalid), so all 2000 are rejected candidates.
    const junk = new Uint8Array(2000).fill(0xff);
    const stream = concat(validFrame, junk);
    // candidatesAttempted ~= 2001, candidatesRejected ~= 2000, ratio ~= 0.9995 > 0.95
    // and 2001 > MIN_CANDIDATES_FOR_CORRUPT * 4 (8*4=32) → mostlyGarbage fires.
    expect(() => parseAdts(stream)).toThrow(AdtsCorruptStreamError);
  });
});
