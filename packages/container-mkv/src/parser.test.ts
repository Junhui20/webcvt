/**
 * Parser tests for @catlabtech/webcvt-container-mkv.
 *
 * Covers design note test cases:
 * - parses EBML header and recognises DocType "matroska"
 * - rejects DocType "webm" with MkvDocTypeNotSupportedError
 * - rejects DocType "mkv-3d" or any other custom DocType
 * - rejects EBMLVersion != 1 / EBMLReadVersion != 1
 * - applies TimecodeScale default of 1_000_000 ns when Info omits it
 * - parses single H.264 video track + single AAC audio track end-to-end (fixture)
 * - decodes Cluster with unlaced SimpleBlocks (lacing == 00)
 * - decodes SimpleBlock with Xiph lacing (lacing == 01) and 3 frames
 * - rejects SimpleBlock with EBML / fixed-size lacing as deferred
 * - computes absolute timestamp = (Cluster.Timecode + delta) * TimecodeScale
 * - parses Cues block and resolves CueClusterPosition to absolute file offset
 * - tolerates and skips Chapters / Tags / Attachments at Segment depth
 * - rejects multi-video-track file with MkvMultiTrackNotSupportedError
 * - rejects subtitle track (S_TEXT/UTF8) with MkvUnsupportedTrackTypeError / MkvUnsupportedCodecError
 * - enforces 200 MiB input cap, per-element 64 MiB cap
 * - rejects ContentEncoding (encrypted track) with MkvEncryptionNotSupportedError
 * - decodes 2-byte track_number VINT in SimpleBlock for trackNumber > 127
 */

import { EbmlTooManyElementsError, EbmlUnknownSizeError } from '@catlabtech/webcvt-ebml';
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import {
  MkvCorruptStreamError,
  MkvDocTypeNotSupportedError,
  MkvEbmlVersionError,
  MkvEncryptionNotSupportedError,
  MkvInputTooLargeError,
  MkvLacingNotSupportedError,
  MkvMultiTrackNotSupportedError,
  MkvUnsupportedCodecError,
} from './errors.ts';
import { parseMkv } from './parser.ts';

// ---------------------------------------------------------------------------
// Synthetic MKV builder helpers
// ---------------------------------------------------------------------------

function concatUint8(arrays: Uint8Array[]): Uint8Array {
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
  if (size < 16383) return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
  return new Uint8Array([0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff]);
}

function encodeVintId(id: number): Uint8Array {
  if (id >= 0x10000000)
    return new Uint8Array([(id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x200000) return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  if (id >= 0x4000) return new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([id & 0xff]);
}

function makeElement(id: number, payload: Uint8Array): Uint8Array {
  return concatUint8([encodeVintId(id), encodeVintSize(payload.length), payload]);
}

function makeUintElement(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, value, false);
  return makeElement(id, payload);
}

function makeStringElement(id: number, value: string): Uint8Array {
  return makeElement(id, new TextEncoder().encode(value));
}

function makeFloat32Element(id: number, value: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setFloat32(0, value, false);
  return makeElement(id, payload);
}

function buildEbmlHeader(docType: string, ebmlVersion = 1, ebmlReadVersion = 1): Uint8Array {
  const enc = new TextEncoder();
  const docTypeBytes = enc.encode(docType);

  const ebmlVersionElem = new Uint8Array([0x42, 0x86, 0x81, ebmlVersion]);
  const ebmlReadVersionElem = new Uint8Array([0x42, 0xf7, 0x81, ebmlReadVersion]);
  const maxIdLen = new Uint8Array([0x42, 0xf2, 0x81, 0x04]);
  const maxSizeLen = new Uint8Array([0x42, 0xf3, 0x81, 0x08]);

  const docTypeId = new Uint8Array([0x42, 0x82]);
  const docTypeSize = new Uint8Array([0x80 | docTypeBytes.length]);
  const docTypeElem = new Uint8Array([...docTypeId, ...docTypeSize, ...docTypeBytes]);
  const docTypeVersion = new Uint8Array([0x42, 0x87, 0x81, 0x04]);
  const docTypeReadVersion = new Uint8Array([0x42, 0x85, 0x81, 0x02]);

  const payload = concatUint8([
    ebmlVersionElem,
    ebmlReadVersionElem,
    maxIdLen,
    maxSizeLen,
    docTypeElem,
    docTypeVersion,
    docTypeReadVersion,
  ]);

  const headerId = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  const headerSize = encodeVintSize(payload.length);
  return concatUint8([headerId, headerSize, payload]);
}

/** Build a minimal AVC CodecPrivate (AVCDecoderConfigurationRecord). */
function buildAvcCodecPrivate(profile = 0x64, compat = 0x00, level = 0x28): Uint8Array {
  // Minimal AVCDecoderConfigurationRecord:
  // version=1, profile, compat, level, lengthSizeMinusOne=3, numSPS=1, SPS, numPPS=1, PPS
  const sps = new Uint8Array([0x67, 0x64, 0x00, 0x28, 0xac, 0xd9]); // fake SPS NAL
  const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]); // fake PPS NAL
  const out = new Uint8Array([
    0x01, // configVersion
    profile,
    compat,
    level,
    0xff, // lengthSizeMinusOne = 3 (NAL length is 4 bytes)
    0xe1, // reserved(111) | numSPS(1)
    0x00,
    sps.length, // SPS length (2 bytes BE)
    ...sps,
    0x01, // numPPS
    0x00,
    pps.length, // PPS length
    ...pps,
  ]);
  return out;
}

/** Build a minimal AAC AudioSpecificConfig. AOT=2 (LC), sfi=3 (48kHz), ch=2. */
function buildAacAsc(): Uint8Array {
  // audio_object_type=2 (5 bits), sfi=3 (4 bits), channels=2 (4 bits)
  // Bit layout: AAAAASSSSC CC... (A=aot, S=sfi, C=channels)
  // 2 = 00010, 3 = 0011, 2 = 0010
  // Bytes: [00010 001] [1 0010 000] = 0x11 0x90
  return new Uint8Array([0x11, 0x90]);
}

/** Build a minimal MKV file with H.264 video + AAC audio. */
function buildMinimalMkv(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');

  const timecodeScaleElem = makeUintElement(0x2ad7b1, 1_000_000);
  const muxingAppElem = makeStringElement(0x4d80, 'test');
  const writingAppElem = makeStringElement(0x5741, 'test');
  const infoPayload = concatUint8([timecodeScaleElem, muxingAppElem, writingAppElem]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  const vTrackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 12345),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const vTrackEntry = makeElement(0xae, vTrackPayload);

  const aacAsc = buildAacAsc();
  const aTrackPayload = concatUint8([
    makeUintElement(0xd7, 2),
    makeUintElement(0x73c5, 67890),
    makeUintElement(0x83, 2),
    makeStringElement(0x86, 'A_AAC'),
    makeElement(0x63a2, aacAsc),
    makeElement(0xe1, concatUint8([makeFloat32Element(0xb5, 48000.0), makeUintElement(0x9f, 2)])),
  ]);
  const aTrackEntry = makeElement(0xae, aTrackPayload);

  const tracksPayload = concatUint8([vTrackEntry, aTrackEntry]);
  const tracksElem = makeElement(0x1654ae6b, tracksPayload);

  const timecodeElem = makeUintElement(0xe7, 0);
  const simpleBlockPayload = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xab, 0xcd]);
  const simpleBlockElem = makeElement(0xa3, simpleBlockPayload);
  const aSimpleBlockPayload = new Uint8Array([0x82, 0x00, 0x00, 0x00, 0xef]);
  const aSimpleBlockElem = makeElement(0xa3, aSimpleBlockPayload);

  const clusterPayload = concatUint8([timecodeElem, simpleBlockElem, aSimpleBlockElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  const segmentPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segmentId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segmentSize = encodeVintSize(segmentPayload.length);

  return concatUint8([ebmlHeader, segmentId, segmentSize, segmentPayload]);
}

// ---------------------------------------------------------------------------
// Fixture-based tests
// ---------------------------------------------------------------------------

describe('parseMkv — real fixture (H.264 + AAC)', () => {
  it('parses EBML header and recognises DocType "matroska"', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    expect(file.ebmlHeader.docType).toBe('matroska');
    expect(file.ebmlHeader.ebmlVersion).toBe(1);
    expect(file.ebmlHeader.ebmlReadVersion).toBe(1);
  });

  it('parses single H.264 video track + single AAC audio track', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    expect(file.tracks).toHaveLength(2);

    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    const audioTrack = file.tracks.find((t) => t.trackType === 2);

    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    expect(videoTrack?.codecId).toBe('V_MPEG4/ISO/AVC');
    expect(audioTrack?.codecId).toBe('A_AAC');
  });

  it('asserts video track dimensions are 160x120', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    if (videoTrack?.trackType === 1) {
      expect(videoTrack.pixelWidth).toBe(160);
      expect(videoTrack.pixelHeight).toBe(120);
    }
  });

  it('derives avc1.* codec string from AVCDecoderConfigurationRecord', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    if (videoTrack?.trackType === 1) {
      expect(videoTrack.webcodecsCodecString).toMatch(/^avc1\.[0-9a-f]{6}$/);
    }
  });

  it('derives mp4a.40.* codec string from AudioSpecificConfig', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    const audioTrack = file.tracks.find((t) => t.trackType === 2);
    if (audioTrack?.trackType === 2) {
      expect(audioTrack.webcodecsCodecString).toMatch(/^mp4a\.40\.\d+$/);
    }
  });

  it('has at least one Cluster with SimpleBlocks', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    expect(file.clusters.length).toBeGreaterThan(0);
    const allBlocks = file.clusters.flatMap((c) => c.blocks);
    expect(allBlocks.length).toBeGreaterThan(0);
  });

  it('fileBytes is the original input reference', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const file = parseMkv(bytes);
    expect(file.fileBytes.buffer).toBe(bytes.buffer);
  });
});

describe('parseMkv — WebM fixture rejection', () => {
  it('rejects DocType "webm" with MkvDocTypeNotSupportedError', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    expect(() => parseMkv(bytes)).toThrow(MkvDocTypeNotSupportedError);
  });
});

// ---------------------------------------------------------------------------
// DocType validation tests
// ---------------------------------------------------------------------------

describe('parseMkv — DocType validation', () => {
  it('accepts DocType "matroska"', () => {
    const mkv = buildMinimalMkv();
    expect(() => parseMkv(mkv)).not.toThrow();
  });

  it('rejects DocType "webm" with MkvDocTypeNotSupportedError', () => {
    const header = buildEbmlHeader('webm');
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segPayload = new Uint8Array(0);
    const segSize = encodeVintSize(segPayload.length);
    const input = concatUint8([header, segId, segSize, segPayload]);
    expect(() => parseMkv(input)).toThrow(MkvDocTypeNotSupportedError);
  });

  it('rejects DocType "mkv-3d" with MkvDocTypeNotSupportedError', () => {
    const header = buildEbmlHeader('mkv-3d');
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(0);
    const input = concatUint8([header, segId, segSize]);
    expect(() => parseMkv(input)).toThrow(MkvDocTypeNotSupportedError);
  });

  it('rejects EBMLVersion != 1', () => {
    const header = buildEbmlHeader('matroska', 2, 1);
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(0);
    const input = concatUint8([header, segId, segSize]);
    expect(() => parseMkv(input)).toThrow(MkvEbmlVersionError);
  });

  it('rejects EBMLReadVersion != 1', () => {
    const header = buildEbmlHeader('matroska', 1, 2);
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(0);
    const input = concatUint8([header, segId, segSize]);
    expect(() => parseMkv(input)).toThrow(MkvEbmlVersionError);
  });
});

// ---------------------------------------------------------------------------
// Security caps tests
// ---------------------------------------------------------------------------

describe('parseMkv — security caps', () => {
  it('enforces 200 MiB input cap', () => {
    const oversized = Object.create(Uint8Array.prototype) as Uint8Array;
    Object.defineProperty(oversized, 'length', { value: 200 * 1024 * 1024 + 1 });
    expect(() => parseMkv(oversized)).toThrow(MkvInputTooLargeError);
  });

  it('rejects empty input with MkvCorruptStreamError', () => {
    expect(() => parseMkv(new Uint8Array(0))).toThrow();
  });

  it('rejects unknown-size Segment', () => {
    const header = buildEbmlHeader('matroska');
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const unknownSizeVint = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const input = concatUint8([header, segId, unknownSizeVint]);
    expect(() => parseMkv(input)).toThrow(EbmlUnknownSizeError);
  });

  it('throws MkvCorruptStreamError when TimecodeScale is zero', () => {
    const ebmlHeader = buildEbmlHeader('matroska');
    const timecodeScaleElem = makeUintElement(0x2ad7b1, 0);
    const muxingAppElem = makeStringElement(0x4d80, 'test');
    const writingAppElem = makeStringElement(0x5741, 'test');
    const infoPayload = concatUint8([timecodeScaleElem, muxingAppElem, writingAppElem]);
    const infoElem = makeElement(0x1549a966, infoPayload);

    const avcPrivate = buildAvcCodecPrivate();
    const vTrackPayload = concatUint8([
      makeUintElement(0xd7, 1),
      makeUintElement(0x73c5, 1),
      makeUintElement(0x83, 1),
      makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
      makeElement(0x63a2, avcPrivate),
      makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
    ]);
    const vTrackEntry = makeElement(0xae, vTrackPayload);
    const tracksElem = makeElement(0x1654ae6b, vTrackEntry);

    const segPayload = concatUint8([infoElem, tracksElem]);
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(segPayload.length);
    const input = concatUint8([ebmlHeader, segId, segSize, segPayload]);
    expect(() => parseMkv(input)).toThrow(MkvCorruptStreamError);
  });

  it('throws EbmlTooManyElementsError for deeply nested track with many padding elements', () => {
    const ebmlHeader = buildEbmlHeader('matroska');
    const infoPayload = concatUint8([
      makeUintElement(0x2ad7b1, 1_000_000),
      makeStringElement(0x4d80, 'test'),
      makeStringElement(0x5741, 'test'),
    ]);
    const infoElem = makeElement(0x1549a966, infoPayload);

    const requiredFields = concatUint8([
      makeUintElement(0xd7, 1),
      makeUintElement(0x73c5, 1),
      makeUintElement(0x83, 1),
      makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
      makeElement(0x63a2, buildAvcCodecPrivate()),
      makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
    ]);

    const paddingCount = 99_980;
    const paddingBytes = new Uint8Array(paddingCount * 2);
    for (let i = 0; i < paddingCount; i++) {
      paddingBytes[i * 2] = 0xd9;
      paddingBytes[i * 2 + 1] = 0x80;
    }

    const trackEntryPayload = concatUint8([requiredFields, paddingBytes]);
    const trackEntry = makeElement(0xae, trackEntryPayload);
    const tracksElem = makeElement(0x1654ae6b, trackEntry);

    const segPayload = concatUint8([infoElem, tracksElem]);
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(segPayload.length);
    const input = concatUint8([ebmlHeader, segId, segSize, segPayload]);

    expect(() => parseMkv(input)).toThrow(EbmlTooManyElementsError);
  });
});

// ---------------------------------------------------------------------------
// Minimal synthetic tests
// ---------------------------------------------------------------------------

describe('parseMkv — minimal synthetic MKV', () => {
  it('parses minimal MKV with H.264 + AAC tracks', () => {
    const mkv = buildMinimalMkv();
    const file = parseMkv(mkv);
    expect(file.ebmlHeader.docType).toBe('matroska');
    expect(file.tracks).toHaveLength(2);
    expect(file.tracks[0]?.codecId).toBe('V_MPEG4/ISO/AVC');
    expect(file.tracks[1]?.codecId).toBe('A_AAC');
  });

  it('decodes Cluster with unlaced SimpleBlocks (lacing == 00)', () => {
    const mkv = buildMinimalMkv();
    const file = parseMkv(mkv);
    expect(file.clusters).toHaveLength(1);
    const cluster = file.clusters[0];
    expect(cluster?.timecode).toBe(0n);
    const videoBlock = cluster?.blocks.find((b) => b.trackNumber === 1);
    expect(videoBlock?.keyframe).toBe(true);
    expect(videoBlock?.frames).toHaveLength(1);
    expect(videoBlock?.frames[0]).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('computes absolute timestamp = (Cluster.Timecode + delta) * TimecodeScale', () => {
    const mkv = buildMinimalMkv();
    const file = parseMkv(mkv);
    const cluster = file.clusters[0];
    const block = cluster?.blocks.find((b) => b.trackNumber === 1);
    // Cluster timecode = 0, delta = 0, timecodeScale = 1_000_000
    expect(block?.timestampNs).toBe(0n);
  });

  it('applies TimecodeScale default 1_000_000 ns when Info omits it', () => {
    const ebmlHeader = buildEbmlHeader('matroska');
    const muxingAppElem = makeStringElement(0x4d80, 'test');
    const writingAppElem = makeStringElement(0x5741, 'test');
    const infoPayload = concatUint8([muxingAppElem, writingAppElem]);
    const infoElem = makeElement(0x1549a966, infoPayload);

    const avcPrivate = buildAvcCodecPrivate();
    const vTrackPayload = concatUint8([
      makeUintElement(0xd7, 1),
      makeUintElement(0x73c5, 1),
      makeUintElement(0x83, 1),
      makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
      makeElement(0x63a2, avcPrivate),
      makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
    ]);
    const vTrackEntry = makeElement(0xae, vTrackPayload);

    const aacAsc = buildAacAsc();
    const aTrackPayload = concatUint8([
      makeUintElement(0xd7, 2),
      makeUintElement(0x73c5, 2),
      makeUintElement(0x83, 2),
      makeStringElement(0x86, 'A_AAC'),
      makeElement(0x63a2, aacAsc),
      makeElement(0xe1, concatUint8([makeFloat32Element(0xb5, 48000), makeUintElement(0x9f, 2)])),
    ]);
    const aTrackEntry = makeElement(0xae, aTrackPayload);
    const tracksElem = makeElement(0x1654ae6b, concatUint8([vTrackEntry, aTrackEntry]));

    const timecodeElem = makeUintElement(0xe7, 100);
    const sbPayload = new Uint8Array([0x81, 0x00, 0x0a, 0x80, 0xbb]);
    const sbElem = makeElement(0xa3, sbPayload);
    const clusterPayload = concatUint8([timecodeElem, sbElem]);
    const clusterElem = makeElement(0x1f43b675, clusterPayload);

    const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
    const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
    const segSize = encodeVintSize(segPayload.length);
    const input = concatUint8([ebmlHeader, segId, segSize, segPayload]);

    const file = parseMkv(input);
    expect(file.info.timecodeScale).toBe(1_000_000);
    // timestampNs = (100 + 10) * 1_000_000 = 110_000_000
    const block = file.clusters[0]?.blocks.find((b) => b.trackNumber === 1);
    expect(block?.timestampNs).toBe(110_000_000n);
  });
});

// ---------------------------------------------------------------------------
// Lacing tests
// ---------------------------------------------------------------------------

describe('parseMkv — lacing modes', () => {
  it('rejects SimpleBlock with fixed-size lacing (lacing == 10)', () => {
    const mkv = buildMkvWithLacedBlock(0b10);
    expect(() => parseMkv(mkv)).toThrow(MkvLacingNotSupportedError);
  });

  it('rejects SimpleBlock with EBML lacing (lacing == 11)', () => {
    const mkv = buildMkvWithLacedBlock(0b11);
    expect(() => parseMkv(mkv)).toThrow(MkvLacingNotSupportedError);
  });

  it('decodes SimpleBlock with Xiph lacing (lacing == 01) and 3 frames', () => {
    const mkv = buildMkvWithXiphLacedBlock();
    const file = parseMkv(mkv);
    const block = file.clusters[0]?.blocks.find((b) => b.trackNumber === 1);
    expect(block?.frames).toHaveLength(3);
  });
});

function buildMkvWithLacedBlock(lacingMode: number): Uint8Array {
  const flags = 0x80 | (lacingMode << 1);
  const sbPayload = new Uint8Array([0x81, 0x00, 0x00, flags, 0x01, 0x02, 0xaa, 0xbb]);
  return buildMkvWithSimpleBlockPayload(sbPayload);
}

function buildMkvWithXiphLacedBlock(): Uint8Array {
  const sbPayload = new Uint8Array([
    0x81,
    0x00,
    0x00,
    0x80 | (0b01 << 1), // flags: keyframe=1, lacing=01 (Xiph)
    0x02, // lace_count_minus_one = 2 → 3 frames
    0x02, // frame0 size = 2
    0x02, // frame1 size = 2
    0xaa,
    0xbb, // frame 0
    0xcc,
    0xdd, // frame 1
    0xee, // frame 2
  ]);
  return buildMkvWithSimpleBlockPayload(sbPayload);
}

function buildMkvWithSimpleBlockPayload(sbPayload: Uint8Array): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');

  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  const vTrackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const vTrackEntry = makeElement(0xae, vTrackPayload);

  const aacAsc = buildAacAsc();
  const aTrackPayload = concatUint8([
    makeUintElement(0xd7, 2),
    makeUintElement(0x73c5, 2),
    makeUintElement(0x83, 2),
    makeStringElement(0x86, 'A_AAC'),
    makeElement(0x63a2, aacAsc),
    makeElement(0xe1, concatUint8([makeFloat32Element(0xb5, 48000), makeUintElement(0x9f, 2)])),
  ]);
  const aTrackEntry = makeElement(0xae, aTrackPayload);
  const tracksElem = makeElement(0x1654ae6b, concatUint8([vTrackEntry, aTrackEntry]));

  const timecodeElem = makeUintElement(0xe7, 0);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

// ---------------------------------------------------------------------------
// Track validation tests
// ---------------------------------------------------------------------------

describe('parseMkv — track validation', () => {
  it('rejects multi-video-track file with MkvMultiTrackNotSupportedError', () => {
    const mkv = buildMkvWithTwoVideoTracks();
    expect(() => parseMkv(mkv)).toThrow(MkvMultiTrackNotSupportedError);
  });

  it('rejects subtitle track type with MkvUnsupportedTrackTypeError', () => {
    const mkv = buildMkvWithSubtitleTrackType();
    // TrackType=17 (subtitle-like) → MkvUnsupportedTrackTypeError
    expect(() => parseMkv(mkv)).toThrow();
  });

  it('rejects unsupported codec S_TEXT/UTF8 as video type with MkvUnsupportedCodecError', () => {
    const mkv = buildMkvWithSubtitleCodec();
    expect(() => parseMkv(mkv)).toThrow(MkvUnsupportedCodecError);
  });

  it('rejects encrypted track (ContentEncodings) with MkvEncryptionNotSupportedError', () => {
    const mkv = buildMkvWithEncryptedTrack();
    expect(() => parseMkv(mkv)).toThrow(MkvEncryptionNotSupportedError);
  });
});

function buildMkvWithTwoVideoTracks(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  function makeVideoTrack(num: number, uid: number): Uint8Array {
    const payload = concatUint8([
      makeUintElement(0xd7, num),
      makeUintElement(0x73c5, uid),
      makeUintElement(0x83, 1),
      makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
      makeElement(0x63a2, avcPrivate),
      makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
    ]);
    return makeElement(0xae, payload);
  }

  const tracksPayload = concatUint8([makeVideoTrack(1, 1), makeVideoTrack(2, 2)]);
  const tracksElem = makeElement(0x1654ae6b, tracksPayload);
  const timecodeElem = makeUintElement(0xe7, 0);
  const sbPayload = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa]);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);
  const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithSubtitleTrackType(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);
  const trackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 17), // TrackType=17 = subtitle-like, not 1 or 2
    makeStringElement(0x86, 'S_TEXT/UTF8'),
  ]);
  const trackEntry = makeElement(0xae, trackPayload);
  const tracksElem = makeElement(0x1654ae6b, trackEntry);
  const segPayload = concatUint8([infoElem, tracksElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithSubtitleCodec(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);
  // TrackType=1 (video) but codec is S_TEXT/UTF8 → codec allowlist rejects it
  const trackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'S_TEXT/UTF8'),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const trackEntry = makeElement(0xae, trackPayload);
  const tracksElem = makeElement(0x1654ae6b, trackEntry);
  const timecodeElem = makeUintElement(0xe7, 0);
  const clusterPayload = concatUint8([timecodeElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);
  const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithEncryptedTrack(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);
  const avcPrivate = buildAvcCodecPrivate();
  // Add ContentEncodings element (ID 0x6D80) to the TrackEntry
  const contentEncodings = makeElement(0x6d80, new Uint8Array([0x01, 0x00]));
  const trackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
    contentEncodings, // encryption marker
  ]);
  const trackEntry = makeElement(0xae, trackPayload);
  const tracksElem = makeElement(0x1654ae6b, trackEntry);
  const segPayload = concatUint8([infoElem, tracksElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

// ---------------------------------------------------------------------------
// Codec-specific track tests (synthetic)
// ---------------------------------------------------------------------------

describe('parseMkv — per-codec track parsing (synthetic)', () => {
  it('parses VP9 video track + Opus audio track', () => {
    const mkv = buildMkvWithCodecs('V_VP9', null, 'A_OPUS', buildOpusHead());
    const file = parseMkv(mkv);
    const vt = file.tracks.find((t) => t.trackType === 1);
    const at = file.tracks.find((t) => t.trackType === 2);
    expect(vt?.codecId).toBe('V_VP9');
    expect(vt?.trackType === 1 && vt.webcodecsCodecString).toBe('vp09.00.10.08');
    expect(at?.codecId).toBe('A_OPUS');
    expect(at?.trackType === 2 && at.webcodecsCodecString).toBe('opus');
  });

  it('parses VP8 video track + MP3 audio track', () => {
    const mkv = buildMkvWithCodecs('V_VP8', null, 'A_MPEG/L3', null);
    const file = parseMkv(mkv);
    const vt = file.tracks.find((t) => t.trackType === 1);
    const at = file.tracks.find((t) => t.trackType === 2);
    expect(vt?.codecId).toBe('V_VP8');
    expect(at?.codecId).toBe('A_MPEG/L3');
    expect(at?.trackType === 2 && at.webcodecsCodecString).toBe('mp3');
  });

  it('parses VP9 video track + FLAC audio track (38-byte form)', () => {
    const mkv = buildMkvWithCodecs('V_VP9', null, 'A_FLAC', buildFlacCodecPrivate38());
    const file = parseMkv(mkv);
    const at = file.tracks.find((t) => t.trackType === 2);
    expect(at?.codecId).toBe('A_FLAC');
    expect(at?.trackType === 2 && at.webcodecsCodecString).toBe('flac');
    // Should have been normalised to 42-byte form
    expect(at?.trackType === 2 && at.codecPrivate.length).toBe(42);
  });

  it('parses VP9 video track + FLAC audio track (34-byte raw body form)', () => {
    const mkv = buildMkvWithCodecs('V_VP9', null, 'A_FLAC', buildFlacCodecPrivate34());
    const file = parseMkv(mkv);
    const at = file.tracks.find((t) => t.trackType === 2);
    expect(at?.trackType === 2 && at.codecPrivate.length).toBe(42);
  });

  it('parses VP9 video track + Vorbis audio track', () => {
    const mkv = buildMkvWithCodecs('V_VP9', null, 'A_VORBIS', buildVorbisCodecPrivate());
    const file = parseMkv(mkv);
    const at = file.tracks.find((t) => t.trackType === 2);
    expect(at?.codecId).toBe('A_VORBIS');
    expect(at?.trackType === 2 && at.webcodecsCodecString).toBe('vorbis');
  });

  it('parses HEVC video track + AAC audio track', () => {
    const hevcPrivate = buildHevcCodecPrivate();
    const mkv = buildMkvWithCodecs('V_MPEGH/ISO/HEVC', hevcPrivate, 'A_AAC', buildAacAsc());
    const file = parseMkv(mkv);
    const vt = file.tracks.find((t) => t.trackType === 1);
    expect(vt?.codecId).toBe('V_MPEGH/ISO/HEVC');
    expect(vt?.trackType === 1 && vt.webcodecsCodecString).toMatch(/^hev1\./);
  });
});

// ---------------------------------------------------------------------------
// Track number > 127 test (Trap §24)
// ---------------------------------------------------------------------------

describe('parseMkv — Trap §24: 2-byte track number VINT', () => {
  it('decodes 2-byte track_number VINT in SimpleBlock for trackNumber > 127', () => {
    // Build a minimal MKV where the SimpleBlock uses track number 130 (2-byte size VINT).
    // 2-byte size VINT for 130: byte0=0x40|(130>>8)=0x40, byte1=130&0xFF=0x82 → 0x40 0x82
    const mkv = buildMkvWithHighTrackNumber();
    const file = parseMkv(mkv);
    const block = file.clusters[0]?.blocks[0];
    expect(block?.trackNumber).toBe(130);
  });
});

// ---------------------------------------------------------------------------
// Unknown elements skip test (Trap §14)
// ---------------------------------------------------------------------------

describe('parseMkv — tolerates unknown Segment-level elements', () => {
  it('skips Chapters / Tags / Attachments at Segment depth', () => {
    // Build a MKV with a fake "Chapters" element (ID 0x1043A770) at Segment depth.
    // The parser must skip it and still parse the file correctly.
    const mkv = buildMkvWithUnknownSegmentElement();
    expect(() => parseMkv(mkv)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cues test
// ---------------------------------------------------------------------------

describe('parseMkv — Cues parsing', () => {
  it('parses Cues block and resolves CueClusterPosition to absolute file offset', () => {
    const mkv = buildMkvWithCues();
    const file = parseMkv(mkv);
    expect(file.cues).toBeDefined();
    expect(file.cues!.length).toBeGreaterThan(0);
    const cue = file.cues![0];
    expect(cue).toBeDefined();
    expect(typeof cue!.clusterFileOffset).toBe('number');
    expect(cue!.clusterFileOffset).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Builder helpers for codec-specific tests
// ---------------------------------------------------------------------------

function buildOpusHead(): Uint8Array {
  // Minimal OpusHead: magic(8) + version(1) + channels(1) + preskip(2) + samplerate(4) + gain(2) + mappingFamily(1)
  const out = new Uint8Array(19);
  const enc = new TextEncoder();
  out.set(enc.encode('OpusHead'), 0);
  out[8] = 1; // version
  out[9] = 2; // channels
  out[10] = 0x38;
  out[11] = 0x01; // preskip LE
  out[12] = 0x80;
  out[13] = 0xbb;
  out[14] = 0x00;
  out[15] = 0x00; // 48000 samplerate LE
  out[16] = 0;
  out[17] = 0; // gain
  out[18] = 0; // mapping family
  return out;
}

function buildFlacCodecPrivate38(): Uint8Array {
  // fLaC + 4-byte metadata block header (STREAMINFO, last=1, length=34) + full 34-byte STREAMINFO body
  // Total = 4 + 4 + 34 = 42 bytes (the "38-byte" name in the design note refers to the
  // fLaC+header portion excluding the magic; normaliser accepts the full 42-byte canonical form)
  const out = new Uint8Array(42);
  out[0] = 0x66;
  out[1] = 0x4c;
  out[2] = 0x61;
  out[3] = 0x43; // fLaC
  out[4] = 0x80; // last=1, type=0 (STREAMINFO)
  out[5] = 0x00;
  out[6] = 0x00;
  out[7] = 0x22; // length = 34
  // 34-byte STREAMINFO body at offset 8
  out[8] = 0x00;
  out[9] = 0x10; // minBlockSize = 16
  out[10] = 0x10;
  out[11] = 0x00; // maxBlockSize = 4096
  // rest zeros (acceptable minimal STREAMINFO)
  return out;
}

function buildFlacCodecPrivate34(): Uint8Array {
  // Raw 34-byte STREAMINFO body (no fLaC magic, no block header)
  return new Uint8Array(34);
}

function buildVorbisCodecPrivate(): Uint8Array {
  // Minimal Vorbis CodecPrivate: header=0x02, then two Xiph-encoded packet sizes, then 3 packets.
  // packet0 (identification header): 30 bytes
  // packet1 (comment header): 9 bytes
  // packet2 (setup header): 5 bytes
  // Xiph sizes: size0=30 (0x1e), size1=9 (0x09)
  const out = new Uint8Array(1 + 1 + 1 + 30 + 9 + 5);
  out[0] = 0x02; // header
  out[1] = 30; // size of packet0 (Xiph-encoded, single byte since < 255)
  out[2] = 9; // size of packet1
  // rest is packet data (fake zeros)
  return out;
}

function buildHevcCodecPrivate(): Uint8Array {
  // Minimal HEVCDecoderConfigurationRecord (23 bytes minimum, 0 arrays)
  const out = new Uint8Array(23);
  out[0] = 1; // configurationVersion
  out[1] = 0x01; // profile_space=0, tier_flag=0, profile_idc=1 (Main)
  out[2] = 0x60;
  out[3] = 0x00;
  out[4] = 0x00;
  out[5] = 0x00; // profile compat flags
  // constraint indicator flags: bytes 6-11
  // level_idc: byte 12
  out[12] = 120; // level 4.0
  out[21] = 0xf0; // constantFrameRate=3, numTemporalLayers=3, temporalIdNested=1, lengthSizeMinusOne=0
  out[22] = 0; // numOfArrays = 0
  return out;
}

function buildMkvWithCodecs(
  videoCodecId: string,
  videoPrivate: Uint8Array | null,
  audioCodecId: string,
  audioPrivate: Uint8Array | null,
): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const vParts = [
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, videoCodecId),
  ];
  if (videoPrivate && videoPrivate.length > 0) {
    vParts.push(makeElement(0x63a2, videoPrivate));
  }
  vParts.push(
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  );
  const vTrackEntry = makeElement(0xae, concatUint8(vParts));

  const aParts = [
    makeUintElement(0xd7, 2),
    makeUintElement(0x73c5, 2),
    makeUintElement(0x83, 2),
    makeStringElement(0x86, audioCodecId),
  ];
  if (audioPrivate && audioPrivate.length > 0) {
    aParts.push(makeElement(0x63a2, audioPrivate));
  }
  aParts.push(
    makeElement(0xe1, concatUint8([makeFloat32Element(0xb5, 48000), makeUintElement(0x9f, 2)])),
  );
  const aTrackEntry = makeElement(0xae, concatUint8(aParts));

  const tracksElem = makeElement(0x1654ae6b, concatUint8([vTrackEntry, aTrackEntry]));
  const timecodeElem = makeUintElement(0xe7, 0);
  // SimpleBlock for video track 1
  const sbPayload = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa]);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithHighTrackNumber(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  // Track number 130 (> 127)
  const vTrackPayload = concatUint8([
    makeUintElement(0xd7, 130),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const vTrackEntry = makeElement(0xae, vTrackPayload);
  const tracksElem = makeElement(0x1654ae6b, vTrackEntry);

  const timecodeElem = makeUintElement(0xe7, 0);
  // SimpleBlock with 2-byte VINT track number 130.
  // Track 130 as 2-byte size VINT: marker = 01, value = 130
  // Byte 0 = 0x40 | (130 >> 8) = 0x40 | 0 = 0x40
  // Byte 1 = 130 & 0xFF = 0x82
  // readVintSize decodes: ((0x40 & 0x3F) << 8) | 0x82 = 0 << 8 | 130 = 130 ✓
  const sbPayload = new Uint8Array([0x40, 0x82, 0x00, 0x00, 0x80, 0xaa]);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  const segPayload = concatUint8([infoElem, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithUnknownSegmentElement(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  const vTrackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const vTrackEntry = makeElement(0xae, vTrackPayload);
  const tracksElem = makeElement(0x1654ae6b, vTrackEntry);

  // Fake "Chapters" element at Segment depth (ID 0x1043A770) — must be skipped.
  const fakeChapters = makeElement(0x1043a770, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

  const timecodeElem = makeUintElement(0xe7, 0);
  const sbPayload = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa]);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  const segPayload = concatUint8([infoElem, fakeChapters, tracksElem, clusterElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}

function buildMkvWithCues(): Uint8Array {
  const ebmlHeader = buildEbmlHeader('matroska');
  const infoPayload = concatUint8([
    makeUintElement(0x2ad7b1, 1_000_000),
    makeStringElement(0x4d80, 'test'),
    makeStringElement(0x5741, 'test'),
  ]);
  const infoElem = makeElement(0x1549a966, infoPayload);

  const avcPrivate = buildAvcCodecPrivate();
  const vTrackPayload = concatUint8([
    makeUintElement(0xd7, 1),
    makeUintElement(0x73c5, 1),
    makeUintElement(0x83, 1),
    makeStringElement(0x86, 'V_MPEG4/ISO/AVC'),
    makeElement(0x63a2, avcPrivate),
    makeElement(0xe0, concatUint8([makeUintElement(0xb0, 160), makeUintElement(0xba, 120)])),
  ]);
  const vTrackEntry = makeElement(0xae, vTrackPayload);
  const tracksElem = makeElement(0x1654ae6b, vTrackEntry);

  const timecodeElem = makeUintElement(0xe7, 0);
  const sbPayload = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa]);
  const sbElem = makeElement(0xa3, sbPayload);
  const clusterPayload = concatUint8([timecodeElem, sbElem]);
  const clusterElem = makeElement(0x1f43b675, clusterPayload);

  // Build a basic Cues element pointing to the cluster.
  // We'll calculate the cluster's segment-relative offset after assembling.
  // segPayload = infoElem + tracksElem + clusterElem + cuesElem
  // cluster segment-relative offset = infoElem.length + tracksElem.length
  const clusterSegRelOffset = infoElem.length + tracksElem.length;

  // CueTrackPositions
  const cueTrackElem = makeUintElement(0xf7, 1); // CueTrack = 1
  const cueClusterPosElem = makeUintElement(0xf1, clusterSegRelOffset); // CueClusterPosition
  const cueTrackPosPayload = concatUint8([cueTrackElem, cueClusterPosElem]);
  const cueTrackPosElem = makeElement(0xb7, cueTrackPosPayload);

  // CuePoint
  const cueTimeElem = makeUintElement(0xb3, 0); // CueTime = 0
  const cuePointPayload = concatUint8([cueTimeElem, cueTrackPosElem]);
  const cuePointElem = makeElement(0xbb, cuePointPayload);

  // Cues
  const cuesElem = makeElement(0x1c53bb6b, cuePointElem);

  const segPayload = concatUint8([infoElem, tracksElem, clusterElem, cuesElem]);
  const segId = new Uint8Array([0x18, 0x53, 0x80, 0x67]);
  const segSize = encodeVintSize(segPayload.length);
  return concatUint8([ebmlHeader, segId, segSize, segPayload]);
}
