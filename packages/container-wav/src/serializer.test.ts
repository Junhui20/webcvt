/**
 * Tests for serializeWav — the RIFF/WAV muxer.
 *
 * Includes byte-exact round-trip checks against fixture files.
 */

import { assertBytesEqual, loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { WavFormatError } from './errors.ts';
import {
  DATA_ID,
  FMT_ID,
  RIFF_ID,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_PCM,
  WAVE_MAGIC,
  type WavFile,
  type WavFormat,
} from './header.ts';
import { parseWav } from './parser.ts';
import { serializeWav } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readU16LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(offset, true);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset, true);
}

function readFourCC(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset] ?? 0,
    buf[offset + 1] ?? 0,
    buf[offset + 2] ?? 0,
    buf[offset + 3] ?? 0,
  );
}

function makeWavFile(overrides?: Partial<WavFile>): WavFile {
  const format: WavFormat = {
    audioFormat: WAVE_FORMAT_PCM,
    channels: 1,
    sampleRate: 44100,
    bitsPerSample: 16,
    blockAlign: 2,
    byteRate: 88200,
  };
  return {
    format,
    audioData: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural / byte-level checks
// ---------------------------------------------------------------------------

describe('serializeWav — structure', () => {
  it('starts with RIFF magic', () => {
    const out = serializeWav(makeWavFile());
    expect(readFourCC(out, 0)).toBe(RIFF_ID);
  });

  it('contains WAVE form type at offset 8', () => {
    const out = serializeWav(makeWavFile());
    expect(readFourCC(out, 8)).toBe(WAVE_MAGIC);
  });

  it('contains fmt  chunk at offset 12', () => {
    const out = serializeWav(makeWavFile());
    expect(readFourCC(out, 12)).toBe(FMT_ID);
    expect(out[15]).toBe(0x20); // trailing space in "fmt "
  });

  it('data chunk appears after fmt  for a simple PCM file', () => {
    const out = serializeWav(makeWavFile());
    // fmt  chunk: 8-byte header + 16-byte body = 24 bytes; starts at 12 → ends at 36
    expect(readFourCC(out, 36)).toBe(DATA_ID);
  });

  it('RIFF chunk size = file length - 8', () => {
    const out = serializeWav(makeWavFile());
    expect(readU32LE(out, 4)).toBe(out.length - 8);
  });

  it('fmt  chunk body for PCM is 16 bytes', () => {
    const out = serializeWav(makeWavFile());
    expect(readU32LE(out, 16)).toBe(16);
  });

  it('encodes audioFormat, channels, sampleRate correctly', () => {
    const out = serializeWav(makeWavFile());
    expect(readU16LE(out, 20)).toBe(WAVE_FORMAT_PCM);
    expect(readU16LE(out, 22)).toBe(1); // channels
    expect(readU32LE(out, 24)).toBe(44100); // sampleRate
  });

  it('recomputes byteRate and blockAlign (ignores caller values)', () => {
    const file = makeWavFile();
    // Intentionally wrong values from caller
    file.format = { ...file.format, byteRate: 0, blockAlign: 0 };
    const out = serializeWav(file);
    // byteRate = 44100 * 1 * 2 = 88200
    expect(readU32LE(out, 28)).toBe(88200);
    // blockAlign = 1 * 2 = 2
    expect(readU16LE(out, 32)).toBe(2);
  });

  it('data chunk size equals audioData length', () => {
    const file = makeWavFile();
    const out = serializeWav(file);
    // data header starts at offset 36
    expect(readU32LE(out, 40)).toBe(file.audioData.length);
  });
});

// ---------------------------------------------------------------------------
// Odd-length padding
// ---------------------------------------------------------------------------

describe('serializeWav — odd-length padding', () => {
  it('pads odd data chunk with one zero byte', () => {
    const file = makeWavFile({
      audioData: new Uint8Array([0xaa, 0xbb, 0xcc]), // 3 bytes = odd
    });
    const out = serializeWav(file);
    // data chunk size field should still be 3
    expect(readU32LE(out, 40)).toBe(3);
    // total file length should be odd + 1 pad => even
    expect(out.length % 2).toBe(0);
    // pad byte at position 44+3 = 47 should be 0
    expect(out[47]).toBe(0);
  });

  it('does not pad even-length data', () => {
    const file = makeWavFile({
      audioData: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
    });
    const out = serializeWav(file);
    expect(out.length).toBe(44 + 4); // standard 44-byte header + 4 bytes data
  });
});

// ---------------------------------------------------------------------------
// Extra chunk round-trip
// ---------------------------------------------------------------------------

describe('serializeWav — extra chunk preservation', () => {
  it('writes extra chunks between fmt  and data', () => {
    const listData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const file = makeWavFile({
      audioData: new Uint8Array([0x10, 0x20]),
      extraChunks: [{ id: 'LIST', data: listData }],
    });
    const out = serializeWav(file);
    // After fmt  (offset 36), expect LIST chunk
    expect(readFourCC(out, 36)).toBe('LIST');
    expect(readU32LE(out, 40)).toBe(4);
    // data chunk follows at offset 36 + 8 + 4 = 48
    expect(readFourCC(out, 48)).toBe(DATA_ID);
  });

  it('pads odd-length extra chunks', () => {
    const oddData = new Uint8Array([0xaa, 0xbb, 0xcc]); // 3 bytes
    const file = makeWavFile({
      audioData: new Uint8Array([0x00, 0x00]),
      extraChunks: [{ id: 'JUNK', data: oddData }],
    });
    const out = serializeWav(file);
    // JUNK chunk at offset 36, size=3, body ends at 36+8+3=47, pad at 47
    expect(out[47]).toBe(0);
    // data chunk starts at offset 48
    expect(readFourCC(out, 48)).toBe(DATA_ID);
  });
});

// ---------------------------------------------------------------------------
// Extensible format
// ---------------------------------------------------------------------------

describe('serializeWav — WAVEFORMATEXTENSIBLE', () => {
  it('writes 40-byte fmt  chunk for extensible format', () => {
    const subFormat = new Uint8Array(16);
    subFormat[0] = 0x01; // PCM sub-tag LE
    const file = makeWavFile({
      format: {
        audioFormat: WAVE_FORMAT_EXTENSIBLE,
        channels: 2,
        sampleRate: 48000,
        bitsPerSample: 16,
        blockAlign: 4,
        byteRate: 192000,
        channelMask: 0x03,
        subFormat,
      },
    });
    const out = serializeWav(file);
    // fmt  size field
    expect(readU32LE(out, 16)).toBe(40);
    // audioFormat
    expect(readU16LE(out, 20)).toBe(WAVE_FORMAT_EXTENSIBLE);
    // channelMask at offset 12 + 8 + 20 = 40
    expect(readU32LE(out, 40)).toBe(0x03);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('serializeWav — validation', () => {
  it('throws WavFormatError for channels < 1', () => {
    const file = makeWavFile({
      format: { ...makeWavFile().format, channels: 0 },
    });
    expect(() => serializeWav(file)).toThrow(WavFormatError);
  });

  it('throws WavFormatError for sampleRate <= 0', () => {
    const file = makeWavFile({
      format: { ...makeWavFile().format, sampleRate: 0 },
    });
    expect(() => serializeWav(file)).toThrow(WavFormatError);
  });

  it('throws WavFormatError for invalid bitsPerSample', () => {
    const file = makeWavFile({
      format: { ...makeWavFile().format, bitsPerSample: 12 as 16 },
    });
    expect(() => serializeWav(file)).toThrow(WavFormatError);
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests with fixtures
// ---------------------------------------------------------------------------

describe('serializeWav — round-trip with fixtures', () => {
  it('round-trips sine-1s-44100-mono.wav: parse → serialize → parse produces equal format and audioData', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.wav');
    const original = parseWav(bytes);
    const rewritten = serializeWav(original);
    const reparsed = parseWav(rewritten);

    expect(reparsed.format.sampleRate).toBe(original.format.sampleRate);
    expect(reparsed.format.channels).toBe(original.format.channels);
    expect(reparsed.format.bitsPerSample).toBe(original.format.bitsPerSample);
    expect(reparsed.format.audioFormat).toBe(original.format.audioFormat);
    assertBytesEqual(original.audioData, reparsed.audioData, 'audioData mismatch after round-trip');
  });

  it('round-trips sine-1s-48000-stereo.wav: parse → serialize → parse produces equal format and audioData', async () => {
    const bytes = await loadFixture('audio/sine-1s-48000-stereo.wav');
    const original = parseWav(bytes);
    const rewritten = serializeWav(original);
    const reparsed = parseWav(rewritten);

    expect(reparsed.format.sampleRate).toBe(48000);
    expect(reparsed.format.channels).toBe(2);
    assertBytesEqual(original.audioData, reparsed.audioData, 'audioData mismatch');
  });

  it('serialize output is a valid canonical WAV (passes its own parser)', () => {
    const file = makeWavFile({
      audioData: new Uint8Array(88200 * 2), // 1s of silence at 44100 mono 16-bit
    });
    const out = serializeWav(file);
    const reparsed = parseWav(out);
    expect(reparsed.format.sampleRate).toBe(44100);
    expect(reparsed.audioData.length).toBe(88200 * 2);
  });
});

// ---------------------------------------------------------------------------
// IEEE float serialization
// ---------------------------------------------------------------------------

describe('serializeWav — IEEE float format', () => {
  it('serializes and re-parses IEEE float 32-bit', () => {
    const audioData = new Uint8Array(new Float32Array([0.5, -0.5, 0.25]).buffer);
    const file: WavFile = {
      format: {
        audioFormat: WAVE_FORMAT_IEEE_FLOAT,
        channels: 1,
        sampleRate: 44100,
        bitsPerSample: 32,
        blockAlign: 4,
        byteRate: 176400,
      },
      audioData,
    };
    const out = serializeWav(file);
    const reparsed = parseWav(out);
    expect(reparsed.format.audioFormat).toBe(WAVE_FORMAT_IEEE_FLOAT);
    assertBytesEqual(audioData, reparsed.audioData);
  });
});
