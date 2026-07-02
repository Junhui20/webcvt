import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { TranscodeDemuxError } from './errors.ts';
import { demuxContainerAudioTrack, demuxContainerVideo } from './video-demux.ts';

describe('demuxContainerVideo', () => {
  it('mp4 (h264 + aac): video carries avcC description + geometry, audio present', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mp4');
    const { video, audio } = demuxContainerVideo('mp4', bytes);

    expect(video.codec).toBe('h264');
    expect(video.config.codec.startsWith('avc1')).toBe(true);
    expect(video.config.description).toBeInstanceOf(Uint8Array);
    expect(video.width).toBe(160);
    expect(video.height).toBe(120);
    expect(video.chunks.length).toBeGreaterThan(1);
    expect(video.chunks[0]?.type).toBe('key');
    // Monotone non-decreasing timestamps.
    for (let i = 1; i < video.chunks.length; i++) {
      expect(video.chunks[i]!.timestampUs).toBeGreaterThanOrEqual(video.chunks[i - 1]!.timestampUs);
    }

    expect(audio).not.toBeNull();
    expect(audio?.config.codec).toBe('mp4a.40.2');
    expect(audio?.config.description).toBeInstanceOf(Uint8Array);
    expect(audio?.chunks.length).toBeGreaterThan(1);
  });

  it('mkv (h264 + aac): video via webcodecsCodecString + codecPrivate, audio aac', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-h264-aac.mkv');
    const { video, audio } = demuxContainerVideo('mkv', bytes);

    expect(video.codec).toBe('h264');
    expect(video.config.description).toBeInstanceOf(Uint8Array); // avcC in codecPrivate
    expect(video.width).toBe(160);
    expect(video.height).toBe(120);
    expect(video.chunks.length).toBeGreaterThan(1);
    expect(audio?.config.codec).toBe('mp4a.40.2');
    expect(audio?.chunks.length).toBeGreaterThan(1);
  });

  it('webm (vp8 + vorbis): video vp8, audio null (Vorbis not decodable here → video-only)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const { video, audio } = demuxContainerVideo('webm', bytes);

    expect(video.codec).toBe('vp8');
    expect(video.config.codec).toBe('vp8');
    expect(video.config.description).toBeUndefined(); // VP8 has no codec-private
    expect(video.width).toBe(160);
    expect(video.height).toBe(120);
    expect(video.chunks.length).toBeGreaterThan(1);
    expect(audio).toBeNull();
  });
});

describe('demuxContainerAudioTrack', () => {
  it('m4a (audio/mp4): extracts the AAC track for the audio matrix', async () => {
    const bytes = await loadFixture('audio/sine-1s-44100-mono.m4a');
    const track = demuxContainerAudioTrack('mp4', bytes);
    expect(track.config.codec).toBe('mp4a.40.2');
    expect(track.numberOfChannels).toBe(1);
    expect(track.sampleRate).toBe(44100);
    expect(track.chunks.length).toBeGreaterThan(1);
  });

  it('throws when the container has no decodable audio (webm/vorbis)', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    expect(() => demuxContainerAudioTrack('webm', bytes)).toThrow(TranscodeDemuxError);
  });
});
