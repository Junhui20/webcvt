/**
 * Tests for Tracks/TrackEntry decode/encode (tracks.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  ID_AUDIO,
  ID_CHANNELS,
  ID_CODEC_ID,
  ID_CODEC_PRIVATE,
  ID_CONTENT_ENCODINGS,
  ID_PIXEL_HEIGHT,
  ID_PIXEL_WIDTH,
  ID_SAMPLING_FREQUENCY,
  ID_TRACKS,
  ID_TRACK_ENTRY,
  ID_TRACK_NUMBER,
  ID_TRACK_TYPE,
  ID_TRACK_UID,
  ID_VIDEO,
} from '../constants.ts';
import type { EbmlElement } from '../ebml-element.ts';
import { readChildren } from '../ebml-element.ts';
import { concatBytes, writeFloat32, writeString, writeUint } from '../ebml-types.ts';
import { writeVintId, writeVintSize } from '../ebml-vint.ts';
import {
  MkvCorruptStreamError,
  MkvEncryptionNotSupportedError,
  MkvMissingElementError,
  MkvMultiTrackNotSupportedError,
  MkvUnsupportedCodecError,
  MkvUnsupportedTrackTypeError,
} from '../errors.ts';
import {
  encodeBinaryElement,
  encodeMasterElement,
  encodeStringElement,
  encodeUintElement,
} from './header.ts';
import type { MkvAudioTrack, MkvVideoTrack } from './tracks.ts';
import { decodeTracks, encodeTracks } from './tracks.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUintElem(id: number, value: bigint): Uint8Array {
  return encodeUintElement(id, value);
}

function makeStringElem(id: number, value: string): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeString(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

function makeBinaryElem(id: number, data: Uint8Array): Uint8Array {
  return encodeBinaryElement(id, data);
}

function makeFloat32Elem(id: number, value: number): Uint8Array {
  const idBytes = writeVintId(id);
  const payload = writeFloat32(value);
  const sizeBytes = writeVintSize(BigInt(payload.length));
  return concatBytes([idBytes, sizeBytes, payload]);
}

function buildVideoSubElem(width: number, height: number): Uint8Array {
  const children = concatBytes([
    makeUintElem(ID_PIXEL_WIDTH, BigInt(width)),
    makeUintElem(ID_PIXEL_HEIGHT, BigInt(height)),
  ]);
  return encodeMasterElement(ID_VIDEO, children);
}

function buildAudioSubElem(samplingFrequency: number, channels: number): Uint8Array {
  const children = concatBytes([
    makeFloat32Elem(ID_SAMPLING_FREQUENCY, samplingFrequency),
    makeUintElem(ID_CHANNELS, BigInt(channels)),
  ]);
  return encodeMasterElement(ID_AUDIO, children);
}

function buildAvcCodecPrivate(): Uint8Array {
  return new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe0, 0x00]);
}

function buildAacAsc(): Uint8Array {
  return new Uint8Array([0x11, 0x90]);
}

function buildFlacCodecPrivate(): Uint8Array {
  return new Uint8Array(34).fill(0xaa);
}

function buildOpusHead(): Uint8Array {
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
  head[8] = 1;
  head[9] = 2;
  return head;
}

function buildVorbisCodecPrivate(): Uint8Array {
  return new Uint8Array(30).fill(0x01);
}

function buildTrackEntry(
  trackNumber: number,
  trackUid: bigint,
  trackType: number,
  codecId: string,
  codecPrivate: Uint8Array | null,
  extraChildren: Uint8Array[],
): Uint8Array {
  const parts: Uint8Array[] = [
    makeUintElem(ID_TRACK_NUMBER, BigInt(trackNumber)),
    makeUintElem(ID_TRACK_UID, trackUid),
    makeUintElem(ID_TRACK_TYPE, BigInt(trackType)),
    makeStringElem(ID_CODEC_ID, codecId),
  ];
  if (codecPrivate !== null) {
    parts.push(makeBinaryElem(ID_CODEC_PRIVATE, codecPrivate));
  }
  parts.push(...extraChildren);
  return encodeMasterElement(ID_TRACK_ENTRY, concatBytes(parts));
}

/**
 * Get payload offset for a master element given the ID width.
 * Size VINT: marker bit determines width.
 */
function getMasterPayloadOffset(bytes: Uint8Array, idWidth: number): number {
  const sizeByte = bytes[idWidth] as number;
  let sizeWidth = 1;
  if ((sizeByte & 0x80) !== 0) sizeWidth = 1;
  else if ((sizeByte & 0x40) !== 0) sizeWidth = 2;
  else if ((sizeByte & 0x20) !== 0) sizeWidth = 3;
  else if ((sizeByte & 0x10) !== 0) sizeWidth = 4;
  return idWidth + sizeWidth;
}

function buildTracksElement(trackEntries: Uint8Array[]): {
  bytes: Uint8Array;
  children: EbmlElement[];
} {
  const payload = concatBytes(trackEntries);
  const tracksElem = encodeMasterElement(ID_TRACKS, payload);
  // ID_TRACKS = 0x1654AE6B → 4-byte ID
  const payloadStart = getMasterPayloadOffset(tracksElem, 4);
  const children = readChildren(
    tracksElem,
    payloadStart,
    tracksElem.length,
    1,
    { value: 0 },
    10000,
    64 * 1024 * 1024,
    ID_TRACKS,
    0x18538067,
  );
  return { bytes: tracksElem, children };
}

// ---------------------------------------------------------------------------
// decodeTracks tests — H.264 + AAC
// ---------------------------------------------------------------------------

describe('decodeTracks — H.264 video + AAC audio', () => {
  it('decodes one video track and one audio track', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_MPEG4/ISO/AVC', buildAvcCodecPrivate(), [
      buildVideoSubElem(640, 480),
    ]);
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_AAC', buildAacAsc(), [
      buildAudioSubElem(44100, 2),
    ]);
    const { bytes, children } = buildTracksElement([videoEntry, audioEntry]);
    const tracks = decodeTracks(bytes, children);

    expect(tracks).toHaveLength(2);
    const video = tracks.find((t) => t.trackType === 1);
    const audio = tracks.find((t) => t.trackType === 2);

    expect(video?.codecId).toBe('V_MPEG4/ISO/AVC');
    expect(video?.webcodecsCodecString).toMatch(/^avc1\./);
    expect((video as MkvVideoTrack)?.pixelWidth).toBe(640);
    expect((video as MkvVideoTrack)?.pixelHeight).toBe(480);

    expect(audio?.codecId).toBe('A_AAC');
    expect(audio?.webcodecsCodecString).toMatch(/^mp4a\.40\./);
  });
});

// ---------------------------------------------------------------------------
// decodeTracks — VP9 + Opus
// ---------------------------------------------------------------------------

describe('decodeTracks — VP9 video + Opus audio', () => {
  it('decodes VP9+Opus and returns correct codec strings', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP9', null, [buildVideoSubElem(1280, 720)]);
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_OPUS', buildOpusHead(), [
      buildAudioSubElem(48000, 2),
    ]);
    const { bytes, children } = buildTracksElement([videoEntry, audioEntry]);
    const tracks = decodeTracks(bytes, children);

    const video = tracks.find((t) => t.trackType === 1);
    const audio = tracks.find((t) => t.trackType === 2);

    expect(video?.webcodecsCodecString).toBe('vp09.00.10.08');
    expect(audio?.webcodecsCodecString).toBe('opus');
  });
});

// ---------------------------------------------------------------------------
// decodeTracks — VP8 + MP3
// ---------------------------------------------------------------------------

describe('decodeTracks — VP8 video + MP3 audio', () => {
  it('decodes VP8+MP3', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP8', null, [buildVideoSubElem(320, 240)]);
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_MPEG/L3', null, [buildAudioSubElem(44100, 2)]);
    const { bytes, children } = buildTracksElement([videoEntry, audioEntry]);
    const tracks = decodeTracks(bytes, children);

    const video = tracks.find((t) => t.trackType === 1);
    const audio = tracks.find((t) => t.trackType === 2);

    expect(video?.webcodecsCodecString).toBe('vp8');
    expect(audio?.webcodecsCodecString).toBe('mp3');
  });

  it('throws MkvCorruptStreamError when VP8 has non-empty CodecPrivate', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP8', new Uint8Array([0x01]), [
      buildVideoSubElem(320, 240),
    ]);
    const { bytes, children } = buildTracksElement([videoEntry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvCorruptStreamError);
  });

  it('throws MkvCorruptStreamError when VP9 has non-empty CodecPrivate', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP9', new Uint8Array([0x01]), [
      buildVideoSubElem(320, 240),
    ]);
    const { bytes, children } = buildTracksElement([videoEntry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvCorruptStreamError);
  });

  it('throws MkvCorruptStreamError when MP3 has non-empty CodecPrivate', () => {
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_MPEG/L3', new Uint8Array([0x01]), [
      buildAudioSubElem(44100, 2),
    ]);
    const { bytes, children } = buildTracksElement([audioEntry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvCorruptStreamError);
  });
});

// ---------------------------------------------------------------------------
// decodeTracks — FLAC + Vorbis
// ---------------------------------------------------------------------------

describe('decodeTracks — VP9 video + FLAC/Vorbis audio', () => {
  it('decodes VP9+FLAC (34-byte raw body)', () => {
    const flacRaw = buildFlacCodecPrivate();
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP9', null, [buildVideoSubElem(320, 240)]);
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_FLAC', flacRaw, [buildAudioSubElem(44100, 2)]);
    const { bytes, children } = buildTracksElement([videoEntry, audioEntry]);
    const tracks = decodeTracks(bytes, children);

    const audio = tracks.find((t) => t.trackType === 2);
    expect(audio?.webcodecsCodecString).toBe('flac');
    expect((audio as MkvAudioTrack)?.codecPrivate?.length).toBe(42);
  });

  it('decodes VP9+Vorbis', () => {
    const videoEntry = buildTrackEntry(1, 1n, 1, 'V_VP9', null, [buildVideoSubElem(320, 240)]);
    const audioEntry = buildTrackEntry(2, 2n, 2, 'A_VORBIS', buildVorbisCodecPrivate(), [
      buildAudioSubElem(44100, 2),
    ]);
    const { bytes, children } = buildTracksElement([videoEntry, audioEntry]);
    const tracks = decodeTracks(bytes, children);

    const audio = tracks.find((t) => t.trackType === 2);
    expect(audio?.webcodecsCodecString).toBe('vorbis');
  });
});

// ---------------------------------------------------------------------------
// decodeTracks — validation errors
// ---------------------------------------------------------------------------

describe('decodeTracks — validation errors', () => {
  it('throws MkvMultiTrackNotSupportedError for 2 video tracks', () => {
    const v1 = buildTrackEntry(1, 1n, 1, 'V_VP9', null, [buildVideoSubElem(320, 240)]);
    const v2 = buildTrackEntry(2, 2n, 1, 'V_VP9', null, [buildVideoSubElem(320, 240)]);
    const { bytes, children } = buildTracksElement([v1, v2]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMultiTrackNotSupportedError);
  });

  it('throws MkvMultiTrackNotSupportedError for 2 audio tracks', () => {
    const a1 = buildTrackEntry(1, 1n, 2, 'A_OPUS', buildOpusHead(), [buildAudioSubElem(48000, 2)]);
    const a2 = buildTrackEntry(2, 2n, 2, 'A_OPUS', buildOpusHead(), [buildAudioSubElem(48000, 2)]);
    const { bytes, children } = buildTracksElement([a1, a2]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMultiTrackNotSupportedError);
  });

  it('throws MkvEncryptionNotSupportedError when ContentEncodings is present', () => {
    const contentEncodings = encodeMasterElement(ID_CONTENT_ENCODINGS, new Uint8Array(0));
    const entry = buildTrackEntry(1, 1n, 1, 'V_VP9', null, [
      contentEncodings,
      buildVideoSubElem(320, 240),
    ]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvEncryptionNotSupportedError);
  });

  it('throws MkvUnsupportedTrackTypeError for track type 17 (subtitle)', () => {
    const entry = buildTrackEntry(1, 1n, 17, 'S_TEXT/UTF8', null, []);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvUnsupportedTrackTypeError);
  });

  it('throws MkvUnsupportedCodecError for unsupported video codec', () => {
    const entry = buildTrackEntry(1, 1n, 1, 'V_THEORA', null, [buildVideoSubElem(320, 240)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvUnsupportedCodecError);
  });

  it('throws MkvUnsupportedCodecError for unsupported audio codec', () => {
    const entry = buildTrackEntry(1, 1n, 2, 'A_PCM/INT/LIT', null, [buildAudioSubElem(44100, 2)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvUnsupportedCodecError);
  });

  it('throws MkvMissingElementError when AAC track has no CodecPrivate', () => {
    const entry = buildTrackEntry(1, 1n, 2, 'A_AAC', null, [buildAudioSubElem(44100, 2)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMissingElementError);
  });

  it('throws MkvMissingElementError when H.264 track has no CodecPrivate', () => {
    const entry = buildTrackEntry(1, 1n, 1, 'V_MPEG4/ISO/AVC', null, [buildVideoSubElem(320, 240)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMissingElementError);
  });

  it('throws MkvMissingElementError when Opus track has no CodecPrivate', () => {
    const entry = buildTrackEntry(1, 1n, 2, 'A_OPUS', null, [buildAudioSubElem(48000, 2)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMissingElementError);
  });

  it('throws MkvMissingElementError when Vorbis track has no CodecPrivate', () => {
    const entry = buildTrackEntry(1, 1n, 2, 'A_VORBIS', null, [buildAudioSubElem(44100, 2)]);
    const { bytes, children } = buildTracksElement([entry]);
    expect(() => decodeTracks(bytes, children)).toThrow(MkvMissingElementError);
  });
});

// ---------------------------------------------------------------------------
// encodeTracks tests
// ---------------------------------------------------------------------------

describe('encodeTracks', () => {
  it('encodes a list of tracks and wraps in Tracks element', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 1n,
        trackType: 1 as const,
        codecId: 'V_VP9' as const,
        pixelWidth: 320,
        pixelHeight: 240,
        webcodecsCodecString: 'vp09.00.10.08',
      },
    ];
    const encoded = encodeTracks(tracks);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded[0]).toBe(0x16);
    expect(encoded[1]).toBe(0x54);
    expect(encoded[2]).toBe(0xae);
    expect(encoded[3]).toBe(0x6b);
  });

  it('encodes audio track with codecPrivate', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 1n,
        trackType: 2 as const,
        codecId: 'A_AAC' as const,
        codecPrivate: buildAacAsc(),
        samplingFrequency: 44100,
        channels: 2,
        webcodecsCodecString: 'mp4a.40.2',
      },
    ];
    const encoded = encodeTracks(tracks);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(20);
  });

  it('encodes video track with codecPrivate', () => {
    const tracks = [
      {
        trackNumber: 1,
        trackUid: 1n,
        trackType: 1 as const,
        codecId: 'V_MPEG4/ISO/AVC' as const,
        codecPrivate: buildAvcCodecPrivate(),
        pixelWidth: 1280,
        pixelHeight: 720,
        webcodecsCodecString: 'avc1.640028',
      },
    ];
    const encoded = encodeTracks(tracks);
    expect(encoded.length).toBeGreaterThan(30);
  });

  it('round-trip: encode VP9 track then decode', () => {
    const originalTracks = [
      {
        trackNumber: 1,
        trackUid: 1n,
        trackType: 1 as const,
        codecId: 'V_VP9' as const,
        pixelWidth: 320,
        pixelHeight: 240,
        webcodecsCodecString: 'vp09.00.10.08',
      },
    ];
    const encoded = encodeTracks(originalTracks);
    const payloadStart = getMasterPayloadOffset(encoded, 4);
    const children = readChildren(
      encoded,
      payloadStart,
      encoded.length,
      1,
      { value: 0 },
      1000,
      64 * 1024 * 1024,
      ID_TRACKS,
      0x18538067,
    );
    const decoded = decodeTracks(encoded, children);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.trackNumber).toBe(1);
    expect(decoded[0]?.codecId).toBe('V_VP9');
    expect(decoded[0]?.webcodecsCodecString).toBe('vp09.00.10.08');
  });
});
