/**
 * Tests for WebmBackend (backend.ts).
 *
 * Covers:
 * - canHandle: identity-only (video/webm → video/webm returns true)
 * - canHandle: cross-MIME returns false
 * - canHandle: non-WebM inputs return false
 * - convert: identity round-trip
 * - convert: throws for non-WebM output MIME
 * - convert: throws for oversized input
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { loadFixture } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { WebmBackend } from './backend.ts';
import { WebmEncodeNotImplementedError, WebmInputTooLargeError } from './errors.ts';

const WEBM_VIDEO: FormatDescriptor = {
  ext: 'webm',
  mime: 'video/webm',
  category: 'video',
};

const WEBM_AUDIO: FormatDescriptor = {
  ext: 'webm',
  mime: 'audio/webm',
  category: 'audio',
};

const MP4: FormatDescriptor = {
  ext: 'mp4',
  mime: 'video/mp4',
  category: 'video',
};

const M4A: FormatDescriptor = {
  ext: 'm4a',
  mime: 'audio/mp4',
  category: 'audio',
};

const MP4_OUTPUT: FormatDescriptor = {
  ext: 'mp4',
  mime: 'video/mp4',
  category: 'video',
};

describe('WebmBackend.convert', () => {
  const backend = new WebmBackend();

  it('converts video/webm → video/webm identity round-trip', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/webm' });
    const output = WEBM_VIDEO;
    const result = await backend.convert(blob, output, {});
    expect(result.blob.type).toBe('video/webm');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.backend).toBe('container-webm');
    expect(result.hardwareAccelerated).toBe(false);
  });

  it('throws WebmEncodeNotImplementedError for non-WebM output MIME', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/webm' });
    await expect(backend.convert(blob, MP4_OUTPUT, {})).rejects.toThrow(
      WebmEncodeNotImplementedError,
    );
  });

  it('throws WebmInputTooLargeError when input exceeds 200 MiB', async () => {
    // Fake a blob with reported size > 200 MiB (no actual bytes needed).
    const oversizedBlob = {
      size: 201 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(0),
      type: 'video/webm',
    } as unknown as Blob;
    await expect(backend.convert(oversizedBlob, WEBM_VIDEO, {})).rejects.toThrow(
      WebmInputTooLargeError,
    );
  });

  it('calls onProgress callbacks during convert', async () => {
    const bytes = await loadFixture('video/testsrc-1s-160x120-vp8-vorbis.webm');
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/webm' });
    const progresses: number[] = [];
    await backend.convert(blob, WEBM_VIDEO, {
      onProgress: ({ percent }) => progresses.push(percent),
    });
    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses).toContain(5);
    expect(progresses).toContain(100);
  });
});

describe('WebmBackend.canHandle', () => {
  const backend = new WebmBackend();

  it('returns true for video/webm → video/webm (identity)', async () => {
    expect(await backend.canHandle(WEBM_VIDEO, WEBM_VIDEO)).toBe(true);
  });

  it('returns true for audio/webm → audio/webm (identity)', async () => {
    expect(await backend.canHandle(WEBM_AUDIO, WEBM_AUDIO)).toBe(true);
  });

  it('returns false for video/webm → audio/webm (cross-MIME relabel)', async () => {
    expect(await backend.canHandle(WEBM_VIDEO, WEBM_AUDIO)).toBe(false);
  });

  it('returns false for audio/webm → video/webm', async () => {
    expect(await backend.canHandle(WEBM_AUDIO, WEBM_VIDEO)).toBe(false);
  });

  it('returns false for video/mp4 → video/mp4', async () => {
    expect(await backend.canHandle(MP4, MP4)).toBe(false);
  });

  it('returns false for video/webm → video/mp4', async () => {
    expect(await backend.canHandle(WEBM_VIDEO, MP4)).toBe(false);
  });

  it('returns false for audio/mp4 → audio/mp4', async () => {
    expect(await backend.canHandle(M4A, M4A)).toBe(false);
  });

  it('has stable name identifier', () => {
    expect(backend.name).toBe('container-webm');
  });
});
