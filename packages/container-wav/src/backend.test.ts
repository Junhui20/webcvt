/**
 * Tests for WavBackend — the webcvt Backend implementation.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { loadFixtureBlob } from '@catlabtech/webcvt-test-utils';
import { describe, expect, it } from 'vitest';
import { WAV_FORMAT, WavBackend } from './backend.ts';
import { parseWav } from './parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WAV_DESCRIPTOR: FormatDescriptor = {
  ext: 'wav',
  mime: 'audio/wav',
  category: 'audio',
  description: 'WAV',
};

const MP3_DESCRIPTOR: FormatDescriptor = {
  ext: 'mp3',
  mime: 'audio/mpeg',
  category: 'audio',
};

const BASE_OPTIONS = {
  format: WAV_DESCRIPTOR,
};

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('WavBackend.canHandle', () => {
  const backend = new WavBackend();

  it('returns true for WAV → WAV', async () => {
    expect(await backend.canHandle(WAV_DESCRIPTOR, WAV_DESCRIPTOR)).toBe(true);
  });

  it('returns true for audio/wave → audio/wav', async () => {
    const waveDesc: FormatDescriptor = { ext: 'wav', mime: 'audio/wave', category: 'audio' };
    expect(await backend.canHandle(waveDesc, WAV_DESCRIPTOR)).toBe(true);
  });

  it('returns true for audio/x-wav input', async () => {
    const xwav: FormatDescriptor = { ext: 'wav', mime: 'audio/x-wav', category: 'audio' };
    expect(await backend.canHandle(xwav, WAV_DESCRIPTOR)).toBe(true);
  });

  it('returns false for WAV → MP3 (encode not implemented)', async () => {
    expect(await backend.canHandle(WAV_DESCRIPTOR, MP3_DESCRIPTOR)).toBe(false);
  });

  it('returns false for MP3 → WAV', async () => {
    expect(await backend.canHandle(MP3_DESCRIPTOR, WAV_DESCRIPTOR)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// name
// ---------------------------------------------------------------------------

describe('WavBackend.name', () => {
  it('is "container-wav"', () => {
    expect(new WavBackend().name).toBe('container-wav');
  });
});

// ---------------------------------------------------------------------------
// convert — WAV round-trip via fixture
// ---------------------------------------------------------------------------

describe('WavBackend.convert', () => {
  it('round-trips sine-1s-44100-mono.wav and returns a valid Blob', async () => {
    const backend = new WavBackend();
    const input = await loadFixtureBlob('audio/sine-1s-44100-mono.wav', 'audio/wav');

    const result = await backend.convert(input, WAV_DESCRIPTOR, BASE_OPTIONS);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(44); // at minimum a WAV header
    expect(result.format).toBe(WAV_DESCRIPTOR);
    expect(result.backend).toBe('container-wav');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('output Blob is parseable as a valid WAV', async () => {
    const backend = new WavBackend();
    const input = await loadFixtureBlob('audio/sine-1s-44100-mono.wav', 'audio/wav');
    const result = await backend.convert(input, WAV_DESCRIPTOR, BASE_OPTIONS);

    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    const wav = parseWav(outBytes);
    expect(wav.format.sampleRate).toBe(44100);
    expect(wav.format.channels).toBe(1);
    expect(wav.format.bitsPerSample).toBe(16);
  });

  it('reports progress events in order', async () => {
    const backend = new WavBackend();
    const input = await loadFixtureBlob('audio/sine-1s-44100-mono.wav', 'audio/wav');
    const percents: number[] = [];

    await backend.convert(input, WAV_DESCRIPTOR, {
      ...BASE_OPTIONS,
      onProgress: (ev) => percents.push(ev.percent),
    });

    expect(percents.length).toBeGreaterThanOrEqual(2);
    // First percent should be 10 (demux), last should be 100
    expect(percents[0]).toBe(10);
    expect(percents[percents.length - 1]).toBe(100);
  });

  it('throws when output format is not WAV', async () => {
    const backend = new WavBackend();
    const input = await loadFixtureBlob('audio/sine-1s-44100-mono.wav', 'audio/wav');
    await expect(
      backend.convert(input, MP3_DESCRIPTOR, { format: MP3_DESCRIPTOR }),
    ).rejects.toThrow();
  });

  it('converts stereo 48000 Hz fixture correctly', async () => {
    const backend = new WavBackend();
    const input = await loadFixtureBlob('audio/sine-1s-48000-stereo.wav', 'audio/wav');
    const result = await backend.convert(input, WAV_DESCRIPTOR, BASE_OPTIONS);
    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    const wav = parseWav(outBytes);
    expect(wav.format.sampleRate).toBe(48000);
    expect(wav.format.channels).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// WAV_FORMAT descriptor
// ---------------------------------------------------------------------------

describe('WAV_FORMAT', () => {
  it('has correct ext and mime', () => {
    expect(WAV_FORMAT.ext).toBe('wav');
    expect(WAV_FORMAT.mime).toBe('audio/wav');
    expect(WAV_FORMAT.category).toBe('audio');
  });
});
