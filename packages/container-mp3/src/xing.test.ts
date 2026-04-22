import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { parseMp3FrameHeader } from './frame-header.ts';
import { parseXingHeader } from './xing.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrameHeader(opts: {
  version?: 0b11 | 0b10 | 0b00;
  channelMode?: 0b11 | 0b00;
  bitrateIdx?: number;
  srIdx?: number;
}): Uint8Array {
  const version = opts.version ?? 0b11;
  const channelMode = opts.channelMode ?? 0b11; // mono
  const bitrateIdx = opts.bitrateIdx ?? 9;
  const srIdx = opts.srIdx ?? 0;

  const word =
    (0x7ff << 21) |
    (version << 19) |
    (0b01 << 17) | // Layer III
    (1 << 16) | // no CRC
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

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseXingHeader', () => {
  it('returns null when no Xing/Info/VBRI signature found', () => {
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({}), 0);
    const header = parseMp3FrameHeader(frameData, 0)!;
    expect(parseXingHeader(frameData, header)).toBeNull();
  });

  it('detects Info header (CBR variant) and reads flags', () => {
    // MPEG-1 mono: Xing/Info at offset 4 + 17 = 21
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b11, channelMode: 0b11 }), 0);
    const xingOff = 21;
    // Write "Info" magic
    frameData[xingOff] = 0x49;
    frameData[xingOff + 1] = 0x6e;
    frameData[xingOff + 2] = 0x66;
    frameData[xingOff + 3] = 0x6f;
    // Flags: 0x0F (all fields present)
    writeUint32BE(frameData, xingOff + 4, 0x0f);
    // numFrames
    writeUint32BE(frameData, xingOff + 8, 40);
    // numBytes
    writeUint32BE(frameData, xingOff + 12, 17135);
    // TOC (100 bytes) — fill with 0
    // quality
    writeUint32BE(frameData, xingOff + 8 + 4 + 4 + 100, 0);

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('Info');
    expect(xing!.totalFrames).toBe(40);
    expect(xing!.totalBytes).toBe(17135);
    expect(xing!.toc).toBeDefined();
    expect(xing!.toc!.length).toBe(100);
    expect(xing!.qualityIndicator).toBe(0);
  });

  it('detects Xing header (VBR variant)', () => {
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b11, channelMode: 0b00 }), 0); // stereo
    const xingOff = 36; // MPEG-1 stereo: 4+32=36
    frameData[xingOff] = 0x58;
    frameData[xingOff + 1] = 0x69;
    frameData[xingOff + 2] = 0x6e;
    frameData[xingOff + 3] = 0x67;
    writeUint32BE(frameData, xingOff + 4, 0x01); // only numFrames flag
    writeUint32BE(frameData, xingOff + 8, 200);

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('Xing');
    expect(xing!.totalFrames).toBe(200);
    expect(xing!.totalBytes).toBeUndefined();
    expect(xing!.toc).toBeUndefined();
  });

  it('detects Xing at MPEG-2 stereo offset (4+17=21)', () => {
    // MPEG-2 (version bits 0b10) stereo: side-info = 17 bytes → Xing at offset 21.
    // Must NOT be confused with the MPEG-1 mono case (also offset 21, different version bits).
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b10, channelMode: 0b00 }), 0); // MPEG-2 stereo
    const xingOff = 21; // 4 header + 17 side info
    frameData[xingOff] = 0x58; // "Xing"
    frameData[xingOff + 1] = 0x69;
    frameData[xingOff + 2] = 0x6e;
    frameData[xingOff + 3] = 0x67;
    writeUint32BE(frameData, xingOff + 4, 0x03); // FRAMES | BYTES flags
    writeUint32BE(frameData, xingOff + 8, 777); // numFrames
    writeUint32BE(frameData, xingOff + 12, 54321); // numBytes

    const header = parseMp3FrameHeader(frameData, 0)!;
    expect(header.version).toBe('2');
    expect(header.channelMode).toBe('stereo');

    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('Xing');
    expect(xing!.totalFrames).toBe(777);
    expect(xing!.totalBytes).toBe(54321);
  });

  it('detects Xing at MPEG-2 mono offset (4+9=13)', () => {
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b10, channelMode: 0b11 }), 0); // MPEG-2 mono
    const xingOff = 13; // MPEG-2 mono: 4+9=13
    frameData[xingOff] = 0x58;
    frameData[xingOff + 1] = 0x69;
    frameData[xingOff + 2] = 0x6e;
    frameData[xingOff + 3] = 0x67;
    writeUint32BE(frameData, xingOff + 4, 0x00); // no flags

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('Xing');
  });

  it('detects VBRI header at fixed offset 32', () => {
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({}), 0);
    const vbriOff = 32;
    frameData[vbriOff] = 0x56;
    frameData[vbriOff + 1] = 0x42;
    frameData[vbriOff + 2] = 0x52;
    frameData[vbriOff + 3] = 0x49;
    // version (2), delay (2), quality (2), numBytes (4), numFrames (4)
    frameData[vbriOff + 4] = 0x00;
    frameData[vbriOff + 5] = 0x01; // version 1
    frameData[vbriOff + 6] = 0x00;
    frameData[vbriOff + 7] = 0x00; // delay 0
    frameData[vbriOff + 8] = 0x00;
    frameData[vbriOff + 9] = 0x64; // quality 100
    writeUint32BE(frameData, vbriOff + 10, 99999); // numBytes
    writeUint32BE(frameData, vbriOff + 14, 500); // numFrames

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('VBRI');
    expect(xing!.totalFrames).toBe(500);
    expect(xing!.totalBytes).toBe(99999);
  });

  it('detects LAME extension after Xing/Info header', () => {
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b11, channelMode: 0b11 }), 0); // MPEG-1 mono
    const xingOff = 21;
    // Write "Info"
    frameData[xingOff] = 0x49;
    frameData[xingOff + 1] = 0x6e;
    frameData[xingOff + 2] = 0x66;
    frameData[xingOff + 3] = 0x6f;
    writeUint32BE(frameData, xingOff + 4, 0x0f); // all flags
    writeUint32BE(frameData, xingOff + 8, 40); // numFrames
    writeUint32BE(frameData, xingOff + 12, 1000); // numBytes
    // skip 100 TOC + 4 quality = 104 bytes
    const lameOff = xingOff + 8 + 4 + 4 + 100 + 4;
    // Write "Lavc60.31"
    const lameStr = 'Lavc60.31';
    for (let i = 0; i < lameStr.length; i++) {
      frameData[lameOff + i] = lameStr.charCodeAt(i);
    }

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing!.lame).toBeDefined();
    expect(xing!.lame!.encoderString).toBe('Lavc60.31');
  });

  it('detects LAME extension when encoder string starts with "Lame" prefix', () => {
    // This covers the matchMagic(frameData, cursor, LAME_MAGIC) === true branch
    // (parseLameExtension path), distinct from the "Lavc" else-if path.
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b11, channelMode: 0b11 }), 0); // MPEG-1 mono
    const xingOff = 21;
    // Write "Info"
    frameData[xingOff] = 0x49;
    frameData[xingOff + 1] = 0x6e;
    frameData[xingOff + 2] = 0x66;
    frameData[xingOff + 3] = 0x6f;
    writeUint32BE(frameData, xingOff + 4, 0x0f); // all flags
    writeUint32BE(frameData, xingOff + 8, 10); // numFrames
    writeUint32BE(frameData, xingOff + 12, 5000); // numBytes
    // skip 100 TOC + 4 quality = 104 bytes
    const lameOff = xingOff + 8 + 4 + 4 + 100 + 4;
    // Write "Lame3.99" — starts with the 4-byte LAME_MAGIC "Lame"
    const lameStr = 'Lame3.99';
    for (let i = 0; i < lameStr.length; i++) {
      frameData[lameOff + i] = lameStr.charCodeAt(i);
    }

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.lame).toBeDefined();
    expect(xing!.lame!.encoderString).toBe('Lame3.99');
  });

  it('returns undefined lame when encoder bytes are all null (no encoder string)', () => {
    // Covers the else-if branch where cursor+9 fits but readAsciiUntilNull returns ''
    const frameData = new Uint8Array(500);
    frameData.set(makeFrameHeader({ version: 0b11, channelMode: 0b11 }), 0);
    const xingOff = 21;
    frameData[xingOff] = 0x58; // "Xing"
    frameData[xingOff + 1] = 0x69;
    frameData[xingOff + 2] = 0x6e;
    frameData[xingOff + 3] = 0x67;
    writeUint32BE(frameData, xingOff + 4, 0x00); // no flags → cursor stops right after flags word
    // cursor after flags word = xingOff + 8; bytes at that position are 0x00 (zero-filled)
    // "Lame" magic won't match; readAsciiUntilNull will return '' (first byte is null)
    // → lame must be undefined

    const header = parseMp3FrameHeader(frameData, 0)!;
    const xing = parseXingHeader(frameData, header);
    expect(xing).not.toBeNull();
    expect(xing!.lame).toBeUndefined();
  });

  // --- Security regression: Fix 6 — matchMagic bounds check ---

  it('matchMagic returns false (no crash) when offset + magic.length exceeds buffer', () => {
    // The matchMagic function now checks bounds before indexing. Verify this by
    // constructing a frame that causes parseXingHeader to call matchMagic with
    // an offset near the end of the buffer where the 4-byte magic would overflow.
    //
    // Use MPEG-1 mono (Xing offset = 21). Place the frame data so it is only
    // 22 bytes — just enough that offset 21 exists but offset 21+4=25 does not.
    // The call `matchMagic(buf, 21, XING_MAGIC)` must return false (not throw).
    const frameData = new Uint8Array(22); // too short for magic at offset 21
    frameData.set(
      (() => {
        const word =
          (0x7ff << 21) |
          (0b11 << 19) | // MPEG-1
          (0b01 << 17) | // Layer III
          (1 << 16) |
          (9 << 12) | // 128 kbps
          (0 << 10) | // 44100 Hz
          (0b11 << 6); // mono
        const b = new Uint8Array(4);
        b[0] = (word >>> 24) & 0xff;
        b[1] = (word >>> 16) & 0xff;
        b[2] = (word >>> 8) & 0xff;
        b[3] = word & 0xff;
        return b;
      })(),
      0,
    );
    const header = parseMp3FrameHeader(frameData, 0)!;
    // parseXingHeader must return null without throwing a RangeError.
    expect(() => parseXingHeader(frameData, header)).not.toThrow();
    expect(parseXingHeader(frameData, header)).toBeNull();
  });

  it('parses the real fixture Xing/Info header', async () => {
    const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
    // Xing frame is at offset 45, after the 45-byte ID3v2 tag.
    const XING_FRAME_OFFSET = 45;
    const header = parseMp3FrameHeader(data, XING_FRAME_OFFSET)!;
    const frameData = data.subarray(XING_FRAME_OFFSET, XING_FRAME_OFFSET + header.frameBytes);
    const xing = parseXingHeader(frameData, header);

    expect(xing).not.toBeNull();
    expect(xing!.kind).toBe('Info');
    expect(xing!.totalFrames).toBe(40);
    expect(xing!.totalBytes).toBe(17135);
    expect(xing!.toc).toHaveLength(100);
    expect(xing!.qualityIndicator).toBe(0);
    expect(xing!.lame).toBeDefined();
    expect(xing!.lame!.encoderString).toContain('Lavc60');
  });
});
