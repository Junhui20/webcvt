/**
 * Tests for boxes/mvhd-tkhd-mdhd.ts — versioned time-field boxes.
 *
 * Design note test cases covered:
 *   - "decodes mvhd and tkhd version 0 (32-bit time fields)"
 *   - "decodes mvhd and tkhd version 1 (64-bit time fields)"
 */

import { describe, expect, it } from 'vitest';
import { Mp4InvalidBoxError } from '../errors.ts';
import {
  parseMdhd,
  parseMvhd,
  parseTkhd,
  serializeMdhd,
  serializeMvhd,
  serializeTkhd,
} from './mvhd-tkhd-mdhd.ts';

// ---------------------------------------------------------------------------
// mvhd helpers
// ---------------------------------------------------------------------------

function buildMvhdV0(timescale: number, duration: number, nextTrackId: number): Uint8Array {
  // version=0: 4+4+4+4+4 + 4+2+10+36+24+4 = 100 bytes
  const out = new Uint8Array(100);
  const view = new DataView(out.buffer);
  // version=0, flags=0 at 0
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  view.setUint32(20, 0x00010000, false); // rate
  view.setUint16(24, 0x0100, false); // volume
  // identity matrix at 36
  view.setUint32(36, 0x00010000, false);
  view.setUint32(52, 0x00010000, false);
  view.setUint32(68, 0x40000000, false);
  view.setUint32(96, nextTrackId, false);
  return out;
}

function buildMvhdV1(timescale: number, duration: number, nextTrackId: number): Uint8Array {
  // version=1: 4+8+8+4+8 + 4+2+10+36+24+4 = 112 bytes
  const out = new Uint8Array(112);
  const view = new DataView(out.buffer);
  out[0] = 1; // version=1
  // creation_time at 4 (u64), modification_time at 12 (u64) = zeros
  view.setUint32(20, timescale, false);
  // duration at 24 (u64)
  const hi = Math.floor(duration / 0x100000000);
  const lo = duration >>> 0;
  view.setUint32(24, hi, false);
  view.setUint32(28, lo, false);
  view.setUint32(108, nextTrackId, false);
  return out;
}

// ---------------------------------------------------------------------------
// mvhd tests
// ---------------------------------------------------------------------------

describe('parseMvhd', () => {
  it('decodes mvhd version 0 (32-bit time fields)', () => {
    const payload = buildMvhdV0(44100, 44100 * 5, 2);
    const hdr = parseMvhd(payload);
    expect(hdr.version).toBe(0);
    expect(hdr.timescale).toBe(44100);
    expect(hdr.duration).toBe(44100 * 5);
    expect(hdr.nextTrackId).toBe(2);
  });

  it('decodes mvhd version 1 (64-bit time fields)', () => {
    const payload = buildMvhdV1(1000, 5000, 2);
    const hdr = parseMvhd(payload);
    expect(hdr.version).toBe(1);
    expect(hdr.timescale).toBe(1000);
    expect(hdr.duration).toBe(5000);
    expect(hdr.nextTrackId).toBe(2);
  });

  it('throws Mp4InvalidBoxError for truncated payload', () => {
    expect(() => parseMvhd(new Uint8Array(3))).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for v0 payload that is too short', () => {
    expect(() => parseMvhd(new Uint8Array(10))).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseMvhd — Q-H-2 unsupported version', () => {
  it('throws Mp4InvalidBoxError when version byte is 2 (not 0 or 1)', () => {
    const payload = new Uint8Array(100);
    payload[0] = 2; // unsupported version
    expect(() => parseMvhd(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeMvhd', () => {
  it('round-trips version 0 correctly', () => {
    const original = { version: 0 as const, timescale: 1000, duration: 5000, nextTrackId: 2 };
    const bytes = serializeMvhd(original);
    const parsed = parseMvhd(bytes);
    expect(parsed.timescale).toBe(1000);
    expect(parsed.duration).toBe(5000);
    expect(parsed.nextTrackId).toBe(2);
    expect(parsed.version).toBe(0);
  });

  it('round-trips version 1 correctly', () => {
    const original = { version: 1 as const, timescale: 44100, duration: 441000, nextTrackId: 3 };
    const bytes = serializeMvhd(original);
    const parsed = parseMvhd(bytes);
    expect(parsed.timescale).toBe(44100);
    expect(parsed.duration).toBe(441000);
    expect(parsed.nextTrackId).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// tkhd helpers
// ---------------------------------------------------------------------------

function buildTkhdV0(trackId: number, duration: number, volume: number): Uint8Array {
  // version=0: 4+4+4+4+4+4+8+2+2+2+2+36+4+4 = 84 bytes
  const out = new Uint8Array(84);
  const view = new DataView(out.buffer);
  // version=0, flags=0x000003 (enabled + in_movie)
  out[3] = 0x03;
  view.setUint32(12, trackId, false);
  view.setUint32(20, duration, false);
  view.setInt16(36, volume, false);
  return out;
}

function buildTkhdV1(trackId: number, duration: number): Uint8Array {
  // version=1: 4+8+8+4+4+8+8+2+2+2+2+36+4+4 = 96 bytes
  const out = new Uint8Array(96);
  const view = new DataView(out.buffer);
  out[0] = 1; // version=1
  out[3] = 0x03; // flags
  view.setUint32(20, trackId, false);
  const hi = Math.floor(duration / 0x100000000);
  const lo = duration >>> 0;
  view.setUint32(28, hi, false);
  view.setUint32(32, lo, false);
  return out;
}

// ---------------------------------------------------------------------------
// tkhd tests
// ---------------------------------------------------------------------------

describe('parseTkhd', () => {
  it('decodes tkhd version 0 (32-bit time fields)', () => {
    const payload = buildTkhdV0(1, 44100, 0x0100);
    const hdr = parseTkhd(payload);
    expect(hdr.version).toBe(0);
    expect(hdr.trackId).toBe(1);
    expect(hdr.duration).toBe(44100);
    expect(hdr.volume).toBe(0x0100);
  });

  it('decodes tkhd version 1 (64-bit time fields)', () => {
    const payload = buildTkhdV1(2, 88200);
    const hdr = parseTkhd(payload);
    expect(hdr.version).toBe(1);
    expect(hdr.trackId).toBe(2);
    expect(hdr.duration).toBe(88200);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseTkhd(new Uint8Array(3))).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeTkhd', () => {
  it('round-trips version 0 correctly', () => {
    const original = { version: 0 as const, flags: 3, trackId: 1, duration: 1000, volume: 0x0100 };
    const bytes = serializeTkhd(original);
    const parsed = parseTkhd(bytes);
    expect(parsed.trackId).toBe(1);
    expect(parsed.duration).toBe(1000);
    expect(parsed.volume).toBe(0x0100);
  });

  it('round-trips version 1 correctly', () => {
    const original = {
      version: 1 as const,
      flags: 3,
      trackId: 2,
      duration: 0x1_0000_0001,
      volume: 0,
    };
    const bytes = serializeTkhd(original);
    const parsed = parseTkhd(bytes);
    expect(parsed.version).toBe(1);
    expect(parsed.trackId).toBe(2);
    expect(parsed.duration).toBe(0x1_0000_0001);
  });
});

// ---------------------------------------------------------------------------
// mdhd helpers
// ---------------------------------------------------------------------------

function buildMdhdV0(timescale: number, duration: number, lang: string): Uint8Array {
  // version=0: 4+4+4+4+4+2+2 = 24 bytes
  const out = new Uint8Array(24);
  const view = new DataView(out.buffer);
  // version=0
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  // Pack language.
  const a = (lang.charCodeAt(0) & 0xff) - 0x60;
  const b = (lang.charCodeAt(1) & 0xff) - 0x60;
  const c = (lang.charCodeAt(2) & 0xff) - 0x60;
  view.setUint16(20, ((a & 0x1f) << 10) | ((b & 0x1f) << 5) | (c & 0x1f), false);
  return out;
}

// ---------------------------------------------------------------------------
// mdhd tests
// ---------------------------------------------------------------------------

describe('parseTkhd — Q-H-2 unsupported version', () => {
  it('throws Mp4InvalidBoxError when version byte is 2 (not 0 or 1)', () => {
    const payload = new Uint8Array(96);
    payload[0] = 2; // unsupported version
    expect(() => parseTkhd(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseTkhd — additional error paths', () => {
  it('throws Mp4InvalidBoxError for v1 payload that is too short', () => {
    const short = new Uint8Array(10);
    short[0] = 1; // version=1
    expect(() => parseTkhd(short)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for v0 payload that is too short', () => {
    const short = new Uint8Array(10);
    short[0] = 0; // version=0
    expect(() => parseTkhd(short)).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseMdhd', () => {
  it('decodes mdhd version 0 with timescale 44100 and language "und"', () => {
    const payload = buildMdhdV0(44100, 44100, 'und');
    const hdr = parseMdhd(payload);
    expect(hdr.version).toBe(0);
    expect(hdr.timescale).toBe(44100);
    expect(hdr.duration).toBe(44100);
    expect(hdr.language).toBe('und');
  });

  it('decodes mdhd version 0 with language "eng"', () => {
    const payload = buildMdhdV0(48000, 48000 * 2, 'eng');
    const hdr = parseMdhd(payload);
    expect(hdr.language).toBe('eng');
    expect(hdr.timescale).toBe(48000);
  });

  it('decodes mdhd version 1 (64-bit time fields)', () => {
    // version=1: 4 + 8+8+4+8 + 2+2 = 36 bytes
    const out = new Uint8Array(36);
    const view = new DataView(out.buffer);
    out[0] = 1; // version=1
    view.setUint32(20, 48000, false); // timescale
    // duration = 0x1_0000_0002
    view.setUint32(24, 1, false);
    view.setUint32(28, 2, false);
    // language 'eng' packed
    const e = 0x65 - 0x60;
    const n = 0x6e - 0x60;
    const g = 0x67 - 0x60;
    view.setUint16(32, ((e & 0x1f) << 10) | ((n & 0x1f) << 5) | (g & 0x1f), false);
    const hdr = parseMdhd(out);
    expect(hdr.version).toBe(1);
    expect(hdr.timescale).toBe(48000);
    expect(hdr.duration).toBe(0x1_0000_0002);
    expect(hdr.language).toBe('eng');
  });

  it('throws Mp4InvalidBoxError for v1 payload that is too short', () => {
    const short = new Uint8Array(10);
    short[0] = 1; // version=1
    expect(() => parseMdhd(short)).toThrow(Mp4InvalidBoxError);
  });

  it('throws Mp4InvalidBoxError for too short payload', () => {
    expect(() => parseMdhd(new Uint8Array(3))).toThrow(Mp4InvalidBoxError);
  });
});

describe('parseMdhd — Q-H-2 unsupported version', () => {
  it('throws Mp4InvalidBoxError when version byte is 2 (not 0 or 1)', () => {
    const payload = new Uint8Array(36);
    payload[0] = 2; // unsupported version
    expect(() => parseMdhd(payload)).toThrow(Mp4InvalidBoxError);
  });
});

describe('serializeMdhd', () => {
  it('round-trips version 0 correctly with timescale 44100', () => {
    const original = { version: 0 as const, timescale: 44100, duration: 44100, language: 'und' };
    const bytes = serializeMdhd(original);
    const parsed = parseMdhd(bytes);
    expect(parsed.timescale).toBe(44100);
    expect(parsed.duration).toBe(44100);
    expect(parsed.language).toBe('und');
  });

  it('round-trips version 1 correctly', () => {
    const original = {
      version: 1 as const,
      timescale: 48000,
      duration: 0x1_0000_0002,
      language: 'eng',
    };
    const bytes = serializeMdhd(original);
    const parsed = parseMdhd(bytes);
    expect(parsed.version).toBe(1);
    expect(parsed.timescale).toBe(48000);
    expect(parsed.duration).toBe(0x1_0000_0002);
    expect(parsed.language).toBe('eng');
  });
});
