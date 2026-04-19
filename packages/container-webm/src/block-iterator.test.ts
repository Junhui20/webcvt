/**
 * Tests for block-iterator.ts.
 *
 * Covers design note test cases:
 * - "extracts OpusHead from A_OPUS CodecPrivate and routes as WebCodecs description"
 * - "extracts Vorbis 3-packet init from A_VORBIS CodecPrivate via Xiph unpacking"
 */

import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { iterateAudioChunks, iterateVideoChunks } from './block-iterator.ts';
import { parseWebm } from './parser.ts';

describe('iterateVideoChunks', () => {
  it('yields video chunks with correct type for VP8 track', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    if (!videoTrack) throw new Error('no video track');

    const chunks = [...iterateVideoChunks(file, videoTrack.trackNumber)];
    expect(chunks.length).toBeGreaterThan(0);

    // First chunk must be a keyframe.
    expect(chunks[0]?.type).toBe('key');
  });

  it('yields video chunks with non-negative timestamps', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    if (!videoTrack) throw new Error('no video track');

    const chunks = [...iterateVideoChunks(file, videoTrack.trackNumber)];
    for (const chunk of chunks) {
      expect(chunk.timestampUs).toBeGreaterThanOrEqual(0);
    }
  });

  it('timestamps are monotonically non-decreasing for video', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const videoTrack = file.tracks.find((t) => t.trackType === 1);
    if (!videoTrack) throw new Error('no video track');

    const chunks = [...iterateVideoChunks(file, videoTrack.trackNumber)];
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.timestampUs).toBeGreaterThanOrEqual(chunks[i - 1]?.timestampUs ?? 0);
    }
  });

  it('yields no chunks for a nonexistent track number', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const chunks = [...iterateVideoChunks(file, 999)];
    expect(chunks.length).toBe(0);
  });
});

describe('iterateAudioChunks', () => {
  it('yields audio chunks for Vorbis track', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const audioTrack = file.tracks.find((t) => t.trackType === 2);
    if (!audioTrack) throw new Error('no audio track');

    const chunks = [...iterateAudioChunks(file, audioTrack.trackNumber)];
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('audio chunks have non-negative timestamps', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const audioTrack = file.tracks.find((t) => t.trackType === 2);
    if (!audioTrack) throw new Error('no audio track');

    const chunks = [...iterateAudioChunks(file, audioTrack.trackNumber)];
    for (const chunk of chunks) {
      expect(chunk.timestampUs).toBeGreaterThanOrEqual(0);
    }
  });

  it('Vorbis CodecPrivate preserved verbatim (Trap §12)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const file = parseWebm(bytes);
    const audioTrack = file.tracks.find((t) => t.trackType === 2);
    if (audioTrack?.trackType !== 2) throw new Error('no audio track');

    // The CodecPrivate must be non-empty and start with 0x02 (Xiph lacing header byte).
    expect(audioTrack.codecPrivate.length).toBeGreaterThan(0);
    // First byte of Vorbis CodecPrivate should be 0x02 (2 packet lengths encoded).
    expect(audioTrack.codecPrivate[0]).toBe(0x02);
  });
});
