/**
 * Tests for block iterator (block-iterator.ts).
 */

import { describe, expect, it } from 'vitest';
import { iterateAudioChunks, iterateVideoChunks } from './block-iterator.ts';
import type { MkvCluster, MkvSimpleBlock } from './elements/cluster.ts';
import type { MkvAudioTrack, MkvVideoTrack } from './elements/tracks.ts';
import type { MkvFile } from './parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAacAsc(): Uint8Array {
  return new Uint8Array([0x11, 0x90]); // AAC-LC
}

function buildAvcCodecPrivate(): Uint8Array {
  return new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe0, 0x00]);
}

function makeVideoTrack(trackNumber: number): MkvVideoTrack {
  return {
    trackNumber,
    trackUid: BigInt(trackNumber),
    trackType: 1,
    codecId: 'V_MPEG4/ISO/AVC',
    codecPrivate: buildAvcCodecPrivate(),
    pixelWidth: 320,
    pixelHeight: 240,
    webcodecsCodecString: 'avc1.640028',
  };
}

function makeAudioTrack(trackNumber: number): MkvAudioTrack {
  return {
    trackNumber,
    trackUid: BigInt(trackNumber),
    trackType: 2,
    codecId: 'A_AAC',
    codecPrivate: buildAacAsc(),
    samplingFrequency: 44100,
    channels: 2,
    webcodecsCodecString: 'mp4a.40.2',
  };
}

function makeBlock(
  trackNumber: number,
  timestampNs: bigint,
  keyframe: boolean,
  frames: Uint8Array[],
): MkvSimpleBlock {
  return { trackNumber, timestampNs, keyframe, invisible: false, discardable: false, frames };
}

function buildFile(tracks: (MkvVideoTrack | MkvAudioTrack)[], clusters: MkvCluster[]): MkvFile {
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
    info: { timecodeScale: 1_000_000, muxingApp: 'test', writingApp: 'test' },
    tracks,
    clusters,
    fileBytes: new Uint8Array(0),
  };
}

// ---------------------------------------------------------------------------
// iterateVideoChunks tests
// ---------------------------------------------------------------------------

describe('iterateVideoChunks', () => {
  it('yields one VideoChunk per frame for a single unlaced block', () => {
    const frame = new Uint8Array([0x01, 0x02, 0x03]);
    const block = makeBlock(1, 1_000_000n, true, [frame]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('key');
    expect(chunks[0]?.data).toEqual(frame);
    expect(chunks[0]?.timestampUs).toBe(1000); // 1_000_000n / 1000n = 1000
  });

  it('yields delta type for non-keyframe blocks', () => {
    const frame = new Uint8Array([0xaa]);
    const block = makeBlock(1, 33_333n, false, [frame]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks[0]?.type).toBe('delta');
  });

  it('converts timestampNs to microseconds (divide by 1000)', () => {
    // 3_000_000ns → 3000µs
    const block = makeBlock(1, 3_000_000n, true, [new Uint8Array([0x01])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks[0]?.timestampUs).toBe(3000);
  });

  it('yields multiple frames from a laced block (multiple frames array)', () => {
    const f0 = new Uint8Array([0xaa]);
    const f1 = new Uint8Array([0xbb]);
    const f2 = new Uint8Array([0xcc]);
    const block = makeBlock(1, 0n, true, [f0, f1, f2]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.data).toEqual(f0);
    expect(chunks[1]?.data).toEqual(f1);
    expect(chunks[2]?.data).toEqual(f2);
  });

  it('skips blocks from other track numbers', () => {
    const b1 = makeBlock(1, 0n, true, [new Uint8Array([0x01])]);
    const b2 = makeBlock(2, 0n, true, [new Uint8Array([0x02])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [b1, b2] };
    const file = buildFile([makeVideoTrack(1), makeAudioTrack(2)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.data[0]).toBe(0x01);
  });

  it('yields chunks from multiple clusters in order', () => {
    const b1 = makeBlock(1, 0n, true, [new Uint8Array([0x01])]);
    const b2 = makeBlock(1, 1_000_000n, false, [new Uint8Array([0x02])]);
    const c1: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [b1] };
    const c2: MkvCluster = { fileOffset: 100, timecode: 1000n, blocks: [b2] };
    const file = buildFile([makeVideoTrack(1)], [c1, c2]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.type).toBe('key');
    expect(chunks[1]?.type).toBe('delta');
  });

  it('returns empty iterator when no matching track', () => {
    const block = makeBlock(1, 0n, true, [new Uint8Array([0x01])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 99)]; // track 99 doesn't exist
    expect(chunks).toHaveLength(0);
  });

  it('returns empty iterator for empty clusters', () => {
    const file = buildFile([makeVideoTrack(1)], []);
    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks).toHaveLength(0);
  });

  it('handles timestampNs=0n correctly (timestampUs=0)', () => {
    const block = makeBlock(1, 0n, true, [new Uint8Array([0x01])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeVideoTrack(1)], [cluster]);

    const chunks = [...iterateVideoChunks(file, 1)];
    expect(chunks[0]?.timestampUs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// iterateAudioChunks tests
// ---------------------------------------------------------------------------

describe('iterateAudioChunks', () => {
  it('yields one AudioChunk per frame', () => {
    const frame = new Uint8Array([0xfe, 0xed]);
    const block = makeBlock(2, 2_000_000n, true, [frame]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeAudioTrack(2)], [cluster]);

    const chunks = [...iterateAudioChunks(file, 2)];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.data).toEqual(frame);
    expect(chunks[0]?.timestampUs).toBe(2000); // 2_000_000n / 1000n = 2000
  });

  it('does not include a type field (audio chunks have no type)', () => {
    const block = makeBlock(2, 0n, true, [new Uint8Array([0x01])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeAudioTrack(2)], [cluster]);

    const chunks = [...iterateAudioChunks(file, 2)];
    expect(chunks[0]).not.toHaveProperty('type');
  });

  it('skips blocks from other track numbers', () => {
    const b1 = makeBlock(1, 0n, true, [new Uint8Array([0x01])]);
    const b2 = makeBlock(2, 0n, true, [new Uint8Array([0x02])]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [b1, b2] };
    const file = buildFile([makeVideoTrack(1), makeAudioTrack(2)], [cluster]);

    const chunks = [...iterateAudioChunks(file, 2)];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.data[0]).toBe(0x02);
  });

  it('yields multiple frames from laced audio block', () => {
    const f0 = new Uint8Array([0x01]);
    const f1 = new Uint8Array([0x02]);
    const block = makeBlock(2, 0n, true, [f0, f1]);
    const cluster: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [block] };
    const file = buildFile([makeAudioTrack(2)], [cluster]);

    const chunks = [...iterateAudioChunks(file, 2)];
    expect(chunks).toHaveLength(2);
  });

  it('yields chunks from multiple clusters', () => {
    const b1 = makeBlock(2, 0n, true, [new Uint8Array([0x01])]);
    const b2 = makeBlock(2, 1_000_000n, true, [new Uint8Array([0x02])]);
    const c1: MkvCluster = { fileOffset: 0, timecode: 0n, blocks: [b1] };
    const c2: MkvCluster = { fileOffset: 100, timecode: 1000n, blocks: [b2] };
    const file = buildFile([makeAudioTrack(2)], [c1, c2]);

    const chunks = [...iterateAudioChunks(file, 2)];
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.timestampUs).toBe(0);
    expect(chunks[1]?.timestampUs).toBe(1000);
  });

  it('returns empty iterator when no matching track', () => {
    const file = buildFile([makeAudioTrack(2)], []);
    const chunks = [...iterateAudioChunks(file, 99)];
    expect(chunks).toHaveLength(0);
  });
});
