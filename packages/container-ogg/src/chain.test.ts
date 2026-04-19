/**
 * Chain iteration helper tests.
 */

import { describe, expect, it } from 'vitest';
import { allPacketsInOrder, firstStream, iterateStreams, streamsByCodec } from './chain.ts';
import type { OggFile, OggLogicalStream } from './parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(codec: OggLogicalStream['codec'], serialNumber = 1): OggLogicalStream {
  return {
    serialNumber,
    codec,
    identification: new Uint8Array([0x01]),
    comments: undefined,
    setup: undefined,
    packets: [
      {
        data: new Uint8Array([codec === 'vorbis' ? 0xaa : 0xbb]),
        granulePosition: 100n,
        serialNumber,
      },
    ],
    preSkip: codec === 'opus' ? 312 : 0,
    sampleRate: codec === 'opus' ? 48000 : 44100,
    channels: 1,
  };
}

function makeFile(streams: OggLogicalStream[]): OggFile {
  return { streams };
}

// ---------------------------------------------------------------------------
// iterateStreams
// ---------------------------------------------------------------------------

describe('iterateStreams', () => {
  it('visits each stream in order', () => {
    const file = makeFile([makeStream('vorbis', 1), makeStream('opus', 2)]);
    const visited: number[] = [];
    iterateStreams(file, (s, i) => {
      visited.push(i);
    });
    expect(visited).toEqual([0, 1]);
  });

  it('stops early when visitor returns false', () => {
    const file = makeFile([
      makeStream('vorbis', 1),
      makeStream('opus', 2),
      makeStream('vorbis', 3),
    ]);
    const visited: number[] = [];
    iterateStreams(file, (s, i) => {
      visited.push(i);
      return i === 0 ? false : undefined;
    });
    expect(visited).toEqual([0]);
  });

  it('handles empty file', () => {
    const file = makeFile([]);
    const visited: number[] = [];
    iterateStreams(file, (s, i) => {
      visited.push(i);
    });
    expect(visited).toEqual([]);
  });

  it('skips undefined entries in sparse streams array', () => {
    // Simulate a sparse array where streams[0] is undefined.
    const s = makeStream('vorbis', 2);
    const sparseFile = { streams: [undefined as unknown as OggLogicalStream, s] };
    const visited: number[] = [];
    iterateStreams(sparseFile, (stream, i) => {
      visited.push(i);
    });
    // Only index 1 should be visited (index 0 is undefined).
    expect(visited).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// firstStream
// ---------------------------------------------------------------------------

describe('firstStream', () => {
  it('returns the first stream', () => {
    const s = makeStream('vorbis', 1);
    const file = makeFile([s, makeStream('opus', 2)]);
    expect(firstStream(file)).toBe(s);
  });

  it('returns undefined for empty file', () => {
    expect(firstStream(makeFile([]))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// streamsByCodec
// ---------------------------------------------------------------------------

describe('streamsByCodec', () => {
  it('filters by codec', () => {
    const file = makeFile([
      makeStream('vorbis', 1),
      makeStream('opus', 2),
      makeStream('vorbis', 3),
    ]);
    const vorbisStreams = streamsByCodec(file, 'vorbis');
    expect(vorbisStreams.length).toBe(2);
    expect(vorbisStreams[0]?.serialNumber).toBe(1);
    expect(vorbisStreams[1]?.serialNumber).toBe(3);
  });

  it('returns empty array when no match', () => {
    const file = makeFile([makeStream('vorbis', 1)]);
    expect(streamsByCodec(file, 'opus').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// allPacketsInOrder
// ---------------------------------------------------------------------------

describe('allPacketsInOrder', () => {
  it('returns all packets from all streams in order', () => {
    const s1 = makeStream('vorbis', 1);
    const s2 = makeStream('opus', 2);
    // Give s2 two packets.
    const extra = { data: new Uint8Array([0xcc]), granulePosition: 200n, serialNumber: 2 };
    const s2WithTwo: OggLogicalStream = { ...s2, packets: [...s2.packets, extra] };

    const file = makeFile([s1, s2WithTwo]);
    const all = allPacketsInOrder(file);

    expect(all.length).toBe(3);
    expect(all[0]?.streamIndex).toBe(0);
    expect(all[0]?.packetIndex).toBe(0);
    expect(all[1]?.streamIndex).toBe(1);
    expect(all[1]?.packetIndex).toBe(0);
    expect(all[2]?.streamIndex).toBe(1);
    expect(all[2]?.packetIndex).toBe(1);
  });

  it('returns empty array for file with no packets', () => {
    const s = { ...makeStream('vorbis', 1), packets: [] };
    const all = allPacketsInOrder(makeFile([s]));
    expect(all.length).toBe(0);
  });

  it('skips undefined stream entries in allPacketsInOrder', () => {
    const s = makeStream('opus', 2);
    const sparseFile = { streams: [undefined as unknown as OggLogicalStream, s] };
    const all = allPacketsInOrder(sparseFile);
    expect(all.length).toBe(1);
    expect(all[0]?.streamIndex).toBe(1);
  });

  it('skips undefined packet entries in allPacketsInOrder', () => {
    const s = makeStream('vorbis', 1);
    // Inject an undefined into the packets array.
    const sparsePackets = [undefined as unknown as (typeof s.packets)[0], s.packets[0]!];
    const sparseStream = { ...s, packets: sparsePackets };
    const all = allPacketsInOrder(makeFile([sparseStream]));
    // Only the defined packet at index 1 should be included.
    expect(all.length).toBe(1);
    expect(all[0]?.packetIndex).toBe(1);
  });
});
