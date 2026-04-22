/**
 * Tests for backend.ts — Mp4Backend.
 *
 * Covers:
 * - canHandle identity-only gate (audio/mp4 → audio/mp4 = true)
 * - canHandle cross-MIME rejection
 * - convert identity round-trip
 * - convert non-M4A output throws Mp4EncodeNotImplementedError
 */

import { loadFixtureBlob } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { M4A_FORMAT, Mp4Backend } from './backend.ts';
import { Mp4EncodeNotImplementedError } from './errors.ts';

const M4A: { ext: string; mime: string; category: 'audio'; description: string } = {
  ext: 'm4a',
  mime: 'audio/mp4',
  category: 'audio',
  description: 'MP4 audio',
};

const MP4_VIDEO: { ext: string; mime: string; category: 'video'; description: string } = {
  ext: 'mp4',
  mime: 'video/mp4',
  category: 'video',
  description: 'MP4 video',
};

const OGG: { ext: string; mime: string; category: 'audio'; description: string } = {
  ext: 'ogg',
  mime: 'audio/ogg',
  category: 'audio',
  description: 'Ogg',
};

describe('Mp4Backend.canHandle', () => {
  const backend = new Mp4Backend();

  it('returns true for audio/mp4 → audio/mp4 (identity)', async () => {
    expect(await backend.canHandle(M4A, M4A)).toBe(true);
  });

  it('returns false for video/mp4 → audio/mp4 (cross-MIME relabel)', async () => {
    expect(await backend.canHandle(MP4_VIDEO, M4A)).toBe(false);
  });

  it('returns false for audio/mp4 → video/mp4', async () => {
    expect(await backend.canHandle(M4A, MP4_VIDEO)).toBe(false);
  });

  it('returns false for audio/mp4 → audio/ogg (transcode)', async () => {
    expect(await backend.canHandle(M4A, OGG)).toBe(false);
  });

  it('returns false for audio/ogg → audio/mp4', async () => {
    expect(await backend.canHandle(OGG, M4A)).toBe(false);
  });

  it('has a stable name', () => {
    expect(backend.name).toBe('container-mp4');
  });
});

describe('Mp4Backend.convert', () => {
  it('converts audio/mp4 → audio/mp4 (identity round-trip)', async () => {
    const backend = new Mp4Backend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.m4a', 'audio/mp4');
    const result = await backend.convert(blob, M4A, { format: M4A });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('audio/mp4');
    expect(result.backend).toBe('container-mp4');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('throws Mp4EncodeNotImplementedError for non-M4A output', async () => {
    const backend = new Mp4Backend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.m4a', 'audio/mp4');
    await expect(backend.convert(blob, OGG, { format: OGG })).rejects.toThrow(
      Mp4EncodeNotImplementedError,
    );
  });

  it('reports progress callbacks', async () => {
    const backend = new Mp4Backend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.m4a', 'audio/mp4');
    const progressEvents: number[] = [];
    await backend.convert(blob, M4A, {
      format: M4A,
      onProgress: (ev) => progressEvents.push(ev.percent),
    });
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });
});

describe('M4A_FORMAT', () => {
  it('has correct ext and mime', () => {
    expect(M4A_FORMAT.ext).toBe('m4a');
    expect(M4A_FORMAT.mime).toBe('audio/mp4');
    expect(M4A_FORMAT.category).toBe('audio');
  });
});
