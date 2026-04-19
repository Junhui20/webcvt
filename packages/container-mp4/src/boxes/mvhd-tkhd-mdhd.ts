/**
 * Versioned time-field boxes: mvhd, tkhd, mdhd.
 *
 * All three are FullBoxes (ISO/IEC 14496-12 §4.2) with a 1-byte version
 * and 3-byte flags prefix before their actual payload. Version 0 uses
 * 32-bit time fields; version 1 uses 64-bit (Trap §2).
 *
 * Trap §9 warning: mvhd.timescale and mdhd.timescale are DIFFERENT fields.
 * tkhd.duration is in mvhd.timescale units; mdhd.duration and all stts
 * deltas are in mdhd.timescale units. Never mix them.
 *
 * All fields are big-endian (Trap §7).
 */

import { Mp4InvalidBoxError } from '../errors.ts';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Q-H-2: Validate that the version byte of a FullBox is 0 or 1.
 * Versions 2-255 are not defined for mvhd/tkhd/mdhd and silently corrupt
 * offset calculations when cast without checking. Throw immediately.
 */
function assertVersion0Or1(payload: Uint8Array, boxType: string): 0 | 1 {
  const versionByte = payload[0] ?? 0;
  if (versionByte !== 0 && versionByte !== 1) {
    throw new Mp4InvalidBoxError(
      `${boxType} unsupported version ${versionByte}; only 0 and 1 are recognised.`,
    );
  }
  return versionByte as 0 | 1;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mp4MovieHeader {
  version: 0 | 1;
  /** Movie time units per second (e.g. 1000 or 600 in Apple legacy files). */
  timescale: number;
  /** Total movie duration in mvhd.timescale units. */
  duration: number;
  nextTrackId: number;
}

export interface Mp4TrackHeader {
  version: 0 | 1;
  /** Track-enabled and in-movie flags (bit 0 = enabled, bit 1 = in_movie). */
  flags: number;
  trackId: number;
  /** Duration in mvhd.timescale units (NOT mdhd.timescale — Trap §9). */
  duration: number;
  /** Volume in Q8.8 fixed-point (0x0100 for audio). */
  volume: number;
}

export interface Mp4MediaHeader {
  version: 0 | 1;
  /** Track time units per second. For audio, typically the sample rate (e.g. 44100). */
  timescale: number;
  /** Total track duration in mdhd.timescale units. */
  duration: number;
  /** 3-char ISO-639-2/T language tag decoded from packed u16 (e.g. 'und', 'eng'). */
  language: string;
}

// ---------------------------------------------------------------------------
// mvhd — Movie Header Box (§8.2.2)
// ---------------------------------------------------------------------------

/**
 * Parse the payload of an mvhd FullBox (including version + flags prefix).
 */
export function parseMvhd(payload: Uint8Array): Mp4MovieHeader {
  if (payload.length < 4) {
    throw new Mp4InvalidBoxError('mvhd payload too short (< 4 bytes for version+flags).');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = assertVersion0Or1(payload, 'mvhd');
  // flags are bytes 1-3 (we don't need them for mvhd)

  if (version === 1) {
    // creation_time(u64) + modification_time(u64) + timescale(u32) + duration(u64) = 28 bytes
    // + rate(u32) + volume(u16) + reserved(10) + matrix(36) + pre_defined(24) + next_track_ID(u32)
    if (payload.length < 4 + 28 + 4 + 2 + 10 + 36 + 24 + 4) {
      throw new Mp4InvalidBoxError('mvhd version=1 payload too short.');
    }
    // offset 4: creation_time u64 (skip)
    // offset 12: modification_time u64 (skip)
    // offset 20: timescale u32
    const timescale = view.getUint32(20, false);
    // offset 24: duration u64 (treat as number — safe up to 2^53)
    const durHi = view.getUint32(24, false);
    const durLo = view.getUint32(28, false);
    const duration = durHi * 0x100000000 + durLo;
    // next_track_ID is at offset 4+28+4+2+10+36+24 = 108
    const nextTrackId = view.getUint32(108, false);
    return { version: 1, timescale, duration, nextTrackId };
  }

  // version == 0
  // creation_time(u32) + modification_time(u32) + timescale(u32) + duration(u32) = 16 bytes
  if (payload.length < 4 + 16 + 4 + 2 + 10 + 36 + 24 + 4) {
    throw new Mp4InvalidBoxError('mvhd version=0 payload too short.');
  }
  // offset 4: creation_time u32 (skip)
  // offset 8: modification_time u32 (skip)
  // offset 12: timescale u32
  const timescale = view.getUint32(12, false);
  // offset 16: duration u32
  const duration = view.getUint32(16, false);
  // next_track_ID at offset 4+16+4+2+10+36+24 = 96
  const nextTrackId = view.getUint32(96, false);
  return { version: 0, timescale, duration, nextTrackId };
}

/**
 * Serialize an Mp4MovieHeader back to mvhd FullBox payload bytes.
 */
export function serializeMvhd(h: Mp4MovieHeader): Uint8Array {
  if (h.version === 1) {
    // version=1: 4 + 8+8+4+8 + 4+2+10+36+24+4 = 4+28+80 = 112 bytes
    const out = new Uint8Array(112);
    const view = new DataView(out.buffer);
    view.setUint8(0, 1); // version
    // creation_time = 0, modification_time = 0
    // timescale at offset 20
    view.setUint32(20, h.timescale, false);
    // duration at offset 24 (u64)
    const hi = Math.floor(h.duration / 0x100000000);
    const lo = h.duration >>> 0;
    view.setUint32(24, hi, false);
    view.setUint32(28, lo, false);
    // rate at offset 32: 0x00010000
    view.setUint32(32, 0x00010000, false);
    // volume at offset 36: 0x0100
    view.setUint16(36, 0x0100, false);
    // matrix identity at offset 48
    setIdentityMatrix(view, 48);
    // next_track_ID at offset 108
    view.setUint32(108, h.nextTrackId, false);
    return out;
  }

  // version=0: 4 + 4+4+4+4 + 4+2+10+36+24+4 = 4+16+80 = 100 bytes (but 4+16+4+2+10+36+24+4=100 actually)
  // Let's compute: 4(ver+flags) + 4(creation) + 4(modification) + 4(timescale) + 4(duration)
  //                + 4(rate) + 2(volume) + 10(reserved) + 36(matrix) + 24(pre_defined) + 4(next_track_id)
  //              = 4 + 16 + 4 + 2 + 10 + 36 + 24 + 4 = 100
  const out = new Uint8Array(100);
  const view = new DataView(out.buffer);
  view.setUint8(0, 0); // version = 0
  // creation_time at 4, modification_time at 8 = 0
  // timescale at offset 12
  view.setUint32(12, h.timescale, false);
  // duration at offset 16
  view.setUint32(16, h.duration, false);
  // rate at offset 20: 0x00010000
  view.setUint32(20, 0x00010000, false);
  // volume at offset 24: 0x0100
  view.setUint16(24, 0x0100, false);
  // matrix identity at offset 36
  setIdentityMatrix(view, 36);
  // next_track_ID at offset 96
  view.setUint32(96, h.nextTrackId, false);
  return out;
}

// ---------------------------------------------------------------------------
// tkhd — Track Header Box (§8.3.2)
// ---------------------------------------------------------------------------

/**
 * Parse the payload of a tkhd FullBox (including version + flags prefix).
 */
export function parseTkhd(payload: Uint8Array): Mp4TrackHeader {
  if (payload.length < 4) {
    throw new Mp4InvalidBoxError('tkhd payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = assertVersion0Or1(payload, 'tkhd');
  // flags: bytes 1-3
  const flags = ((payload[1] ?? 0) << 16) | ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);

  if (version === 1) {
    // creation_time(u64) + modification_time(u64) + track_ID(u32) + reserved(u32) + duration(u64)
    // = 8+8+4+4+8 = 32 bytes from offset 4
    if (payload.length < 4 + 32) {
      throw new Mp4InvalidBoxError('tkhd version=1 payload too short.');
    }
    const trackId = view.getUint32(20, false);
    const durHi = view.getUint32(28, false);
    const durLo = view.getUint32(32, false);
    const duration = durHi * 0x100000000 + durLo;
    // volume: skip reserved(8) + layer(2) + alternate_group(2), then volume at offset 4+32+8+2+2=48
    const volume = payload.length >= 50 ? view.getInt16(48, false) : 0;
    return { version: 1, flags, trackId, duration, volume };
  }

  // version == 0
  // creation_time(u32) + modification_time(u32) + track_ID(u32) + reserved(u32) + duration(u32)
  // = 4+4+4+4+4 = 20 bytes from offset 4
  if (payload.length < 4 + 20) {
    throw new Mp4InvalidBoxError('tkhd version=0 payload too short.');
  }
  const trackId = view.getUint32(12, false);
  const duration = view.getUint32(20, false);
  // volume at 4+20+8+2+2 = 36
  const volume = payload.length >= 38 ? view.getInt16(36, false) : 0;
  return { version: 0, flags, trackId, duration, volume };
}

/**
 * Serialize an Mp4TrackHeader to tkhd FullBox payload bytes.
 */
export function serializeTkhd(h: Mp4TrackHeader): Uint8Array {
  if (h.version === 1) {
    // 4+8+8+4+4+8+8+2+2+2+2+36+4+4 = let's compute properly
    // ver+flags(4) + creation(8) + modification(8) + trackID(4) + reserved(4) + duration(8)
    // + reserved(8) + layer(2) + alt_group(2) + volume(2) + reserved(2) + matrix(36) + width(4) + height(4)
    // = 4+8+8+4+4+8+8+2+2+2+2+36+4+4 = 96
    const out = new Uint8Array(96);
    const view = new DataView(out.buffer);
    view.setUint8(0, 1);
    view.setUint8(1, (h.flags >> 16) & 0xff);
    view.setUint8(2, (h.flags >> 8) & 0xff);
    view.setUint8(3, h.flags & 0xff);
    // creation_time=0 at 4, modification_time=0 at 12
    view.setUint32(20, h.trackId, false);
    // reserved=0 at 24
    const hi = Math.floor(h.duration / 0x100000000);
    const lo = h.duration >>> 0;
    view.setUint32(28, hi, false);
    view.setUint32(32, lo, false);
    // reserved 8 bytes at 36
    // layer at 44, alternate_group at 46
    view.setInt16(48, h.volume, false);
    // reserved at 50
    setIdentityMatrix(view, 52);
    // width=0 at 88, height=0 at 92
    return out;
  }

  // version=0
  // 4+4+4+4+4+4+8+2+2+2+2+36+4+4 = 84
  const out = new Uint8Array(84);
  const view = new DataView(out.buffer);
  view.setUint8(0, 0);
  view.setUint8(1, (h.flags >> 16) & 0xff);
  view.setUint8(2, (h.flags >> 8) & 0xff);
  view.setUint8(3, h.flags & 0xff);
  // creation_time=0 at 4, modification_time=0 at 8
  view.setUint32(12, h.trackId, false);
  // reserved=0 at 16
  view.setUint32(20, h.duration, false);
  // reserved 8 bytes at 24
  // layer at 32, alternate_group at 34
  view.setInt16(36, h.volume, false);
  // reserved at 38
  setIdentityMatrix(view, 40);
  // width=0 at 76, height=0 at 80
  return out;
}

// ---------------------------------------------------------------------------
// mdhd — Media Header Box (§8.4.2)
// ---------------------------------------------------------------------------

/**
 * Parse the payload of an mdhd FullBox (including version + flags prefix).
 */
export function parseMdhd(payload: Uint8Array): Mp4MediaHeader {
  if (payload.length < 4) {
    throw new Mp4InvalidBoxError('mdhd payload too short.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = assertVersion0Or1(payload, 'mdhd');

  if (version === 1) {
    // creation_time(u64) + modification_time(u64) + timescale(u32) + duration(u64) = 28 bytes
    if (payload.length < 4 + 28 + 2) {
      throw new Mp4InvalidBoxError('mdhd version=1 payload too short.');
    }
    const timescale = view.getUint32(20, false);
    const durHi = view.getUint32(24, false);
    const durLo = view.getUint32(28, false);
    const duration = durHi * 0x100000000 + durLo;
    const langPacked = view.getUint16(32, false);
    const language = decodeLanguage(langPacked);
    return { version: 1, timescale, duration, language };
  }

  // version == 0
  // creation_time(u32) + modification_time(u32) + timescale(u32) + duration(u32) = 16 bytes
  if (payload.length < 4 + 16 + 2) {
    throw new Mp4InvalidBoxError('mdhd version=0 payload too short.');
  }
  const timescale = view.getUint32(12, false);
  const duration = view.getUint32(16, false);
  const langPacked = view.getUint16(20, false);
  const language = decodeLanguage(langPacked);
  return { version: 0, timescale, duration, language };
}

/**
 * Serialize an Mp4MediaHeader to mdhd FullBox payload bytes.
 */
export function serializeMdhd(h: Mp4MediaHeader): Uint8Array {
  if (h.version === 1) {
    // 4 + 8+8+4+8 + 2+2 = 36
    const out = new Uint8Array(36);
    const view = new DataView(out.buffer);
    view.setUint8(0, 1);
    view.setUint32(20, h.timescale, false);
    const hi = Math.floor(h.duration / 0x100000000);
    const lo = h.duration >>> 0;
    view.setUint32(24, hi, false);
    view.setUint32(28, lo, false);
    view.setUint16(32, encodeLanguage(h.language), false);
    // pre_defined at 34: 0
    return out;
  }

  // version=0: 4 + 4+4+4+4 + 2+2 = 24
  const out = new Uint8Array(24);
  const view = new DataView(out.buffer);
  view.setUint8(0, 0);
  view.setUint32(12, h.timescale, false);
  view.setUint32(16, h.duration, false);
  view.setUint16(20, encodeLanguage(h.language), false);
  // pre_defined at 22: 0
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode ISO-639-2/T packed language code from a u16.
 * Each 5-bit group encodes one letter as (char - 0x60).
 * The top bit (bit 15) is a pad bit set to 0.
 */
function decodeLanguage(packed: number): string {
  const c1 = ((packed >> 10) & 0x1f) + 0x60;
  const c2 = ((packed >> 5) & 0x1f) + 0x60;
  const c3 = (packed & 0x1f) + 0x60;
  return String.fromCharCode(c1, c2, c3);
}

function encodeLanguage(lang: string): number {
  const a = (lang.charCodeAt(0) & 0xff) - 0x60;
  const b = (lang.charCodeAt(1) & 0xff) - 0x60;
  const c = (lang.charCodeAt(2) & 0xff) - 0x60;
  return ((a & 0x1f) << 10) | ((b & 0x1f) << 5) | (c & 0x1f);
}

/**
 * Write a 3x3 identity matrix for tkhd / mvhd at the given byte offset.
 * ISO/IEC 14496-12 matrix (Q16.16 fixed-point):
 *   [0x00010000, 0, 0,  0, 0x00010000, 0,  0, 0, 0x40000000]
 */
function setIdentityMatrix(view: DataView, offset: number): void {
  view.setUint32(offset + 0, 0x00010000, false);
  view.setUint32(offset + 4, 0, false);
  view.setUint32(offset + 8, 0, false);
  view.setUint32(offset + 12, 0, false);
  view.setUint32(offset + 16, 0x00010000, false);
  view.setUint32(offset + 20, 0, false);
  view.setUint32(offset + 24, 0, false);
  view.setUint32(offset + 28, 0, false);
  view.setUint32(offset + 32, 0x40000000, false);
}
