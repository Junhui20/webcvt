/**
 * Tests for ADTS header bit-pack decode and encode (header.ts).
 *
 * Covers design-note test cases:
 * - extracts sample rate 44100 from sampleRateIndex == 4
 * - extracts channel_configuration == 2 for stereo (L/R)
 * - computes correct frameBytes for AAC-LC at 128 kbps
 * - reads 2-byte CRC when protection_absent == 0
 * - rejects sampleRateIndex 13 and 14 (reserved)
 * - rejects layer != 0
 */

import { describe, expect, it } from 'vitest';
import {
  AdtsInvalidLayerError,
  AdtsPceRequiredError,
  AdtsReservedSampleRateError,
  AdtsTruncatedFrameError,
} from './errors.ts';
import { encodeAdtsHeader, hasSyncAt, parseAdtsHeader } from './header.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid 7-byte ADTS header (protection_absent=1) with the
 * given parameters. All other fields are set to sensible defaults.
 */
function buildHeader(options: {
  id?: 0 | 1;
  layer?: number;
  protectionAbsent?: 0 | 1;
  profile?: number; // 0=MAIN, 1=LC, 2=SSR, 3=LTP
  sfi?: number; // sampling_frequency_index
  channelConfig?: number; // 1..7
  frameBytes?: number;
  bufferFullness?: number;
  rawBlocks?: number;
  crc?: number; // only if protectionAbsent=0
}): Uint8Array {
  const id = options.id ?? 0;
  const layer = options.layer ?? 0;
  const pa = options.protectionAbsent ?? 1;
  const profile = options.profile ?? 1; // LC
  const sfi = options.sfi ?? 4; // 44100
  const channelConfig = options.channelConfig ?? 2; // stereo
  const frameBytes = options.frameBytes ?? 100;
  const bufferFullness = options.bufferFullness ?? 0x7ff;
  const rawBlocks = options.rawBlocks ?? 0;

  const hasCrc = pa === 0;
  const headerSize = hasCrc ? 9 : 7;
  const out = new Uint8Array(headerSize);

  out[0] = 0xff;
  out[1] = 0xf0 | (id << 3) | (layer << 1) | pa;

  const channelHigh = (channelConfig >> 2) & 0x1;
  out[2] = (profile << 6) | (sfi << 2) | channelHigh;

  const channelLow = channelConfig & 0x3;
  const frameLenHigh = (frameBytes >> 11) & 0x3;
  out[3] = (channelLow << 6) | frameLenHigh;

  out[4] = (frameBytes >> 3) & 0xff;

  const frameLenLow = frameBytes & 0x7;
  const bufHigh = (bufferFullness >> 6) & 0x1f;
  out[5] = (frameLenLow << 5) | bufHigh;

  const bufLow = bufferFullness & 0x3f;
  out[6] = (bufLow << 2) | (rawBlocks & 0x3);

  if (hasCrc) {
    const crc = options.crc ?? 0xabcd;
    out[7] = (crc >> 8) & 0xff;
    out[8] = crc & 0xff;
  }

  return out;
}

// ---------------------------------------------------------------------------
// parseAdtsHeader
// ---------------------------------------------------------------------------

describe('parseAdtsHeader: basic decode', () => {
  it('extracts sample rate 44100 from sampleRateIndex == 4', () => {
    const hdr = buildHeader({ sfi: 4 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.sampleRate).toBe(44100);
    expect(h.sampleRateIndex).toBe(4);
  });

  it('extracts channel_configuration == 2 for stereo (L/R)', () => {
    const hdr = buildHeader({ channelConfig: 2 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.channelConfiguration).toBe(2);
  });

  it('decodes MPEG-4 id (id=0)', () => {
    const hdr = buildHeader({ id: 0 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.mpegVersion).toBe(4);
  });

  it('decodes MPEG-2 id (id=1)', () => {
    const hdr = buildHeader({ id: 1 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.mpegVersion).toBe(2);
  });

  it('decodes AAC-LC profile (profile=1)', () => {
    const hdr = buildHeader({ profile: 1 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.profile).toBe('LC');
  });

  it('decodes MAIN profile (profile=0)', () => {
    const hdr = buildHeader({ profile: 0 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.profile).toBe('MAIN');
  });

  it('decodes LTP profile (profile=3)', () => {
    const hdr = buildHeader({ profile: 3 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.profile).toBe('LTP');
  });

  it('computes correct frameBytes for a 13-bit span', () => {
    // frameBytes = 392 = 0x188 = 0b001_1000_1000
    // High 2 at byte3[1:0] = 0b00
    // Mid 8 at byte4 = 0b0011_0001 = 0x31
    // Low 3 at byte5[7:5] = 0b000
    // 0b00_00110001_000 = 392? Let me compute: 0 << 11 | 0x31 << 3 | 0 = 0x188 = 392
    const hdr = buildHeader({ frameBytes: 392 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.frameBytes).toBe(392);
  });

  it('decodes max frameBytes (8191 = 0x1FFF)', () => {
    const hdr = buildHeader({ frameBytes: 8191 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.frameBytes).toBe(8191);
  });

  it('reads VBR bufferFullness (0x7FF)', () => {
    const hdr = buildHeader({ bufferFullness: 0x7ff });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.bufferFullness).toBe(0x7ff);
  });

  it('reads hasCrc=false when protection_absent=1', () => {
    const hdr = buildHeader({ protectionAbsent: 1 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.hasCrc).toBe(false);
    expect(h.crc).toBeUndefined();
  });

  it('reads 2-byte CRC when protection_absent==0 (hasCrc=true)', () => {
    const hdr = buildHeader({ protectionAbsent: 0, crc: 0x1234 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.hasCrc).toBe(true);
    expect(h.crc).toBe(0x1234);
  });

  it('reads rawBlocks field correctly', () => {
    const hdr = buildHeader({ rawBlocks: 0 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.rawBlocks).toBe(0);
  });
});

describe('parseAdtsHeader: channel_configuration high-channel encoding', () => {
  it('decodes channelConfig=4 (C/L/R/Cs) which spans the high bit', () => {
    // channelConfig=4: binary 100 -> channelHigh=1, channelLow=00
    const hdr = buildHeader({ channelConfig: 4 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.channelConfiguration).toBe(4);
  });

  it('decodes channelConfig=7 (7.1 surround)', () => {
    const hdr = buildHeader({ channelConfig: 7 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.channelConfiguration).toBe(7);
  });

  it('decodes channelConfig=1 (mono)', () => {
    const hdr = buildHeader({ channelConfig: 1 });
    const h = parseAdtsHeader(hdr, 0);
    expect(h.channelConfiguration).toBe(1);
  });
});

describe('parseAdtsHeader: error cases', () => {
  it('throws AdtsInvalidLayerError when layer != 0', () => {
    const hdr = buildHeader({ layer: 2 });
    expect(() => parseAdtsHeader(hdr, 0)).toThrow(AdtsInvalidLayerError);
  });

  // H-1: OOB read guard — 7-byte buffer with protection_absent=0 (CRC expected at bytes 7-8)
  it('throws AdtsTruncatedFrameError on 7-byte buffer with protection_absent=0 (H-1)', () => {
    // protection_absent=0 means CRC present, requiring 9 bytes; 7 bytes is too short.
    const buf = new Uint8Array(7);
    buf[0] = 0xff;
    buf[1] = 0xf0; // sync high nibble + protection_absent=0 (bit 0 clear)
    buf[2] = (1 << 6) | (4 << 2) | 0; // LC, sfi=4 (44100), channelHigh=0
    buf[3] = (1 << 6) | 0; // channelLow=01 (mono), frameLenHigh=0
    buf[4] = (9 >> 3) & 0xff; // frameBytes=9 (min for 9-byte header, 0 payload)
    buf[5] = ((9 & 0x7) << 5) | 0x1f;
    buf[6] = 0xfc; // VBR, rawBlocks=0
    expect(() => parseAdtsHeader(buf, 0)).toThrow(AdtsTruncatedFrameError);
  });

  // H-1: OOB read guard — 8-byte buffer with protection_absent=0
  it('throws AdtsTruncatedFrameError on 8-byte buffer with protection_absent=0 (H-1)', () => {
    const buf = new Uint8Array(8);
    buf[0] = 0xff;
    buf[1] = 0xf0; // protection_absent=0
    buf[2] = (1 << 6) | (4 << 2) | 0;
    buf[3] = (1 << 6) | 0;
    buf[4] = (9 >> 3) & 0xff;
    buf[5] = ((9 & 0x7) << 5) | 0x1f;
    buf[6] = 0xfc;
    buf[7] = 0xab; // only 1 of the 2 CRC bytes present
    expect(() => parseAdtsHeader(buf, 0)).toThrow(AdtsTruncatedFrameError);
  });

  it('throws AdtsReservedSampleRateError for sampleRateIndex=13', () => {
    const hdr = buildHeader({ sfi: 13 });
    expect(() => parseAdtsHeader(hdr, 0)).toThrow(AdtsReservedSampleRateError);
  });

  it('throws AdtsReservedSampleRateError for sampleRateIndex=14', () => {
    const hdr = buildHeader({ sfi: 14 });
    expect(() => parseAdtsHeader(hdr, 0)).toThrow(AdtsReservedSampleRateError);
  });

  it('throws AdtsReservedSampleRateError for sampleRateIndex=15 (explicit rate)', () => {
    const hdr = buildHeader({ sfi: 15 });
    expect(() => parseAdtsHeader(hdr, 0)).toThrow(AdtsReservedSampleRateError);
  });

  it('throws AdtsPceRequiredError when channelConfig=0', () => {
    // channelConfig=0: PCE-defined — must throw
    // Build manually to bypass the helper's default guard
    const out = new Uint8Array(7);
    out[0] = 0xff;
    out[1] = 0xf1; // id=0, layer=0, protection_absent=1
    // profile=01(LC), sfi=0100(44100), private=0, channelHigh=0
    out[2] = (1 << 6) | (4 << 2) | 0;
    // channelLow=00 (total channel=0), frameLenHigh=0
    out[3] = 0x00;
    out[4] = (100 >> 3) & 0xff;
    out[5] = ((100 & 0x7) << 5) | 0x1f;
    out[6] = (0x3f << 2) | 0;
    expect(() => parseAdtsHeader(out, 0)).toThrow(AdtsPceRequiredError);
  });
});

// ---------------------------------------------------------------------------
// encodeAdtsHeader
// ---------------------------------------------------------------------------

describe('encodeAdtsHeader: round-trip', () => {
  it('encodes a 7-byte header (no CRC) and parses it back identically', () => {
    const hdr = buildHeader({ sfi: 4, channelConfig: 2, frameBytes: 392, bufferFullness: 0x7ff });
    const original = parseAdtsHeader(hdr, 0);
    const encoded = encodeAdtsHeader(original, 392 - 7);
    const decoded = parseAdtsHeader(encoded, 0);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channelConfiguration).toBe(2);
    expect(decoded.bufferFullness).toBe(0x7ff);
    expect(decoded.hasCrc).toBe(false);
  });

  it('encodes a 9-byte header (with CRC) and parses it back with correct CRC', () => {
    const hdr = buildHeader({ protectionAbsent: 0, crc: 0xbeef });
    const original = parseAdtsHeader(hdr, 0);
    const encoded = encodeAdtsHeader(original, 100 - 9);
    const decoded = parseAdtsHeader(encoded, 0);
    expect(decoded.hasCrc).toBe(true);
    expect(decoded.crc).toBe(0xbeef);
  });

  it('preserves all sample rates via encode/decode round-trip', () => {
    const sfis = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const expectedRates = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
    ];
    for (let i = 0; i < sfis.length; i++) {
      const sfi = sfis[i] as number;
      const hdr = buildHeader({ sfi });
      const parsed = parseAdtsHeader(hdr, 0);
      const encoded = encodeAdtsHeader(parsed, 93);
      const reparsed = parseAdtsHeader(encoded, 0);
      expect(reparsed.sampleRate).toBe(expectedRates[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// hasSyncAt
// ---------------------------------------------------------------------------

describe('hasSyncAt', () => {
  it('returns true for 0xFF 0xF0 (sync word)', () => {
    const buf = new Uint8Array([0xff, 0xf0]);
    expect(hasSyncAt(buf, 0)).toBe(true);
  });

  it('returns true for 0xFF 0xF1 (protection_absent=1)', () => {
    const buf = new Uint8Array([0xff, 0xf1]);
    expect(hasSyncAt(buf, 0)).toBe(true);
  });

  it('returns false for 0xFF 0x00 (no sync)', () => {
    const buf = new Uint8Array([0xff, 0x00]);
    expect(hasSyncAt(buf, 0)).toBe(false);
  });

  it('returns false when at last byte (insufficient bytes)', () => {
    const buf = new Uint8Array([0xff]);
    expect(hasSyncAt(buf, 0)).toBe(false);
  });

  it('returns false for offset beyond bounds', () => {
    const buf = new Uint8Array([0xff, 0xf1]);
    expect(hasSyncAt(buf, 2)).toBe(false);
  });
});
