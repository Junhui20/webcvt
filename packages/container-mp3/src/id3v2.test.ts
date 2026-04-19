import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { encodeUnsynchronisation, parseId3v2, serializeId3v2 } from './id3v2.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSynchsafe(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (n >>> 21) & 0x7f;
  buf[1] = (n >>> 14) & 0x7f;
  buf[2] = (n >>> 7) & 0x7f;
  buf[3] = n & 0x7f;
  return buf;
}

/** Build a minimal ID3v2.4 tag with no frames. */
function buildMinimalId3v2(bodySize = 0, flags = 0): Uint8Array {
  const ss = makeSynchsafe(bodySize);
  const buf = new Uint8Array(10 + bodySize);
  buf[0] = 0x49; // I
  buf[1] = 0x44; // D
  buf[2] = 0x33; // 3
  buf[3] = 4; // major version 4
  buf[4] = 0; // revision
  buf[5] = flags;
  buf.set(ss, 6);
  return buf;
}

/** Build a single ID3v2.4 frame. */
function buildId3v2Frame(id: string, data: Uint8Array): Uint8Array {
  const size = makeSynchsafe(data.length);
  const out = new Uint8Array(10 + data.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i) & 0xff;
  out.set(size, 4);
  // flags = 0
  out.set(data, 10);
  return out;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseId3v2', () => {
  it('returns null for a file that does not start with ID3', () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0xc0, 0x00]);
    expect(parseId3v2(bytes)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseId3v2(new Uint8Array(0))).toBeNull();
  });

  it('returns null for input shorter than 10 bytes', () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33]);
    expect(parseId3v2(bytes)).toBeNull();
  });

  it('parses a minimal ID3v2.4 tag with no frames', () => {
    const bytes = buildMinimalId3v2(0);
    const result = parseId3v2(bytes);
    expect(result).not.toBeNull();
    expect(result!.tag.version).toEqual([4, 0]);
    expect(result!.tag.frames).toHaveLength(0);
    expect(result!.tagSize).toBe(10);
  });

  it('parses a tag with a TIT2 frame', () => {
    const titleData = new Uint8Array([0x00, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // \0Hello
    const frameBytes = buildId3v2Frame('TIT2', titleData);
    const body = frameBytes;
    const tag = buildMinimalId3v2(body.length);
    tag.set(body, 10);

    const result = parseId3v2(tag);
    expect(result).not.toBeNull();
    expect(result!.tag.frames).toHaveLength(1);
    expect(result!.tag.frames[0]!.id).toBe('TIT2');
    expect(result!.tag.frames[0]!.data.length).toBe(titleData.length);
  });

  it('parses tag with footer flag (adds 10 bytes to tagSize)', () => {
    const bodySize = 4;
    const bytes = new Uint8Array(10 + bodySize + 10); // +10 for footer
    bytes[0] = 0x49;
    bytes[1] = 0x44;
    bytes[2] = 0x33;
    bytes[3] = 4;
    bytes[4] = 0;
    bytes[5] = 0x10; // footer flag bit4
    const ss = makeSynchsafe(bodySize);
    bytes.set(ss, 6);
    // Footer: "3DI" marker
    bytes[10 + bodySize] = 0x33;
    bytes[10 + bodySize + 1] = 0x44;
    bytes[10 + bodySize + 2] = 0x49;

    const result = parseId3v2(bytes);
    expect(result).not.toBeNull();
    expect(result!.tagSize).toBe(10 + bodySize + 10);
  });

  it('handles unsynchronisation: removes 0xFF 0x00 pairs', () => {
    // In ID3v2.4 with global unsync, the raw bytes on disk have 0xFF 0x00 inserted
    // after every 0xFF in the tag body (including frame headers). The sizes stored
    // in frame headers refer to the de-unsynchronised data length.
    //
    // rawData = the logical frame data (3 bytes: 0xFF, 0x01, 0xFE).
    // Build the frame header with size = 3 (the decoded data size).
    const rawData = new Uint8Array([0xff, 0x01, 0xfe]);
    // The frame body (pre-unsync) = 10-byte frame header + rawData.
    const preUnsyncFrame = buildId3v2Frame('TCON', rawData);
    // Now apply unsync to the entire body (frame header + data) for on-disk storage.
    const unsyncedBody = encodeUnsynchronisation(preUnsyncFrame);
    // Build the tag header with unsync flag and the unsynchronised body size.
    const ss = makeSynchsafe(unsyncedBody.length);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 4;
    header[4] = 0;
    header[5] = 0x80; // unsync flag
    header.set(ss, 6);

    const tag = concatBytes(header, unsyncedBody);
    const result = parseId3v2(tag);
    expect(result).not.toBeNull();
    expect(result!.tag.unsynced).toBe(true);
    // After removing unsync, the frame data should be the original rawData
    expect(result!.tag.frames[0]!.data).toEqual(rawData);
  });

  it('parses the real fixture ID3v2.4 tag', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const result = parseId3v2(data);
    expect(result).not.toBeNull();
    expect(result!.tag.version[0]).toBe(4); // ID3v2.4
    expect(result!.tagSize).toBe(45); // 10 header + 35 body
    expect(result!.tag.unsynced).toBe(false);
    // The fixture has a TSSE frame (encoder settings)
    const tsse = result!.tag.frames.find((f) => f.id === 'TSSE');
    expect(tsse).toBeDefined();
  });

  it('parses ID3v2.3 tag with plain uint32 frame size (not synchsafe)', () => {
    // ID3v2.3 uses plain big-endian uint32 for frame sizes (not synchsafe).
    // Build a v2.3 tag manually.
    const frameData = new Uint8Array([0x00, 0x41, 0x42]); // 3 bytes
    // Frame header for v2.3: 4-byte ID + 4-byte plain uint32 size + 2-byte flags + data
    const frameHdr = new Uint8Array(10);
    frameHdr[0] = 0x54; // T
    frameHdr[1] = 0x49; // I
    frameHdr[2] = 0x54; // T
    frameHdr[3] = 0x32; // 2 (TIT2)
    // size = 3 as plain uint32 BE
    frameHdr[4] = 0x00;
    frameHdr[5] = 0x00;
    frameHdr[6] = 0x00;
    frameHdr[7] = 0x03;
    // flags = 0
    const bodyBytes = concatBytes(frameHdr, frameData);

    const bodySize = bodyBytes.length;
    const ss = makeSynchsafe(bodySize);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 3; // major version 3 (ID3v2.3)
    header[4] = 0;
    header[5] = 0;
    header.set(ss, 6);

    const tag = concatBytes(header, bodyBytes);
    const result = parseId3v2(tag);
    expect(result).not.toBeNull();
    expect(result!.tag.version[0]).toBe(3);
    expect(result!.tag.frames).toHaveLength(1);
    expect(result!.tag.frames[0]!.id).toBe('TIT2');
    expect(result!.tag.frames[0]!.data.length).toBe(3);
  });

  it('parses ID3v2.3 tag with extended header (plain uint32 ext size)', () => {
    // ID3v2.3 extended header size is a plain uint32 (not synchsafe).
    // We build a minimal extended header of 10 bytes (8-byte ext size field + 2 padding bytes
    // but the size field itself encodes the total ext header size including itself).
    // Keep it simple: ext header = 4-byte plain uint32 size value (6) + 6 bytes padding.
    const extSize = 10; // total extended header size including the 4-byte size field
    const extHeader = new Uint8Array(extSize);
    // plain uint32 BE at offset 0 = extSize
    extHeader[0] = 0x00;
    extHeader[1] = 0x00;
    extHeader[2] = 0x00;
    extHeader[3] = extSize;

    // A simple TIT2 frame (v2.3 plain uint32 size).
    const frameContent = new Uint8Array([0x00, 0x48]); // null + "H"
    const frameHdr = new Uint8Array(10);
    frameHdr[0] = 0x54;
    frameHdr[1] = 0x49;
    frameHdr[2] = 0x54;
    frameHdr[3] = 0x32;
    frameHdr[4] = 0x00;
    frameHdr[5] = 0x00;
    frameHdr[6] = 0x00;
    frameHdr[7] = frameContent.length;

    const body = concatBytes(extHeader, frameHdr, frameContent);
    const bodySize = body.length;
    const ss = makeSynchsafe(bodySize);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 3; // v2.3
    header[4] = 0;
    header[5] = 0x40; // extended header flag
    header.set(ss, 6);

    const tag = concatBytes(header, body);
    const result = parseId3v2(tag);
    expect(result).not.toBeNull();
    expect(result!.tag.version[0]).toBe(3);
    // After skipping the extended header the TIT2 frame should be found.
    expect(result!.tag.frames.length).toBeGreaterThanOrEqual(1);
    expect(result!.tag.frames[0]!.id).toBe('TIT2');
  });

  it('returns null for ID3v2 tag whose declared size exceeds input', () => {
    // Header says body is 10000 bytes (synchsafe 0x00 0x00 0x4e 0x20),
    // but only 20 bytes of input total.
    const bytes = new Uint8Array([
      0x49,
      0x44,
      0x33, // ID3
      0x04,
      0x00, // version 2.4, revision 0
      0x00, // flags
      0x00,
      0x00,
      0x4e,
      0x20, // synchsafe size = 10000
      // no body follows
    ]);
    expect(parseId3v2(bytes)).toBeNull();
  });

  it('stops parsing frames at padding (null byte)', () => {
    const frameBytes = buildId3v2Frame('TALB', new Uint8Array([0x00, 0x41]));
    // Body = frame + 2 null padding bytes
    const padding = new Uint8Array(2);
    const body = concatBytes(frameBytes, padding);
    const tag = buildMinimalId3v2(body.length);
    tag.set(body, 10);

    const result = parseId3v2(tag);
    expect(result!.tag.frames).toHaveLength(1);
  });

  // --- Security regression: Fix 1 — extended-header size not bounded ---

  it('returns null when extended header size exceeds body length (v2.4 synchsafe)', () => {
    // Craft a v2.4 tag with EXTENDED flag set. The body is 20 bytes but the
    // extended-header size field (synchsafe) claims 200 — cursor would jump
    // past body.length, silently skipping all frames without the guard.
    const bodySize = 20;
    const body = new Uint8Array(bodySize);
    // Synchsafe encode 200 into the first 4 bytes (extSize field).
    body[0] = (200 >>> 21) & 0x7f;
    body[1] = (200 >>> 14) & 0x7f;
    body[2] = (200 >>> 7) & 0x7f;
    body[3] = 200 & 0x7f;

    const ss = makeSynchsafe(bodySize);
    const header = new Uint8Array(10);
    header[0] = 0x49; // I
    header[1] = 0x44; // D
    header[2] = 0x33; // 3
    header[3] = 4; // major v2.4
    header[4] = 0;
    header[5] = 0x40; // EXTENDED flag
    header.set(ss, 6);

    const tag = concatBytes(header, body);
    expect(parseId3v2(tag)).toBeNull();
  });

  it('returns null when extended header size exceeds body length (v2.3 plain uint32)', () => {
    // Same scenario for ID3v2.3 where extSize is a plain big-endian uint32.
    const bodySize = 20;
    const body = new Uint8Array(bodySize);
    // Write extSize = 300 as plain uint32 BE.
    body[0] = 0x00;
    body[1] = 0x00;
    body[2] = 0x01;
    body[3] = 0x2c; // 300

    const ss = makeSynchsafe(bodySize);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 3; // major v2.3
    header[4] = 0;
    header[5] = 0x40; // EXTENDED flag
    header.set(ss, 6);

    const tag = concatBytes(header, body);
    expect(parseId3v2(tag)).toBeNull();
  });

  // --- Security regression: Fix 4 — synchsafe body size cap ---

  it('returns null when ID3v2 declares a body larger than 64 MiB', () => {
    // Synchsafe-encode 100 MiB (104857600) into the size field.
    // The MAX_ID3_BODY guard (64 MiB) must reject this before any allocation.
    const hundredMib = 100 * 1024 * 1024;
    const ss = makeSynchsafe(hundredMib);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 4;
    header[4] = 0;
    header[5] = 0;
    header.set(ss, 6);
    // No body bytes follow — parser must return null before reaching the
    // truncation check so we do not allocate 100 MiB.
    expect(parseId3v2(header)).toBeNull();
  });
});

describe('serializeId3v2', () => {
  it('produces valid ID3 magic', () => {
    const tag = {
      version: [4, 0] as [number, number],
      flags: 0,
      frames: [],
      unsynced: false,
    };
    const bytes = serializeId3v2(tag);
    expect(bytes[0]).toBe(0x49);
    expect(bytes[1]).toBe(0x44);
    expect(bytes[2]).toBe(0x33);
  });

  it('produces correct size for no-frame tag', () => {
    const tag = { version: [4, 0] as [number, number], flags: 0, frames: [], unsynced: false };
    const bytes = serializeId3v2(tag);
    expect(bytes.length).toBe(10);
  });

  it('clears unsync and footer flags on write', () => {
    const tag = {
      version: [4, 0] as [number, number],
      flags: 0x80 | 0x10, // unsync + footer bits set on input
      frames: [],
      unsynced: true,
    };
    const bytes = serializeId3v2(tag);
    expect(bytes[5]! & 0x80).toBe(0); // unsync cleared
    expect(bytes[5]! & 0x10).toBe(0); // footer cleared
  });

  it('round-trips a tag with multiple frames', () => {
    const frame1 = buildId3v2Frame('TIT2', new Uint8Array([0x00, 0x41, 0x42]));
    const frame2 = buildId3v2Frame('TPE1', new Uint8Array([0x00, 0x43]));
    const body = concatBytes(frame1, frame2);
    const tagBytes = buildMinimalId3v2(body.length);
    tagBytes.set(body, 10);

    const parsed1 = parseId3v2(tagBytes)!;
    const serialized = serializeId3v2(parsed1.tag);
    const parsed2 = parseId3v2(serialized)!;

    expect(parsed2.tag.frames.length).toBe(parsed1.tag.frames.length);
    for (let i = 0; i < parsed1.tag.frames.length; i++) {
      expect(parsed2.tag.frames[i]!.id).toBe(parsed1.tag.frames[i]!.id);
      expect(parsed2.tag.frames[i]!.data).toEqual(parsed1.tag.frames[i]!.data);
    }
  });
});

describe('encodeUnsynchronisation', () => {
  it('returns same buffer when no 0xFF bytes present', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02]);
    const result = encodeUnsynchronisation(data);
    expect(result).toEqual(data);
  });

  it('inserts 0x00 after each 0xFF', () => {
    const data = new Uint8Array([0xff, 0xfe]);
    const result = encodeUnsynchronisation(data);
    expect(result).toEqual(new Uint8Array([0xff, 0x00, 0xfe]));
  });

  it('handles multiple 0xFF bytes', () => {
    const data = new Uint8Array([0xff, 0xff]);
    const result = encodeUnsynchronisation(data);
    expect(result).toEqual(new Uint8Array([0xff, 0x00, 0xff, 0x00]));
  });

  it('round-trips with decode (removeUnsynchronisation)', () => {
    // Verify that decode in parseId3v2 inverts encodeUnsynchronisation.
    // original = logical frame data (no 0xFF bytes for simplicity here)
    const original = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    // Build the frame with the original data (no unsync needed since no 0xFF).
    const preUnsyncFrame = buildId3v2Frame('PRIV', original);
    // Apply unsync to entire body.
    const unsyncedBody = encodeUnsynchronisation(preUnsyncFrame);
    const ss = makeSynchsafe(unsyncedBody.length);
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 4;
    header[4] = 0;
    header[5] = 0x80; // unsync flag
    header.set(ss, 6);
    const tag = concatBytes(header, unsyncedBody);

    const result = parseId3v2(tag)!;
    expect(result.tag.frames[0]!.data).toEqual(original);
  });
});
