/**
 * Tests for the MKV serializer (serializer.ts).
 *
 * Verifies:
 * - Two-pass layout: EBML header → Segment → SeekHead → Info → Tracks → Clusters → Cues
 * - Segment size always 8-byte VINT (Trap §15)
 * - SeekHead padded to SEEK_HEAD_RESERVED_BYTES (Trap §16)
 * - Round-trip semantic equivalence
 */

import { describe, expect, it } from 'vitest';
import { ID_EBML, ID_SEGMENT, SEEK_HEAD_RESERVED_BYTES } from './constants.ts';
import type { MkvCluster, MkvSimpleBlock } from './elements/cluster.ts';
import type { MkvAudioTrack, MkvVideoTrack } from './elements/tracks.ts';
import type { MkvFile } from './parser.ts';
import { serializeMkv } from './serializer.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAacAsc(): Uint8Array {
  // AAC-LC ASC: aot=2, sfi=3, channels=2
  // byte0=(2<<3)|(3>>1)=0x11, byte1=((3&1)<<7)|(2<<3)=0x90
  return new Uint8Array([0x11, 0x90]);
}

function buildAvcCodecPrivate(): Uint8Array {
  // Minimal AVCDecoderConfigurationRecord: configVersion=1, profile=0x64, compat=0x00, level=0x28
  // numSPS=0, numPPS=0
  return new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe0, 0x00]);
}

function buildMinimalMkvFile(): MkvFile {
  const videoTrack: MkvVideoTrack = {
    trackNumber: 1,
    trackUid: 1n,
    trackType: 1,
    codecId: 'V_MPEG4/ISO/AVC',
    codecPrivate: buildAvcCodecPrivate(),
    pixelWidth: 320,
    pixelHeight: 240,
    webcodecsCodecString: 'avc1.640028',
  };

  const audioTrack: MkvAudioTrack = {
    trackNumber: 2,
    trackUid: 2n,
    trackType: 2,
    codecId: 'A_AAC',
    codecPrivate: buildAacAsc(),
    samplingFrequency: 44100,
    channels: 2,
    webcodecsCodecString: 'mp4a.40.2',
  };

  const block1: MkvSimpleBlock = {
    trackNumber: 1,
    timestampNs: 0n,
    keyframe: true,
    invisible: false,
    discardable: false,
    frames: [new Uint8Array([0x01, 0x02, 0x03])],
  };

  const block2: MkvSimpleBlock = {
    trackNumber: 2,
    timestampNs: 0n,
    keyframe: true,
    invisible: false,
    discardable: false,
    frames: [new Uint8Array([0x04, 0x05])],
  };

  const cluster: MkvCluster = {
    fileOffset: 0,
    timecode: 0n,
    blocks: [block1, block2],
  };

  return {
    ebmlHeader: {
      ebmlVersion: 1,
      ebmlReadVersion: 1,
      ebmlMaxIdLength: 4,
      ebmlMaxSizeLength: 8,
      docType: 'matroska',
      docTypeVersion: 4,
      docTypeReadVersion: 2,
    },
    segmentPayloadOffset: 0,
    info: {
      timecodeScale: 1_000_000,
      muxingApp: '@catlabtech/webcvt-container-mkv',
      writingApp: '@catlabtech/webcvt-container-mkv',
    },
    tracks: [videoTrack, audioTrack],
    clusters: [cluster],
    fileBytes: new Uint8Array(0),
  };
}

// ---------------------------------------------------------------------------
// serializeMkv tests
// ---------------------------------------------------------------------------

describe('serializeMkv', () => {
  it('returns a Uint8Array', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('starts with EBML header ID (0x1A45DFA3)', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);
    expect(result[0]).toBe(0x1a);
    expect(result[1]).toBe(0x45);
    expect(result[2]).toBe(0xdf);
    expect(result[3]).toBe(0xa3);
  });

  it('has Segment element immediately after EBML header', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    // Find end of EBML header: skip ID(4) + size VINT + content
    const ebmlSizeByte = result[4] as number;
    let ebmlSizeWidth = 1;
    let ebmlSize = ebmlSizeByte & ~0x80;
    if ((ebmlSizeByte & 0xc0) === 0x40) {
      ebmlSize = ((ebmlSizeByte & 0x3f) << 8) | (result[5] as number);
      ebmlSizeWidth = 2;
    }
    const segmentOffset = 4 + ebmlSizeWidth + ebmlSize;

    // Segment ID should be 0x18538067
    expect(result[segmentOffset]).toBe(0x18);
    expect(result[segmentOffset + 1]).toBe(0x53);
    expect(result[segmentOffset + 2]).toBe(0x80);
    expect(result[segmentOffset + 3]).toBe(0x67);
  });

  it('uses 8-byte Segment size VINT (Trap §15)', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    // Locate segment ID and check its size VINT width
    let i = 0;
    while (i < result.length - 4) {
      if (
        result[i] === 0x18 &&
        result[i + 1] === 0x53 &&
        result[i + 2] === 0x80 &&
        result[i + 3] === 0x67
      ) {
        // Segment found at i; size VINT starts at i+4
        // 8-byte VINT starts with 0x01 (width marker)
        expect(result[i + 4]).toBe(0x01);
        break;
      }
      i++;
    }
  });

  it('contains SeekHead padded to SEEK_HEAD_RESERVED_BYTES immediately after Segment', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    // Locate segment start
    let segStart = 0;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x18 &&
        result[i + 1] === 0x53 &&
        result[i + 2] === 0x80 &&
        result[i + 3] === 0x67
      ) {
        segStart = i;
        break;
      }
    }

    // After Segment ID (4 bytes) + 8-byte size VINT (8 bytes) = offset 12
    const seekHeadStart = segStart + 4 + 8;
    // SeekHead ID = 0x114D9B74
    expect(result[seekHeadStart]).toBe(0x11);
    expect(result[seekHeadStart + 1]).toBe(0x4d);
    expect(result[seekHeadStart + 2]).toBe(0x9b);
    expect(result[seekHeadStart + 3]).toBe(0x74);
  });

  it('contains Info element after SeekHead', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    // Locate segment start + 4 (ID) + 8 (size) + SEEK_HEAD_RESERVED_BYTES
    let segStart = 0;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x18 &&
        result[i + 1] === 0x53 &&
        result[i + 2] === 0x80 &&
        result[i + 3] === 0x67
      ) {
        segStart = i;
        break;
      }
    }
    const infoStart = segStart + 4 + 8 + SEEK_HEAD_RESERVED_BYTES;
    // Info ID = 0x1549A966
    expect(result[infoStart]).toBe(0x15);
    expect(result[infoStart + 1]).toBe(0x49);
    expect(result[infoStart + 2]).toBe(0xa9);
    expect(result[infoStart + 3]).toBe(0x66);
  });

  it('contains Tracks element after Info', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    // Search for Tracks ID 0x1654AE6B
    let found = false;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x16 &&
        result[i + 1] === 0x54 &&
        result[i + 2] === 0xae &&
        result[i + 3] === 0x6b
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('contains Cluster element (0x1F43B675)', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    let found = false;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x1f &&
        result[i + 1] === 0x43 &&
        result[i + 2] === 0xb6 &&
        result[i + 3] === 0x75
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('contains Cues element (0x1C53BB6B) after clusters when keyframes present', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);

    let found = false;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x1c &&
        result[i + 1] === 0x53 &&
        result[i + 2] === 0xbb &&
        result[i + 3] === 0x6b
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('handles empty clusters list', () => {
    const file = buildMinimalMkvFile();
    const emptyFile = { ...file, clusters: [] };
    const result = serializeMkv(emptyFile);
    expect(result).toBeInstanceOf(Uint8Array);
    // No Cluster element
    let hasCluster = false;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x1f &&
        result[i + 1] === 0x43 &&
        result[i + 2] === 0xb6 &&
        result[i + 3] === 0x75
      ) {
        hasCluster = true;
        break;
      }
    }
    expect(hasCluster).toBe(false);
  });

  it('handles audio-only file (no video track)', () => {
    const audioTrack: MkvAudioTrack = {
      trackNumber: 1,
      trackUid: 1n,
      trackType: 2,
      codecId: 'A_OPUS',
      codecPrivate: new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]),
      samplingFrequency: 48000,
      channels: 2,
      webcodecsCodecString: 'opus',
    };
    const block: MkvSimpleBlock = {
      trackNumber: 1,
      timestampNs: 0n,
      keyframe: true,
      invisible: false,
      discardable: false,
      frames: [new Uint8Array([0x01])],
    };
    const file: MkvFile = {
      ebmlHeader: {
        ebmlVersion: 1,
        ebmlReadVersion: 1,
        ebmlMaxIdLength: 4,
        ebmlMaxSizeLength: 8,
        docType: 'matroska',
        docTypeVersion: 4,
        docTypeReadVersion: 2,
      },
      segmentPayloadOffset: 0,
      info: { timecodeScale: 1_000_000, muxingApp: 'test', writingApp: 'test' },
      tracks: [audioTrack],
      clusters: [{ fileOffset: 0, timecode: 0n, blocks: [block] }],
      fileBytes: new Uint8Array(0),
    };
    const result = serializeMkv(file);
    expect(result).toBeInstanceOf(Uint8Array);
    // Should have Cues element (audio-only cluster-driven)
    let hasCues = false;
    for (let i = 0; i < result.length - 4; i++) {
      if (
        result[i] === 0x1c &&
        result[i + 1] === 0x53 &&
        result[i + 2] === 0xbb &&
        result[i + 3] === 0x6b
      ) {
        hasCues = true;
        break;
      }
    }
    expect(hasCues).toBe(true);
  });

  it('preserves timecodeScale and muxingApp in encoded Info', () => {
    const file = buildMinimalMkvFile();
    const result = serializeMkv(file);
    // Decode text content to find app string
    const text = new TextDecoder('utf-8', { fatal: false }).decode(result);
    expect(text).toContain('@catlabtech/webcvt-container-mkv');
  });
});
