import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { Mp3FreeFormatError, Mp3InvalidFrameError } from './errors.ts';
import { parseMp3FrameHeader, sideInfoSize } from './frame-header.ts';

// ---------------------------------------------------------------------------
// Helper: build a 4-byte frame header word
// ---------------------------------------------------------------------------
function makeHeader({
  version = 0b11, // MPEG-1
  layer = 0b01, // Layer III
  protection = 1, // no CRC
  bitrateIdx = 9, // 128 kbps for MPEG-1
  srIdx = 0, // 44100 Hz
  padding = 0,
  channelMode = 0b11, // mono
  modeExt = 0,
}: Partial<{
  version: number;
  layer: number;
  protection: number;
  bitrateIdx: number;
  srIdx: number;
  padding: number;
  channelMode: number;
  modeExt: number;
}> = {}): Uint8Array {
  const word =
    (0x7ff << 21) |
    (version << 19) |
    (layer << 17) |
    (protection << 16) |
    (bitrateIdx << 12) |
    (srIdx << 10) |
    (padding << 9) |
    (channelMode << 6) |
    (modeExt << 4);

  const buf = new Uint8Array(4);
  buf[0] = (word >>> 24) & 0xff;
  buf[1] = (word >>> 16) & 0xff;
  buf[2] = (word >>> 8) & 0xff;
  buf[3] = word & 0xff;
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseMp3FrameHeader', () => {
  it('returns null when no sync word present', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(parseMp3FrameHeader(bytes, 0)).toBeNull();
  });

  it('returns null when sync is 0xFF but not 0xFFE', () => {
    // 0xFF 0xC0 — sync is only 8 bits, not 11
    const bytes = new Uint8Array([0xff, 0xc0, 0x00, 0x00]);
    expect(parseMp3FrameHeader(bytes, 0)).toBeNull();
  });

  it('returns null when offset would read past end', () => {
    const bytes = new Uint8Array([0xff, 0xfb]);
    expect(parseMp3FrameHeader(bytes, 0)).toBeNull();
  });

  it('parses a valid MPEG-1 Layer III mono 128 kbps 44100 Hz frame header', () => {
    const header4 = makeHeader({
      version: 0b11,
      layer: 0b01,
      bitrateIdx: 9,
      srIdx: 0,
      channelMode: 0b11,
    });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0);
    expect(h).not.toBeNull();
    expect(h!.version).toBe('1');
    expect(h!.layer).toBe(3);
    expect(h!.bitrate).toBe(128);
    expect(h!.sampleRate).toBe(44100);
    expect(h!.channelMode).toBe('mono');
    expect(h!.padding).toBe(false);
    expect(h!.protected).toBe(false); // protection_absent = 1 → no CRC
    expect(h!.samplesPerFrame).toBe(1152);
    // frame_bytes = floor(144 * 128000 / 44100) + 0 = 417
    expect(h!.frameBytes).toBe(417);
  });

  it('correctly adds padding to frame length', () => {
    const header4 = makeHeader({ bitrateIdx: 9, srIdx: 0, padding: 1 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0);
    expect(h!.frameBytes).toBe(418);
    expect(h!.padding).toBe(true);
  });

  it('parses channel modes correctly', () => {
    const modes: Array<[number, 'stereo' | 'joint' | 'dual' | 'mono']> = [
      [0b00, 'stereo'],
      [0b01, 'joint'],
      [0b10, 'dual'],
      [0b11, 'mono'],
    ];
    for (const [bits, expected] of modes) {
      const header4 = makeHeader({ channelMode: bits });
      const bytes = new Uint8Array(100);
      bytes.set(header4, 0);
      const h = parseMp3FrameHeader(bytes, 0);
      expect(h!.channelMode).toBe(expected);
    }
  });

  it('parses MPEG-2 Layer III (576 samples/frame, half sample rates)', () => {
    // MPEG-2 bitrate table: 0,8,16,24,32,40,48,56,64,80,96,112,128,144,160
    // sr table for MPEG-2: 22050(idx=0), 24000(idx=1), 16000(idx=2)
    // bitrateIdx=9 → 80 kbps; srIdx=0 → 22050 Hz
    const header4 = makeHeader({ version: 0b10, layer: 0b01, bitrateIdx: 9, srIdx: 0 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0);
    expect(h).not.toBeNull();
    expect(h!.version).toBe('2');
    expect(h!.sampleRate).toBe(22050);
    expect(h!.samplesPerFrame).toBe(576);
    expect(h!.bitrate).toBe(80); // MPEG-2 bitrate_index 9 = 80 kbps
    // frame_bytes = floor(72 * 80000 / 22050) + 0 = floor(261.22) = 261
    expect(h!.frameBytes).toBe(261);
  });

  it('parses MPEG 2.5 Layer III (read-only)', () => {
    // MPEG-2.5 version bits = 0b00
    const header4 = makeHeader({ version: 0b00, layer: 0b01, bitrateIdx: 9, srIdx: 0 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0);
    expect(h).not.toBeNull();
    expect(h!.version).toBe('2.5');
    expect(h!.sampleRate).toBe(11025); // MPEG-2.5, sr_idx=0 → 11025
    expect(h!.samplesPerFrame).toBe(576);
  });

  it('throws Mp3FreeFormatError for bitrate_index == 0', () => {
    const header4 = makeHeader({ bitrateIdx: 0 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3FreeFormatError);
  });

  it('throws Mp3InvalidFrameError for bitrate_index == 15 (bad)', () => {
    const header4 = makeHeader({ bitrateIdx: 15 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('throws Mp3InvalidFrameError for sampling_frequency index 3 (reserved)', () => {
    const header4 = makeHeader({ srIdx: 3 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('throws Mp3InvalidFrameError for reserved version bits (01)', () => {
    const header4 = makeHeader({ version: 0b01 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('throws Mp3InvalidFrameError for non-Layer-III (Layer I)', () => {
    const header4 = makeHeader({ layer: 0b11 }); // Layer I
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('throws Mp3InvalidFrameError for non-Layer-III (Layer II)', () => {
    const header4 = makeHeader({ layer: 0b10 }); // Layer II
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('throws Mp3InvalidFrameError for reserved layer bits (00)', () => {
    const header4 = makeHeader({ layer: 0b00 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    expect(() => parseMp3FrameHeader(bytes, 0)).toThrow(Mp3InvalidFrameError);
  });

  it('detects CRC protection (protection_absent == 0)', () => {
    const header4 = makeHeader({ protection: 0 }); // CRC present
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0);
    expect(h!.protected).toBe(true);
  });

  it('can parse at a non-zero offset', () => {
    const header4 = makeHeader();
    const bytes = new Uint8Array(200);
    bytes.set(header4, 50);
    const h = parseMp3FrameHeader(bytes, 50);
    expect(h).not.toBeNull();
    expect(h!.version).toBe('1');
  });

  it('parses the real fixture first audio frame header byte-by-byte', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    // First audio frame starts at 462 (after 45-byte ID3v2 + 417-byte Xing frame).
    const AUDIO_FRAME_OFFSET = 462;
    expect(data[AUDIO_FRAME_OFFSET]).toBe(0xff);
    expect(data[AUDIO_FRAME_OFFSET + 1]).toBe(0xfb);

    const h = parseMp3FrameHeader(data, AUDIO_FRAME_OFFSET);
    expect(h).not.toBeNull();
    expect(h!.version).toBe('1');
    expect(h!.layer).toBe(3);
    expect(h!.sampleRate).toBe(44100);
    expect(h!.channelMode).toBe('mono');
    expect(h!.samplesPerFrame).toBe(1152);
  });
});

// --- Security regression: Fix 5 — defensive frameBytes < 4 assertion ---

describe('parseMp3FrameHeader — defensive frameBytes guard', () => {
  it('returns null when computed frameBytes would be less than 4 (safety net documentation)', () => {
    // The frameBytes < 4 guard in parseMp3FrameHeader is a defensive safety net.
    // All legitimate Layer III bitrate/sample-rate combinations produce frameBytes
    // far larger than 4, making this branch unreachable through valid spec values.
    //
    // The minimum real-world value is:
    //   MPEG-2/2.5 Layer III, 8 kbps, 22050 Hz (or 11025 Hz):
    //     floor(72 * 8000 / 22050) + 0 = 26 bytes  (MPEG-2)
    //     floor(72 * 8000 / 11025) + 0 = 52 bytes  (MPEG-2.5)
    //
    // There is no way to trigger the guard via a well-formed frame header byte
    // sequence. Instead, this test validates the smallest legitimate frame size
    // to confirm the guard does NOT falsely fire on real inputs.
    //
    // bitrateIdx=1 (8 kbps for MPEG-2/2.5), srIdx=0 (22050 Hz for MPEG-2):
    //   frameBytes = floor(72 * 8000 / 22050) = 26  ← far above 4, no null
    const bytes = new Uint8Array(100);
    const word =
      (0x7ff << 21) |
      (0b10 << 19) | // MPEG-2
      (0b01 << 17) | // Layer III
      (1 << 16) | // no CRC
      (1 << 12) | // bitrateIdx = 1 → 8 kbps
      (0 << 10) | // srIdx = 0 → 22050 Hz
      (0b11 << 6); // mono
    bytes[0] = (word >>> 24) & 0xff;
    bytes[1] = (word >>> 16) & 0xff;
    bytes[2] = (word >>> 8) & 0xff;
    bytes[3] = word & 0xff;
    const h = parseMp3FrameHeader(bytes, 0);
    // Must parse successfully (frameBytes = 26 >> 4, guard does NOT fire).
    expect(h).not.toBeNull();
    expect(h!.frameBytes).toBe(26);
    expect(h!.frameBytes).toBeGreaterThanOrEqual(4);
  });
});

describe('sideInfoSize', () => {
  it('returns 17 for MPEG-1 mono', () => {
    const header4 = makeHeader({ channelMode: 0b11 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0)!;
    expect(sideInfoSize(h)).toBe(17);
  });

  it('returns 32 for MPEG-1 stereo', () => {
    const header4 = makeHeader({ channelMode: 0b00 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0)!;
    expect(sideInfoSize(h)).toBe(32);
  });

  it('returns 9 for MPEG-2 mono', () => {
    const header4 = makeHeader({ version: 0b10, channelMode: 0b11 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0)!;
    expect(sideInfoSize(h)).toBe(9);
  });

  it('returns 17 for MPEG-2 stereo', () => {
    const header4 = makeHeader({ version: 0b10, channelMode: 0b00 });
    const bytes = new Uint8Array(100);
    bytes.set(header4, 0);
    const h = parseMp3FrameHeader(bytes, 0)!;
    expect(sideInfoSize(h)).toBe(17);
  });
});
