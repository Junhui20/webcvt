/**
 * Tests for tracks decode/encode (elements/tracks.ts).
 */

import type { EbmlElement } from '@catlabtech/webcvt-ebml';
import { describe, expect, it } from 'vitest';
import {
  WebmCorruptStreamError,
  WebmMultiTrackNotSupportedError,
  WebmUnsupportedCodecError,
} from '../errors.ts';
import { decodeTracks, encodeTracks } from './tracks.ts';

function concatU8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function encodeVintSize(size: number): Uint8Array {
  if (size < 127) return new Uint8Array([0x80 | size]);
  return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
}

function makeElemRaw(idBytes: Uint8Array, payload: Uint8Array): Uint8Array {
  return concatU8([idBytes, encodeVintSize(payload.length), payload]);
}

function makeUint32Elem(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, value, false);
  const idBytes =
    id >= 0x10000000
      ? new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff])
      : id >= 0x200000
        ? new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff])
        : id >= 0x4000
          ? new Uint8Array([(id >> 8) & 0xff, id & 0xff])
          : new Uint8Array([id]);
  return makeElemRaw(idBytes, payload);
}

function makeStringElem(id: number, value: string): Uint8Array {
  const payload = new TextEncoder().encode(value);
  const idBytes =
    id >= 0x4000 ? new Uint8Array([(id >> 8) & 0xff, id & 0xff]) : new Uint8Array([id]);
  return makeElemRaw(idBytes, payload);
}

function makeFloat32Elem(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setFloat32(0, value, false);
  const idBytes = new Uint8Array([id]);
  return makeElemRaw(idBytes, payload);
}

function makeMasterElem(id: number, payload: Uint8Array): Uint8Array {
  let idBytes: Uint8Array;
  if (id >= 0x10000000) {
    idBytes = new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  } else {
    idBytes = new Uint8Array([id]);
  }
  return makeElemRaw(idBytes, payload);
}

/**
 * Build a TrackEntry element for a video track.
 */
function buildVideoTrackEntry(num: number, uid: number, codecId: string): Uint8Array {
  const trackNum = makeUint32Elem(0xd7, num);
  const trackUid = makeUint32Elem(0x73c5, uid);
  const trackType = makeUint32Elem(0x83, 1);
  const codec = makeStringElem(0x86, codecId);
  const pixelWidth = makeUint32Elem(0xb0, 160);
  const pixelHeight = makeUint32Elem(0xba, 120);
  const videoPayload = concatU8([pixelWidth, pixelHeight]);
  const videoElem = makeMasterElem(0xe0, videoPayload);
  const payload = concatU8([trackNum, trackUid, trackType, codec, videoElem]);
  return makeMasterElem(0xae, payload);
}

/**
 * Build a TrackEntry element for an audio track.
 */
function buildAudioTrackEntry(num: number, uid: number, codecId: string): Uint8Array {
  const trackNum = makeUint32Elem(0xd7, num);
  const trackUid = makeUint32Elem(0x73c5, uid);
  const trackType = makeUint32Elem(0x83, 2);
  const codec = makeStringElem(0x86, codecId);
  const codecPrivate = makeElemRaw(
    new Uint8Array([0x63, 0xa2]),
    new Uint8Array([0x02, 0x01, 0x01]),
  );
  const sf = makeFloat32Elem(0xb5, 44100);
  const ch = makeUint32Elem(0x9f, 2);
  const audioPayload = concatU8([sf, ch]);
  const audioElem = makeMasterElem(0xe1, audioPayload);
  const payload = concatU8([trackNum, trackUid, trackType, codec, codecPrivate, audioElem]);
  return makeMasterElem(0xae, payload);
}

/**
 * Build a Tracks element with the given track entries.
 */
function buildTracksElement(trackEntries: Uint8Array[]): {
  bytes: Uint8Array;
  children: EbmlElement[];
} {
  // Concatenate all track entries as payload.
  const tracksPayload = concatU8(trackEntries);

  // Compute file bytes = just the track entries (we'll fake element offsets).
  const bytes = new Uint8Array(tracksPayload.length + 16);
  const payloadStart = 8;
  bytes.set(tracksPayload, payloadStart);

  // Build children (each track entry as a flat EbmlElement).
  const children: EbmlElement[] = [];
  let cursor = payloadStart;
  for (const entry of trackEntries) {
    children.push({
      id: 0xae,
      size: BigInt(entry.length - 2), // approximate
      payloadOffset: cursor + 2,
      nextOffset: cursor + entry.length,
      idWidth: 1,
      sizeWidth: 1,
    });
    // Fix: we need to store the actual entry bytes in `bytes`.
    bytes.set(entry, cursor);
    cursor += entry.length;
  }

  return { bytes, children };
}

describe('decodeTracks', () => {
  it('decodes a VP8 video track', () => {
    const entry = buildVideoTrackEntry(1, 1, 'V_VP8');
    const { bytes, children } = buildTracksElement([entry]);
    const tracks = decodeTracks(bytes, children);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.codecId).toBe('V_VP8');
    expect(tracks[0]?.trackType).toBe(1);
  });

  it('decodes a VP9 video track', () => {
    const entry = buildVideoTrackEntry(1, 1, 'V_VP9');
    const { bytes, children } = buildTracksElement([entry]);
    const tracks = decodeTracks(bytes, children);
    expect(tracks[0]?.codecId).toBe('V_VP9');
  });

  it('decodes A_VORBIS audio track', () => {
    const entry = buildAudioTrackEntry(2, 2, 'A_VORBIS');
    const { bytes, children } = buildTracksElement([entry]);
    const tracks = decodeTracks(bytes, children);
    expect(tracks[0]?.codecId).toBe('A_VORBIS');
    expect(tracks[0]?.trackType).toBe(2);
  });

  it('decodes A_OPUS audio track', () => {
    const entry = buildAudioTrackEntry(2, 2, 'A_OPUS');
    const { bytes, children } = buildTracksElement([entry]);
    const tracks = decodeTracks(bytes, children);
    expect(tracks[0]?.codecId).toBe('A_OPUS');
  });

  it('rejects multi-video-track with WebmMultiTrackNotSupportedError', () => {
    const entry1 = buildVideoTrackEntry(1, 1, 'V_VP8');
    const entry2 = buildVideoTrackEntry(2, 2, 'V_VP8');
    const { bytes, children } = buildTracksElement([entry1, entry2]);
    expect(() => decodeTracks(bytes, children)).toThrow(WebmMultiTrackNotSupportedError);
  });

  it('rejects S_TEXT/UTF8 codec (even on video type) with WebmUnsupportedCodecError', () => {
    // Build a track with TrackType=1 (video) but codec 'S_TEXT/UTF8' — should reject codec.
    const trackNum = makeUint32Elem(0xd7, 1);
    const trackUid = makeUint32Elem(0x73c5, 1);
    const trackType = makeUint32Elem(0x83, 1); // video type (so TrackType check passes)
    const codec = makeStringElem(0x86, 'S_TEXT/UTF8');
    const pixelWidth = makeUint32Elem(0xb0, 160);
    const pixelHeight = makeUint32Elem(0xba, 120);
    const videoElem = makeMasterElem(0xe0, concatU8([pixelWidth, pixelHeight]));
    const payload = concatU8([trackNum, trackUid, trackType, codec, videoElem]);
    const entry = makeMasterElem(0xae, payload);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(WebmUnsupportedCodecError);
  });

  it('rejects V_AV1 with WebmUnsupportedCodecError', () => {
    const trackNum = makeUint32Elem(0xd7, 1);
    const trackUid = makeUint32Elem(0x73c5, 1);
    const trackType = makeUint32Elem(0x83, 1);
    const codec = makeStringElem(0x86, 'V_AV1');
    const pixelWidth = makeUint32Elem(0xb0, 160);
    const pixelHeight = makeUint32Elem(0xba, 120);
    const videoElem = makeMasterElem(0xe0, concatU8([pixelWidth, pixelHeight]));
    const payload = concatU8([trackNum, trackUid, trackType, codec, videoElem]);
    const entry = makeMasterElem(0xae, payload);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(WebmUnsupportedCodecError);
  });
});

// ---------------------------------------------------------------------------
// Sec-M-3 regression: VP8/VP9 CodecPrivate must be empty or absent
// ---------------------------------------------------------------------------

describe('decodeTracks — Sec-M-3 VP8/VP9 non-empty CodecPrivate rejection', () => {
  it('throws WebmCorruptStreamError for V_VP8 track with non-empty CodecPrivate', () => {
    // Build a VP8 video track with a non-empty CodecPrivate payload.
    const trackNum = makeUint32Elem(0xd7, 1);
    const trackUid = makeUint32Elem(0x73c5, 1);
    const trackType = makeUint32Elem(0x83, 1);
    const codec = makeStringElem(0x86, 'V_VP8');
    // Non-empty CodecPrivate (1 MiB-ish would normally pass size cap, but any non-zero should throw)
    const codecPrivatePayload = new Uint8Array([0x01, 0x02, 0x03]);
    const idBytes = new Uint8Array([0x63, 0xa2]);
    const sizeVint =
      codecPrivatePayload.length < 127
        ? new Uint8Array([0x80 | codecPrivatePayload.length])
        : new Uint8Array([
            0x40 | (codecPrivatePayload.length >> 8),
            codecPrivatePayload.length & 0xff,
          ]);
    const codecPrivate = new Uint8Array([...idBytes, ...sizeVint, ...codecPrivatePayload]);
    const pixelWidth = makeUint32Elem(0xb0, 160);
    const pixelHeight = makeUint32Elem(0xba, 120);
    const videoPayload = concatU8([pixelWidth, pixelHeight]);
    const videoElem = makeMasterElem(0xe0, videoPayload);
    const payload = concatU8([trackNum, trackUid, trackType, codec, codecPrivate, videoElem]);
    const entry = makeMasterElem(0xae, payload);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(WebmCorruptStreamError);
  });

  it('throws WebmCorruptStreamError for V_VP9 track with non-empty CodecPrivate', () => {
    const trackNum = makeUint32Elem(0xd7, 1);
    const trackUid = makeUint32Elem(0x73c5, 2);
    const trackType = makeUint32Elem(0x83, 1);
    const codec = makeStringElem(0x86, 'V_VP9');
    const codecPrivatePayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const idBytes = new Uint8Array([0x63, 0xa2]);
    const sizeVint = new Uint8Array([0x80 | codecPrivatePayload.length]);
    const codecPrivate = new Uint8Array([...idBytes, ...sizeVint, ...codecPrivatePayload]);
    const pixelWidth = makeUint32Elem(0xb0, 320);
    const pixelHeight = makeUint32Elem(0xba, 240);
    const videoElem = makeMasterElem(0xe0, concatU8([pixelWidth, pixelHeight]));
    const payload = concatU8([trackNum, trackUid, trackType, codec, codecPrivate, videoElem]);
    const entry = makeMasterElem(0xae, payload);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(WebmCorruptStreamError);
  });

  it('accepts V_VP8 track with absent CodecPrivate', () => {
    const entry = buildVideoTrackEntry(1, 1, 'V_VP8');
    const { bytes, children } = buildTracksElement([entry]);
    // buildVideoTrackEntry does not add CodecPrivate → should not throw
    expect(() => decodeTracks(bytes, children)).not.toThrow();
  });
});

describe('encodeTracks', () => {
  it('encodes a video track with optional displayWidth/displayHeight', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 999n,
        trackType: 1 as const,
        codecId: 'V_VP8' as const,
        pixelWidth: 320,
        pixelHeight: 240,
        displayWidth: 320,
        displayHeight: 240,
      },
    ];
    const bytes = encodeTracks(tracks);
    // Should start with Tracks ID 0x1654AE6B.
    expect(bytes[0]).toBe(0x16);
    expect(bytes[1]).toBe(0x54);
    expect(bytes[2]).toBe(0xae);
    expect(bytes[3]).toBe(0x6b);
    expect(bytes.length).toBeGreaterThan(10);
  });

  it('encodes a video track with optional flagEnabled and codecPrivate', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 555n,
        trackType: 1 as const,
        codecId: 'V_VP9' as const,
        pixelWidth: 640,
        pixelHeight: 480,
        flagEnabled: 1,
        flagDefault: 1,
        flagLacing: 0,
        language: 'eng',
        defaultDuration: 33333333,
        codecPrivate: new Uint8Array([0x01, 0x02, 0x03]),
      },
    ];
    const bytes = encodeTracks(tracks);
    expect(bytes.length).toBeGreaterThan(10);
    expect(bytes[0]).toBe(0x16);
  });

  it('encodes an audio track with optional bitDepth', () => {
    const tracks = [
      {
        trackNumber: 2,
        trackUid: 888n,
        trackType: 2 as const,
        codecId: 'A_VORBIS' as const,
        codecPrivate: new Uint8Array([0x02, 0x01]),
        samplingFrequency: 48000,
        channels: 2,
        bitDepth: 16,
      },
    ];
    const bytes = encodeTracks(tracks);
    expect(bytes.length).toBeGreaterThan(10);
  });

  it('encodes an audio track with optional codecDelay and seekPreRoll', () => {
    const tracks = [
      {
        trackNumber: 2,
        trackUid: 777n,
        trackType: 2 as const,
        codecId: 'A_OPUS' as const,
        codecPrivate: new Uint8Array([0x4f, 0x70, 0x75, 0x73]),
        samplingFrequency: 48000,
        channels: 2,
        codecDelay: 6500000,
        seekPreRoll: 80000000,
      },
    ];
    const bytes = encodeTracks(tracks);
    expect(bytes.length).toBeGreaterThan(10);
    // Starts with Tracks ID 0x1654AE6B.
    expect(bytes[0]).toBe(0x16);
  });

  it('encodes mixed video+audio tracks', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 111n,
        trackType: 1 as const,
        codecId: 'V_VP9' as const,
        pixelWidth: 1920,
        pixelHeight: 1080,
      },
      {
        trackNumber: 2,
        trackUid: 222n,
        trackType: 2 as const,
        codecId: 'A_OPUS' as const,
        codecPrivate: new Uint8Array([0x4f, 0x70, 0x75, 0x73]),
        samplingFrequency: 48000,
        channels: 2,
      },
    ];
    const bytes = encodeTracks(tracks);
    expect(bytes.length).toBeGreaterThan(20);
  });
});
