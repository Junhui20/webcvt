/**
 * Tests for parseWav — the RIFF/WAV demuxer.
 *
 * Tests marked "fixture" load real WAV files from tests/fixtures/audio/.
 * Tests marked "synthetic" build minimal WAV bytes inline.
 */

import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { assertBytesEqual, hex } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { UnsupportedSubFormatError, WavFormatError, WavTooLargeError } from './errors.ts';
import { WAVE_FORMAT_EXTENSIBLE, WAVE_FORMAT_IEEE_FLOAT, WAVE_FORMAT_PCM } from './header.ts';
import { parseWav } from './parser.ts';

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------

describe('parseWav — fixture: sine-1s-44100-mono.wav', () => {
  it('parses sampleRate, channels, bitsPerSample correctly', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.wav');
    const wav = parseWav(bytes);
    expect(wav.format.sampleRate).toBe(44100);
    expect(wav.format.channels).toBe(1);
    expect(wav.format.bitsPerSample).toBe(16);
    expect(wav.format.audioFormat).toBe(WAVE_FORMAT_PCM);
  });

  it('produces non-empty audioData of correct byte length', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.wav');
    const wav = parseWav(bytes);
    // 1s * 44100 samples/s * 1 channel * 2 bytes/sample = 88200 bytes
    expect(wav.audioData.length).toBe(88200);
  });
});

describe('parseWav — fixture: sine-1s-48000-stereo.wav', () => {
  it('parses stereo 48000 Hz correctly', async () => {
    const bytes = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const wav = parseWav(bytes);
    expect(wav.format.sampleRate).toBe(48000);
    expect(wav.format.channels).toBe(2);
    expect(wav.format.bitsPerSample).toBe(16);
    expect(wav.format.audioFormat).toBe(WAVE_FORMAT_PCM);
  });

  it('produces non-empty audioData of correct byte length', async () => {
    const bytes = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const wav = parseWav(bytes);
    // 1s * 48000 * 2 channels * 2 bytes/sample = 192000 bytes
    expect(wav.audioData.length).toBe(192000);
  });
});

// ---------------------------------------------------------------------------
// Synthetic helper
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid 16-bit mono PCM WAV with the given audio payload.
 */
function buildWav(opts: {
  audioFormat?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  audioData?: Uint8Array;
  extraFmtBytes?: Uint8Array;
  extraChunks?: Array<{ id: string; data: Uint8Array }>;
}): Uint8Array {
  const audioFormat = opts.audioFormat ?? 1;
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 44100;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const audioData = opts.audioData ?? new Uint8Array(0);
  const extraFmtBytes = opts.extraFmtBytes ?? new Uint8Array(0);

  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const fmtSize = 16 + extraFmtBytes.length;
  const fmtBuf = new Uint8Array(fmtSize);
  const fmtView = new DataView(fmtBuf.buffer);
  fmtView.setUint16(0, audioFormat, true);
  fmtView.setUint16(2, channels, true);
  fmtView.setUint32(4, sampleRate, true);
  fmtView.setUint32(8, byteRate, true);
  fmtView.setUint16(12, blockAlign, true);
  fmtView.setUint16(14, bitsPerSample, true);
  if (extraFmtBytes.length > 0) {
    fmtBuf.set(extraFmtBytes, 16);
  }

  const parts: Uint8Array[] = [];

  // Build extra chunks
  for (const chunk of opts.extraChunks ?? []) {
    const h = new Uint8Array(8);
    const hv = new DataView(h.buffer);
    for (let i = 0; i < 4; i++) h[i] = chunk.id.charCodeAt(i);
    hv.setUint32(4, chunk.data.length, true);
    parts.push(h, chunk.data);
    if (chunk.data.length % 2 !== 0) parts.push(new Uint8Array(1));
  }

  const extraChunkBytes = concat(...parts);

  const dataPad = audioData.length % 2 !== 0 ? new Uint8Array(1) : new Uint8Array(0);

  // RIFF body size = 4 (WAVE) + 8 + fmtSize + extraChunkBytes + 8 + audioData + dataPad
  const riffBodySize =
    4 + 8 + fmtSize + extraChunkBytes.length + 8 + audioData.length + dataPad.length;

  const out = new Uint8Array(8 + riffBodySize);
  const outView = new DataView(out.buffer);

  // RIFF header
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46;
  outView.setUint32(4, riffBodySize, true);
  // WAVE
  out[8] = 0x57;
  out[9] = 0x41;
  out[10] = 0x56;
  out[11] = 0x45;

  let pos = 12;

  // fmt  chunk
  out[pos] = 0x66;
  out[pos + 1] = 0x6d;
  out[pos + 2] = 0x74;
  out[pos + 3] = 0x20;
  outView.setUint32(pos + 4, fmtSize, true);
  pos += 8;
  out.set(fmtBuf, pos);
  pos += fmtSize;

  // extra chunks
  out.set(extraChunkBytes, pos);
  pos += extraChunkBytes.length;

  // data chunk
  out[pos] = 0x64;
  out[pos + 1] = 0x61;
  out[pos + 2] = 0x74;
  out[pos + 3] = 0x61;
  outView.setUint32(pos + 4, audioData.length, true);
  pos += 8;
  out.set(audioData, pos);

  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error: bad magic
// ---------------------------------------------------------------------------

describe('parseWav — bad magic', () => {
  it('throws WavFormatError on missing RIFF magic', () => {
    const buf = new Uint8Array(44).fill(0);
    expect(() => parseWav(buf)).toThrow(WavFormatError);
  });

  it('throws WavFormatError when WAVE marker is missing', () => {
    // Build RIFF header with "XABC" instead of "WAVE"
    const buf = new Uint8Array(44);
    buf[0] = 0x52;
    buf[1] = 0x49;
    buf[2] = 0x46;
    buf[3] = 0x46; // RIFF
    new DataView(buf.buffer).setUint32(4, 36, true); // size
    buf[8] = 0x58;
    buf[9] = 0x41;
    buf[10] = 0x42;
    buf[11] = 0x43; // XABC
    expect(() => parseWav(buf)).toThrow(WavFormatError);
  });

  it('throws WavTooLargeError on RF64 header', () => {
    const buf = new Uint8Array(44);
    // "RF64"
    buf[0] = 0x52;
    buf[1] = 0x46;
    buf[2] = 0x36;
    buf[3] = 0x34;
    expect(() => parseWav(buf)).toThrow(WavTooLargeError);
  });

  it('throws WavFormatError if file is too small', () => {
    expect(() => parseWav(new Uint8Array(10))).toThrow(WavFormatError);
  });
});

// ---------------------------------------------------------------------------
// Error: missing chunks
// ---------------------------------------------------------------------------

describe('parseWav — missing required chunks', () => {
  it('throws WavFormatError when fmt  chunk is absent', () => {
    // Build RIFF/WAVE with only a data chunk (no fmt )
    const audioData = new Uint8Array(4).fill(0);
    const riffBodySize = 4 + 8 + audioData.length;
    const buf = new Uint8Array(8 + riffBodySize);
    const v = new DataView(buf.buffer);
    buf[0] = 0x52;
    buf[1] = 0x49;
    buf[2] = 0x46;
    buf[3] = 0x46; // RIFF
    v.setUint32(4, riffBodySize, true);
    buf[8] = 0x57;
    buf[9] = 0x41;
    buf[10] = 0x56;
    buf[11] = 0x45; // WAVE
    buf[12] = 0x64;
    buf[13] = 0x61;
    buf[14] = 0x74;
    buf[15] = 0x61; // data
    v.setUint32(16, audioData.length, true);
    expect(() => parseWav(buf)).toThrow(WavFormatError);
  });

  it('throws WavFormatError when data chunk is absent', () => {
    // Build a WAV with only fmt  chunk (no data)
    const fmtData = new Uint8Array(16);
    const fmtView = new DataView(fmtData.buffer);
    fmtView.setUint16(0, 1, true); // PCM
    fmtView.setUint16(2, 1, true); // channels
    fmtView.setUint32(4, 44100, true);
    fmtView.setUint32(8, 88200, true);
    fmtView.setUint16(12, 2, true);
    fmtView.setUint16(14, 16, true);

    const riffBodySize = 4 + 8 + 16;
    const buf = new Uint8Array(8 + riffBodySize);
    const v = new DataView(buf.buffer);
    buf[0] = 0x52;
    buf[1] = 0x49;
    buf[2] = 0x46;
    buf[3] = 0x46;
    v.setUint32(4, riffBodySize, true);
    buf[8] = 0x57;
    buf[9] = 0x41;
    buf[10] = 0x56;
    buf[11] = 0x45;
    buf[12] = 0x66;
    buf[13] = 0x6d;
    buf[14] = 0x74;
    buf[15] = 0x20;
    v.setUint32(16, 16, true);
    buf.set(fmtData, 20);
    expect(() => parseWav(buf)).toThrow(WavFormatError);
  });
});

// ---------------------------------------------------------------------------
// Chunk size overrun
// ---------------------------------------------------------------------------

describe('parseWav — chunk size overrun', () => {
  it('throws WavFormatError when data chunk size exceeds file length', () => {
    const wav = buildWav({ audioData: new Uint8Array(4) });
    // Corrupt the data chunk size to claim a very large size
    const v = new DataView(wav.buffer);
    // data chunk header starts at offset 44 (12 + 8 + 16 + 8 = 44)
    v.setUint32(40, 999999, true);
    expect(() => parseWav(wav)).toThrow(WavFormatError);
  });
});

// ---------------------------------------------------------------------------
// Odd-length padding
// ---------------------------------------------------------------------------

describe('parseWav — odd chunk padding', () => {
  it('reads a file with an odd-length data chunk (padding byte present)', () => {
    // Build WAV with 3 bytes of audio (odd) + 1 pad byte
    const audioData = new Uint8Array([0x01, 0x02, 0x03]);
    const wav = buildWav({ audioData, bitsPerSample: 8, channels: 1 });
    // Manually fix: add a trailing pad byte after the 3-byte data chunk
    const padded = new Uint8Array(wav.length + 1);
    padded.set(wav);
    // Also fix RIFF body size to account for the pad byte in total file length
    // (chunk size itself stays 3, but we want the parser to advance past the pad)

    const parsed = parseWav(padded);
    expect(parsed.audioData.length).toBe(3);
    expect(parsed.audioData[0]).toBe(0x01);
    expect(parsed.audioData[2]).toBe(0x03);
  });
});

// ---------------------------------------------------------------------------
// Extra / unknown chunks
// ---------------------------------------------------------------------------

describe('parseWav — extra chunk handling', () => {
  it('skips and preserves unknown chunks', () => {
    const audioData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const listData = new Uint8Array([0xab, 0xcd]);
    const wav = buildWav({
      audioData,
      extraChunks: [{ id: 'LIST', data: listData }],
    });
    const parsed = parseWav(wav);
    expect(parsed.extraChunks).toHaveLength(1);
    expect(parsed.extraChunks?.[0]?.id).toBe('LIST');
    assertBytesEqual(listData, parsed.extraChunks?.[0]?.data ?? new Uint8Array(0));
  });

  it('returns undefined extraChunks when no unknown chunks exist', () => {
    const wav = buildWav({ audioData: new Uint8Array([0x00, 0x01]) });
    const parsed = parseWav(wav);
    expect(parsed.extraChunks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 24-bit and 32-bit PCM
// ---------------------------------------------------------------------------

describe('parseWav — bit depths', () => {
  it('parses 24-bit PCM', () => {
    const audioData = new Uint8Array(6); // 2 samples × 3 bytes
    const wav = buildWav({ bitsPerSample: 24, audioData });
    const parsed = parseWav(wav);
    expect(parsed.format.bitsPerSample).toBe(24);
  });

  it('parses 32-bit PCM', () => {
    const audioData = new Uint8Array(8); // 2 samples × 4 bytes
    const wav = buildWav({ bitsPerSample: 32, audioData });
    const parsed = parseWav(wav);
    expect(parsed.format.bitsPerSample).toBe(32);
  });

  it('parses 8-bit PCM', () => {
    const audioData = new Uint8Array(4);
    const wav = buildWav({ bitsPerSample: 8, audioData });
    const parsed = parseWav(wav);
    expect(parsed.format.bitsPerSample).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// IEEE float
// ---------------------------------------------------------------------------

describe('parseWav — IEEE float (audioFormat = 3)', () => {
  it('parses IEEE float 32-bit', () => {
    const audioData = new Uint8Array(8); // 2 float32 samples
    const wav = buildWav({ audioFormat: WAVE_FORMAT_IEEE_FLOAT, bitsPerSample: 32, audioData });
    const parsed = parseWav(wav);
    expect(parsed.format.audioFormat).toBe(WAVE_FORMAT_IEEE_FLOAT);
    expect(parsed.format.bitsPerSample).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// WAVEFORMATEXTENSIBLE
// ---------------------------------------------------------------------------

describe('parseWav — WAVEFORMATEXTENSIBLE (audioFormat = 0xFFFE)', () => {
  /**
   * Build the 24-byte extension block for a WAVEFORMATEXTENSIBLE fmt  chunk.
   *
   * Layout (appended after the 16-byte base WAVEFORMAT):
   *   +0   uint16  cbSize = 22
   *   +2   uint16  wValidBitsPerSample
   *   +4   uint32  dwChannelMask
   *   +8   16 bytes SubFormat GUID
   */
  function buildExtensionBytes(
    validBits: number,
    channelMask: number,
    subTag: number, // 1=PCM, 3=IEEE float
  ): Uint8Array {
    // 24 bytes: cbSize(2) + validBits(2) + channelMask(4) + SubFormat GUID(16)
    const ext = new Uint8Array(24);
    const v = new DataView(ext.buffer);
    v.setUint16(0, 22, true); // cbSize
    v.setUint16(2, validBits, true); // wValidBitsPerSample
    v.setUint32(4, channelMask, true); // dwChannelMask
    // SubFormat GUID at ext[8..23]: 16 bytes in Windows GUID byte order:
    //   {subTag-0000-0010-8000-00AA00389B71}
    // Data1 (4B LE): subTag fills bytes [0..1], bytes [2..3] = 0x00 0x00
    v.setUint16(8, subTag, true); // Data1[0..1] LE
    // Data1[2..3]: 0x00 0x00 (already zero from new Uint8Array)
    // Data2 (2B LE): 0x0000 → ext[12..13]
    ext[12] = 0x00;
    ext[13] = 0x00;
    // Data3 (2B LE): 0x0010 → ext[14..15]
    ext[14] = 0x10;
    ext[15] = 0x00;
    // Data4 (8B BE): 80 00 00 AA 00 38 9B 71 → ext[16..23]
    ext[16] = 0x80;
    ext[17] = 0x00;
    ext[18] = 0x00;
    ext[19] = 0xaa;
    ext[20] = 0x00;
    ext[21] = 0x38;
    ext[22] = 0x9b;
    ext[23] = 0x71;
    return ext;
  }

  it('parses extensible PCM and reads channelMask', () => {
    const ext = buildExtensionBytes(16, 0x03 /* FL + FR */, WAVE_FORMAT_PCM);
    const wav = buildWav({
      audioFormat: WAVE_FORMAT_EXTENSIBLE,
      channels: 2,
      bitsPerSample: 16,
      audioData: new Uint8Array(8),
      extraFmtBytes: ext,
    });
    const parsed = parseWav(wav);
    expect(parsed.format.audioFormat).toBe(WAVE_FORMAT_EXTENSIBLE);
    expect(parsed.format.channelMask).toBe(0x03);
    expect(parsed.format.subFormat).toBeInstanceOf(Uint8Array);
    expect(parsed.format.subFormat?.length).toBe(16);
  });

  it('parses extensible IEEE float and reads channelMask', () => {
    const ext = buildExtensionBytes(32, 0x01 /* FL only */, WAVE_FORMAT_IEEE_FLOAT);
    const wav = buildWav({
      audioFormat: WAVE_FORMAT_EXTENSIBLE,
      channels: 1,
      bitsPerSample: 32,
      audioData: new Uint8Array(8),
      extraFmtBytes: ext,
    });
    const parsed = parseWav(wav);
    expect(parsed.format.audioFormat).toBe(WAVE_FORMAT_EXTENSIBLE);
    expect(parsed.format.channelMask).toBe(0x01);
  });

  it('throws UnsupportedSubFormatError for an unknown GUID', () => {
    const ext = new Uint8Array(24);
    const v = new DataView(ext.buffer);
    v.setUint16(0, 22, true); // cbSize
    v.setUint16(2, 16, true); // validBits
    v.setUint32(4, 0x03, true); // channelMask
    // Unknown subformat tag (e.g., MP3 = 85) with a non-standard GUID tail
    v.setUint16(8, 85, true); // WAVE_FORMAT_MPEGLAYER3
    // Leave rest as zeros — will fail the GUID tail check
    const wav = buildWav({
      audioFormat: WAVE_FORMAT_EXTENSIBLE,
      channels: 2,
      bitsPerSample: 16,
      audioData: new Uint8Array(8),
      extraFmtBytes: ext,
    });
    expect(() => parseWav(wav)).toThrow(UnsupportedSubFormatError);
  });
});
