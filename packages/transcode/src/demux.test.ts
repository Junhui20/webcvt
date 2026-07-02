import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { demuxAudio } from './demux.ts';
import { TranscodeDemuxError } from './errors.ts';

describe('demuxAudio', () => {
  it('wav → pcm (no decoder needed)', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.wav');
    const result = demuxAudio('pcm', bytes);
    expect(result.kind).toBe('pcm');
    if (result.kind === 'pcm') {
      expect(result.decoded.sampleRate).toBe(44100);
      expect(result.decoded.numberOfChannels).toBe(1);
      expect(result.decoded.numberOfFrames).toBeGreaterThan(0);
    }
  });

  it('mp3 → encoded chunks with codec "mp3" and derived timestamps', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.mp3');
    const result = demuxAudio('mp3', bytes);
    expect(result.kind).toBe('encoded');
    if (result.kind === 'encoded') {
      expect(result.config.codec).toBe('mp3');
      expect(result.sampleRate).toBe(44100);
      expect(result.numberOfChannels).toBe(1);
      expect(result.chunks.length).toBeGreaterThan(1);
      // Timestamps are monotone non-decreasing.
      for (let i = 1; i < result.chunks.length; i++) {
        expect(result.chunks[i]!.timestampUs).toBeGreaterThanOrEqual(
          result.chunks[i - 1]!.timestampUs,
        );
      }
    }
  });

  it('aac → encoded chunks with an AudioSpecificConfig description and stripped ADTS header', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.aac');
    const result = demuxAudio('aac', bytes);
    expect(result.kind).toBe('encoded');
    if (result.kind === 'encoded') {
      expect(result.config.codec).toBe('mp4a.40.2');
      expect(result.config.description).toBeDefined();
      expect((result.config.description as Uint8Array).length).toBe(5); // 5-byte ASC
      expect(result.chunks.length).toBe(45);
    }
  });

  it('flac → encoded chunks with a fLaC+STREAMINFO description', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.flac');
    const result = demuxAudio('flac', bytes);
    expect(result.kind).toBe('encoded');
    if (result.kind === 'encoded') {
      expect(result.config.codec).toBe('flac');
      const desc = result.config.description as Uint8Array;
      // Starts with the "fLaC" stream marker.
      expect(Array.from(desc.subarray(0, 4))).toEqual([0x66, 0x4c, 0x61, 0x43]);
      expect(result.chunks.length).toBe(10);
    }
  });

  it('rejects Vorbis-in-Ogg input (only opus-in-ogg is decodable here)', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.ogg'); // this fixture is vorbis
    expect(() => demuxAudio('opus', bytes)).toThrow(TranscodeDemuxError);
  });

  it('wraps a corrupt container as TranscodeDemuxError', () => {
    expect(() => demuxAudio('mp3', new Uint8Array([0, 1, 2, 3]))).toThrow(TranscodeDemuxError);
  });
});
