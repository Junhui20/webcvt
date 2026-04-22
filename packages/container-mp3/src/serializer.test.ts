import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { Mp3Mpeg25EncodeNotSupportedError } from './errors.ts';
import { parseMp3 } from './parser.ts';
import { serializeMp3 } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeFrameHeaderBytes(
  version = 0b11,
  bitrateIdx = 9,
  srIdx = 0,
  channelMode = 0b11,
): Uint8Array {
  const word =
    (0x7ff << 21) |
    (version << 19) |
    (0b01 << 17) |
    (1 << 16) |
    (bitrateIdx << 12) |
    (srIdx << 10) |
    (channelMode << 6);
  const buf = new Uint8Array(4);
  buf[0] = (word >>> 24) & 0xff;
  buf[1] = (word >>> 16) & 0xff;
  buf[2] = (word >>> 8) & 0xff;
  buf[3] = word & 0xff;
  return buf;
}

function makeSingleFrameMp3(count = 1): Uint8Array {
  const FRAME_SIZE = 417;
  const buf = new Uint8Array(FRAME_SIZE * count);
  for (let i = 0; i < count; i++) {
    buf.set(makeFrameHeaderBytes(), i * FRAME_SIZE);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeMp3', () => {
  it('throws Mp3Mpeg25EncodeNotSupportedError for MPEG 2.5 frames', () => {
    // MPEG-2.5: version bits = 0b00, bitrateIdx=9 (80 kbps), srIdx=0 → 11025 Hz
    // frame_bytes = floor(72 * 80000 / 11025) = 522
    const FRAME_SIZE = 522;
    const buf = new Uint8Array(FRAME_SIZE);
    buf.set(makeFrameHeaderBytes(0b00, 9, 0), 0);
    const file = parseMp3(buf);
    expect(() => serializeMp3(file)).toThrow(Mp3Mpeg25EncodeNotSupportedError);
  });

  it('round-trips a raw frames-only MP3 (no ID3 tags)', () => {
    const original = makeSingleFrameMp3(3);
    const file = parseMp3(original);
    const serialized = serializeMp3(file);
    expect(serialized).toEqual(original);
  });

  it('round-trips: parse → serialize → parse produces equal frame contents', () => {
    const original = makeSingleFrameMp3(5);
    const file1 = parseMp3(original);
    const serialized = serializeMp3(file1);
    const file2 = parseMp3(serialized);

    expect(file2.frames.length).toBe(file1.frames.length);
    for (let i = 0; i < file1.frames.length; i++) {
      expect(file2.frames[i]!.data).toEqual(file1.frames[i]!.data);
      expect(file2.frames[i]!.header.bitrate).toBe(file1.frames[i]!.header.bitrate);
      expect(file2.frames[i]!.header.sampleRate).toBe(file1.frames[i]!.header.sampleRate);
    }
  });

  it('preserves ID3v1 tag across round-trip', () => {
    const frames = makeSingleFrameMp3(2);
    const id3v1 = new Uint8Array(128);
    id3v1[0] = 0x54;
    id3v1[1] = 0x41;
    id3v1[2] = 0x47; // TAG
    id3v1[127] = 33; // genre = acid

    const mp3 = concatBytes(frames, id3v1);
    const file = parseMp3(mp3);
    const serialized = serializeMp3(file);
    const reparsed = parseMp3(serialized);

    expect(reparsed.id3v1).toBeDefined();
    expect(reparsed.id3v1!.genre).toBe(33);
  });

  it('preserves ID3v2 tag across round-trip', () => {
    // Minimal ID3v2.4 tag (10 bytes, no frames)
    const id3v2 = new Uint8Array(10);
    id3v2[0] = 0x49;
    id3v2[1] = 0x44;
    id3v2[2] = 0x33;
    id3v2[3] = 4;
    id3v2[4] = 0;
    id3v2[5] = 0;
    const mp3 = concatBytes(id3v2, makeSingleFrameMp3(1));
    const file = parseMp3(mp3);
    const serialized = serializeMp3(file);
    const reparsed = parseMp3(serialized);
    expect(reparsed.id3v2).toBeDefined();
  });

  it('preserves Xing header verbatim across round-trip', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);
    expect(file.xingHeader).toBeDefined();

    const serialized = serializeMp3(file);
    const reparsed = parseMp3(serialized);

    expect(reparsed.xingHeader).toBeDefined();
    expect(reparsed.xingHeader!.kind).toBe(file.xingHeader!.kind);
    expect(reparsed.xingHeader!.totalFrames).toBe(file.xingHeader!.totalFrames);
    expect(reparsed.xingHeader!.totalBytes).toBe(file.xingHeader!.totalBytes);
  });

  it('round-trips the real fixture with byte-identical audio region', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const file = parseMp3(data);
    const serialized = serializeMp3(file);
    const reparsed = parseMp3(serialized);

    // Same number of audio frames.
    expect(reparsed.frames.length).toBe(file.frames.length);

    // Every frame's raw bytes must be identical.
    for (let i = 0; i < file.frames.length; i++) {
      expect(reparsed.frames[i]!.data).toEqual(file.frames[i]!.data);
    }

    // The serialized length differs from the original by exactly the amount
    // of ID3v2 padding that Phase 1 strips. The fixture's ID3v2 tag has
    // 10 bytes of padding that the serializer omits, so serialized is 10
    // bytes shorter. Audio content is identical; only the tag padding changes.
    expect(serialized.length).toBe(data.length - 10);
  });

  it('round-trip preserves ID3v2 logical content (unsynced → not unsynced on write)', () => {
    // Build a tag with unsynchronisation. The raw logical frame data is [0xFF, 0x01, 0xFE].
    // With global unsync, the entire tag body (including frame headers) is unsynchronised
    // on disk. Frame sizes in headers refer to the un-unsynchronised data.
    function makeSynchsafeLocal(n: number): Uint8Array {
      const buf = new Uint8Array(4);
      buf[0] = (n >>> 21) & 0x7f;
      buf[1] = (n >>> 14) & 0x7f;
      buf[2] = (n >>> 7) & 0x7f;
      buf[3] = n & 0x7f;
      return buf;
    }
    function encodeUnsyncLocal(data: Uint8Array): Uint8Array {
      let extra = 0;
      for (const b of data) if (b === 0xff) extra++;
      if (extra === 0) return data;
      const out = new Uint8Array(data.length + extra);
      let idx = 0;
      for (const b of data) {
        out[idx++] = b;
        if (b === 0xff) out[idx++] = 0x00;
      }
      return out;
    }

    const rawData = new Uint8Array([0xff, 0x01, 0xfe]); // logical frame data

    // Build the ID3v2 frame with logical data size (3 bytes).
    const frameSizeBytes = makeSynchsafeLocal(rawData.length);
    const preUnsyncFrame = new Uint8Array(10 + rawData.length);
    preUnsyncFrame[0] = 0x50;
    preUnsyncFrame[1] = 0x52; // "PR"
    preUnsyncFrame[2] = 0x49;
    preUnsyncFrame[3] = 0x56; // "IV"
    preUnsyncFrame.set(frameSizeBytes, 4);
    preUnsyncFrame.set(rawData, 10);

    // Apply unsync to the entire frame (as the encoder would do).
    const unsyncedBody = encodeUnsyncLocal(preUnsyncFrame);

    const ss = makeSynchsafeLocal(unsyncedBody.length);
    const id3hdr = new Uint8Array(10);
    id3hdr[0] = 0x49;
    id3hdr[1] = 0x44;
    id3hdr[2] = 0x33;
    id3hdr[3] = 4;
    id3hdr[4] = 0;
    id3hdr[5] = 0x80; // unsync flag set
    id3hdr.set(ss, 6);

    const tagBytes = concatBytes(id3hdr, unsyncedBody);
    const mp3 = concatBytes(tagBytes, makeSingleFrameMp3(1));

    const file = parseMp3(mp3);
    expect(file.id3v2!.unsynced).toBe(true);
    // After parse, the frame data should be the decoded rawData.
    expect(file.id3v2!.frames[0]!.data).toEqual(rawData);

    // Serialize: Phase 1 writes without unsync.
    const serialized = serializeMp3(file);
    const reparsed = parseMp3(serialized);
    // Logical content should be identical after round-trip.
    expect(reparsed.id3v2!.frames[0]!.data).toEqual(rawData);
    // On write: unsync is NOT applied (Phase 1 policy).
    expect(reparsed.id3v2!.unsynced).toBe(false);
  });

  it('serializes an empty frames array (metadata-only file)', () => {
    const id3v2 = new Uint8Array(10);
    id3v2[0] = 0x49;
    id3v2[1] = 0x44;
    id3v2[2] = 0x33;
    id3v2[3] = 4;
    id3v2[4] = 0;
    id3v2[5] = 0;

    // Manually construct a Mp3File with no frames (no ID3v1 or xingHeader).
    const file = {
      id3v2: {
        version: [4, 0] as [number, number],
        flags: 0,
        frames: [],
        unsynced: false,
      },
      frames: [],
    };
    const result = serializeMp3(file);
    // Should be the 10-byte tag only.
    expect(result.length).toBe(10);
  });
});
