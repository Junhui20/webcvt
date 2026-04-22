import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { Mp3FreeFormatError, Mp3InvalidFrameError } from './errors.ts';
import { parseMp3 } from './parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrameHeaderBytes({
  version = 0b11,
  bitrateIdx = 9,
  srIdx = 0,
  padding = 0,
  channelMode = 0b11,
}: Partial<{
  version: number;
  bitrateIdx: number;
  srIdx: number;
  padding: number;
  channelMode: number;
}> = {}): Uint8Array {
  const word =
    (0x7ff << 21) |
    (version << 19) |
    (0b01 << 17) | // Layer III
    (1 << 16) | // no CRC
    (bitrateIdx << 12) |
    (srIdx << 10) |
    (padding << 9) |
    (channelMode << 6);
  const buf = new Uint8Array(4);
  buf[0] = (word >>> 24) & 0xff;
  buf[1] = (word >>> 16) & 0xff;
  buf[2] = (word >>> 8) & 0xff;
  buf[3] = word & 0xff;
  return buf;
}

/**
 * Build a minimal single-frame MP3 with no ID3 tags.
 * MPEG-1 Layer III, 128 kbps mono, 44100 Hz → 417 bytes/frame.
 */
function makeSingleFrameMp3(count = 1): Uint8Array {
  const FRAME_SIZE = 417;
  const buf = new Uint8Array(FRAME_SIZE * count);
  for (let i = 0; i < count; i++) {
    buf.set(makeFrameHeaderBytes(), i * FRAME_SIZE);
  }
  return buf;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function buildId3v1Tag(): Uint8Array {
  const buf = new Uint8Array(128);
  buf[0] = 0x54;
  buf[1] = 0x41;
  buf[2] = 0x47; // TAG
  // title = "Test Song"
  const title = 'Test Song';
  for (let i = 0; i < title.length; i++) buf[3 + i] = title.charCodeAt(i);
  buf[127] = 10; // genre
  return buf;
}

function buildMinimalId3v2(): Uint8Array {
  const buf = new Uint8Array(10);
  buf[0] = 0x49;
  buf[1] = 0x44;
  buf[2] = 0x33; // ID3
  buf[3] = 4;
  buf[4] = 0;
  buf[5] = 0; // v2.4, no flags
  // synchsafe size = 0
  return buf;
}

// ---------------------------------------------------------------------------
// Tests: fixture-based
// ---------------------------------------------------------------------------

describe('parseMp3 — fixture tests', () => {
  it('parses the sine-1s-44100-mono.mp3 fixture', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    expect(file.id3v2).toBeDefined();
    expect(file.xingHeader).toBeDefined();
    expect(file.frames.length).toBeGreaterThan(0);
    expect(file.id3v1).toBeUndefined(); // fixture has no ID3v1
  });

  it('detects ID3v2.4 tag in fixture', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    expect(file.id3v2!.version[0]).toBe(4);
    expect(file.id3v2!.unsynced).toBe(false);
  });

  it('recognises Info (Xing) VBR header and separates it from audio frames', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    expect(file.xingHeader).toBeDefined();
    expect(file.xingHeader!.kind).toBe('Info');
    expect(file.xingHeader!.totalFrames).toBe(40);
    expect(file.xingHeader!.totalBytes).toBe(17135);
    expect(file.xingHeader!.toc).toHaveLength(100);
  });

  it('counts exactly 40 audio frames in the fixture', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);
    // The "Info" Xing frame records 40 audio frames; that matches Xing totalFrames.
    expect(file.frames.length).toBe(40);
  });

  it('counts frame sample offsets correctly for MPEG-1 Layer III (1152 samples/frame)', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    // All audio frames should be MPEG-1 Layer III with 1152 samples/frame.
    for (const frame of file.frames) {
      expect(frame.header.version).toBe('1');
      expect(frame.header.layer).toBe(3);
      expect(frame.header.samplesPerFrame).toBe(1152);
    }

    // Total samples: 40 frames × 1152 = 46080 ≈ 1.045 seconds at 44100 Hz
    const totalSamples = file.frames.length * 1152;
    const durationSec = totalSamples / 44100;
    expect(durationSec).toBeGreaterThan(0.9);
    expect(durationSec).toBeLessThan(1.1);
  });

  it('all fixture frames have consistent sampleRate 44100 Hz', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);
    for (const frame of file.frames) {
      expect(frame.header.sampleRate).toBe(44100);
      expect(frame.header.channelMode).toBe('mono');
    }
  });

  it('validates real fixture first audio frame header byte-by-byte', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    const firstFrame = file.frames[0]!;
    expect(firstFrame.data[0]).toBe(0xff);
    expect(firstFrame.data[1]).toBe(0xfb);
    expect(firstFrame.header.version).toBe('1');
    expect(firstFrame.header.bitrate).toBe(128);
    expect(firstFrame.header.sampleRate).toBe(44100);
    expect(firstFrame.header.channelMode).toBe('mono');
  });

  it('detects LAME extension in Xing header from fixture', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);
    expect(file.xingHeader!.lame).toBeDefined();
    expect(file.xingHeader!.lame!.encoderString).toContain('Lavc');
  });

  it('Xing metadata frame is NOT included in audio frames', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);

    // The Xing frame has "Info" at offset 21 (MPEG-1 mono).
    // It must NOT appear in file.frames as an audio frame.
    for (const frame of file.frames) {
      const sideOff = 4 + 17; // MPEG-1 mono: 4 header + 17 side info = 21
      const tag = String.fromCharCode(
        frame.data[sideOff] ?? 0,
        frame.data[sideOff + 1] ?? 0,
        frame.data[sideOff + 2] ?? 0,
        frame.data[sideOff + 3] ?? 0,
      );
      expect(tag).not.toBe('Info');
      expect(tag).not.toBe('Xing');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: synthetic inputs
// ---------------------------------------------------------------------------

describe('parseMp3 — synthetic inputs', () => {
  it('parses a file with no ID3v2 tag (raw frames only)', () => {
    const mp3 = makeSingleFrameMp3(3);
    const file = parseMp3(mp3);
    expect(file.id3v2).toBeUndefined();
    expect(file.xingHeader).toBeUndefined();
    expect(file.frames.length).toBe(3);
  });

  it('parses a file with an ID3v1 tag at the end', () => {
    const frames = makeSingleFrameMp3(2);
    const id3v1 = buildId3v1Tag();
    const mp3 = concatBytes(frames, id3v1);
    const file = parseMp3(mp3);
    expect(file.id3v1).toBeDefined();
    expect(file.id3v1!.title).toBe('Test Song');
    expect(file.frames.length).toBe(2);
  });

  it('parses a file with both ID3v2 and ID3v1 tags', () => {
    const id3v2 = buildMinimalId3v2();
    const frames = makeSingleFrameMp3(2);
    const id3v1 = buildId3v1Tag();
    const mp3 = concatBytes(id3v2, frames, id3v1);
    const file = parseMp3(mp3);
    expect(file.id3v2).toBeDefined();
    expect(file.id3v1).toBeDefined();
    expect(file.frames.length).toBe(2);
  });

  it('tolerates random 0xFF bytes in tag payload without matching them as frame sync', () => {
    // Build ID3v2 tag with body containing 0xFF bytes (not sync).
    const fakeBody = new Uint8Array(100).fill(0xff);
    const ss = new Uint8Array(4);
    ss[0] = (100 >>> 21) & 0x7f;
    ss[1] = (100 >>> 14) & 0x7f;
    ss[2] = (100 >>> 7) & 0x7f;
    ss[3] = 100 & 0x7f;
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 4;
    header[4] = 0;
    header[5] = 0;
    header.set(ss, 6);
    const id3v2 = concatBytes(header, fakeBody);
    const frames = makeSingleFrameMp3(2);
    const mp3 = concatBytes(id3v2, frames);

    const file = parseMp3(mp3);
    // Should not treat the 0xFF bytes in ID3v2 as frame sync.
    expect(file.frames.length).toBe(2);
  });

  it('throws Mp3FreeFormatError on free-format frame (bitrate_index == 0)', () => {
    // Synthesise a free-format frame header (bitrate_index = 0).
    const word =
      (0x7ff << 21) |
      (0b11 << 19) | // MPEG-1
      (0b01 << 17) | // Layer III
      (1 << 16) | // no CRC
      (0 << 12) | // bitrate_index = 0 (free-format)
      (0 << 10) | // 44100 Hz
      (0b11 << 6); // mono
    const hdr = new Uint8Array(4);
    hdr[0] = (word >>> 24) & 0xff;
    hdr[1] = (word >>> 16) & 0xff;
    hdr[2] = (word >>> 8) & 0xff;
    hdr[3] = word & 0xff;
    const mp3 = new Uint8Array(500);
    mp3.set(hdr, 0);
    expect(() => parseMp3(mp3)).toThrow(Mp3FreeFormatError);
  });

  it('throws Mp3InvalidFrameError when no valid frames found', () => {
    const bytes = new Uint8Array(50).fill(0);
    expect(() => parseMp3(bytes)).toThrow(Mp3InvalidFrameError);
  });

  it('throws when input is empty', () => {
    expect(() => parseMp3(new Uint8Array(0))).toThrow(Mp3InvalidFrameError);
  });

  it('throws on truncated input mid-frame', () => {
    // Create frame header that claims 417 bytes but we only provide 200.
    const hdr = makeFrameHeaderBytes();
    const truncated = new Uint8Array(200);
    truncated.set(hdr, 0);
    // Parser will scan, find sync, compute frameBytes=417, but frame extends past end.
    // It will stop and produce 0 frames → throws InvalidFrame.
    expect(() => parseMp3(truncated)).toThrow(Mp3InvalidFrameError);
  });

  it('parses MPEG-2 Layer III frames (576 samples/frame, half sample rates)', () => {
    // MPEG-2, 22050 Hz (srIdx=0), bitrateIdx=9 → 80 kbps
    // frame_bytes = floor(72 * 80000 / 22050) + 0 = 261
    const FRAME_SIZE = 261;
    const buf = new Uint8Array(FRAME_SIZE * 2);
    for (let i = 0; i < 2; i++) {
      buf.set(makeFrameHeaderBytes({ version: 0b10, bitrateIdx: 9, srIdx: 0 }), i * FRAME_SIZE);
    }
    const file = parseMp3(buf);
    expect(file.frames.length).toBe(2);
    expect(file.frames[0]!.header.version).toBe('2');
    expect(file.frames[0]!.header.samplesPerFrame).toBe(576);
    expect(file.frames[0]!.header.sampleRate).toBe(22050);
  });

  it('parses MPEG 2.5 frames read-only', () => {
    // MPEG-2.5, bitrateIdx=9 (80 kbps), srIdx=0 → 11025 Hz
    // frame_bytes = floor(72 * 80000 / 11025) + 0 = 522
    const FRAME_SIZE = 522;
    const buf = new Uint8Array(FRAME_SIZE);
    buf.set(makeFrameHeaderBytes({ version: 0b00, bitrateIdx: 9, srIdx: 0 }), 0);
    const file = parseMp3(buf);
    expect(file.frames[0]!.header.version).toBe('2.5');
  });

  it('does not skip audio end when trailing 32 bytes do not contain APE magic', () => {
    // skipApeTag checks for "APETAGEX" at (audioEnd - 32). When those bytes are
    // not the APE footer magic the function must return audioEnd unchanged.
    // Build a file whose last 32 bytes look like a non-APE tag (e.g. all 0xAA).
    const frames = makeSingleFrameMp3(2);
    const fakeTrailer = new Uint8Array(32).fill(0xaa);
    const mp3 = concatBytes(frames, fakeTrailer);
    const file = parseMp3(mp3);
    // Both frames still parsed; audioEnd was NOT moved backwards.
    expect(file.frames.length).toBe(2);
  });

  it('skips an APE tag that precedes audio data end', () => {
    // Build "APETAGEX" footer at the very end of the file.
    // APE footer layout: 8-byte magic + 4-byte version + 4-byte size + ... = 32 bytes total.
    // We use tag size = 32 (only the footer itself) so the new audioEnd == old audioEnd - 32.
    const frames = makeSingleFrameMp3(2);
    const apeFooter = new Uint8Array(32);
    // "APETAGEX"
    apeFooter[0] = 0x41;
    apeFooter[1] = 0x50;
    apeFooter[2] = 0x45;
    apeFooter[3] = 0x54;
    apeFooter[4] = 0x41;
    apeFooter[5] = 0x47;
    apeFooter[6] = 0x45;
    apeFooter[7] = 0x58;
    // version (4 bytes LE at offset 8): 2000
    apeFooter[8] = 0xd0;
    apeFooter[9] = 0x07;
    apeFooter[10] = 0x00;
    apeFooter[11] = 0x00;
    // tag size (4 bytes LE at offset 12): 32 (includes footer itself)
    apeFooter[12] = 32;
    apeFooter[13] = 0x00;
    apeFooter[14] = 0x00;
    apeFooter[15] = 0x00;
    const mp3 = concatBytes(frames, apeFooter);
    const file = parseMp3(mp3);
    // Frames before the APE footer must still be found.
    expect(file.frames.length).toBe(2);
  });

  it('APE footer with tagSize=0 does not cause infinite loop or corrupt audioEnd', () => {
    // A malformed APE footer claiming tagSize=0 must be treated as a no-op:
    // audioEnd must remain unchanged (the guard newEnd < audioEnd catches this).
    const frames = makeSingleFrameMp3(2);
    const apeFooter = new Uint8Array(32);
    // "APETAGEX"
    apeFooter[0] = 0x41;
    apeFooter[1] = 0x50;
    apeFooter[2] = 0x45;
    apeFooter[3] = 0x54;
    apeFooter[4] = 0x41;
    apeFooter[5] = 0x47;
    apeFooter[6] = 0x45;
    apeFooter[7] = 0x58;
    // version = 2000 (LE)
    apeFooter[8] = 0xd0;
    apeFooter[9] = 0x07;
    apeFooter[10] = 0x00;
    apeFooter[11] = 0x00;
    // tag size = 0 (malformed)
    apeFooter[12] = 0x00;
    apeFooter[13] = 0x00;
    apeFooter[14] = 0x00;
    apeFooter[15] = 0x00;
    const mp3 = concatBytes(frames, apeFooter);
    // Must complete without hanging and must still find the audio frames.
    const file = parseMp3(mp3);
    expect(file.frames.length).toBe(2);
  });

  it('frame sync false-positive inside ID3v1 body is ignored', () => {
    // Build: [1 valid MP3 frame] + [128-byte ID3v1 tag with 0xFF 0xE0 in the title field].
    // The parser must see the ID3v1 boundary and constrain audioEnd so that
    // bytes inside the ID3v1 region are never matched as frame sync.
    const frame = makeSingleFrameMp3(1);
    const id3v1 = new Uint8Array(128);
    id3v1[0] = 0x54; // T
    id3v1[1] = 0x41; // A
    id3v1[2] = 0x47; // G  → "TAG" marker
    // Plant a false sync inside the title field (offset 3–32).
    id3v1[3] = 0xff;
    id3v1[4] = 0xe0; // looks like a sync word but is inside the tag body
    const mp3 = concatBytes(frame, id3v1);

    const file = parseMp3(mp3);
    // The ID3v1 tag must be detected, and exactly 1 audio frame must be found.
    expect(file.id3v1).toBeDefined();
    expect(file.frames.length).toBe(1);
  });

  it('scans forward past junk bytes to find the first valid sync', () => {
    // 10 junk bytes followed by a valid frame.
    const junk = new Uint8Array(10).fill(0x12);
    const frame = makeSingleFrameMp3(1);
    const mp3 = concatBytes(junk, frame);
    const file = parseMp3(mp3);
    expect(file.frames.length).toBe(1);
  });

  // --- Security regression: Fix 2 — APE tagSize < 32 treated as malformed ---

  it('APE footer with tagSize=20 (less than footer length) is treated as malformed and ignored', () => {
    // APE spec mandates that tagSize includes the 32-byte footer itself.
    // A tagSize of 20 would set newEnd = audioEnd - 20, placing it inside the
    // footer bytes and exposing raw tag data to the frame scanner.
    // The tightened guard (tagSize < 32 → return audioEnd) must prevent this.
    const frames = makeSingleFrameMp3(2);
    const apeFooter = new Uint8Array(32);
    // "APETAGEX"
    apeFooter[0] = 0x41;
    apeFooter[1] = 0x50;
    apeFooter[2] = 0x45;
    apeFooter[3] = 0x54;
    apeFooter[4] = 0x41;
    apeFooter[5] = 0x47;
    apeFooter[6] = 0x45;
    apeFooter[7] = 0x58;
    // version = 2000 LE
    apeFooter[8] = 0xd0;
    apeFooter[9] = 0x07;
    apeFooter[10] = 0x00;
    apeFooter[11] = 0x00;
    // tagSize = 20 (malformed: less than the 32-byte footer itself)
    apeFooter[12] = 20;
    apeFooter[13] = 0x00;
    apeFooter[14] = 0x00;
    apeFooter[15] = 0x00;
    const mp3 = concatBytes(frames, apeFooter);
    // Parser must not corrupt audioEnd and must still find both audio frames intact.
    const file = parseMp3(mp3);
    expect(file.frames.length).toBe(2);
  });
});
