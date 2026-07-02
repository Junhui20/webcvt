import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscodeBackend, registerTranscodeBackend } from './backend.ts';
import { TranscodeInputTooLargeError } from './errors.ts';
import { MAX_INPUT_BYTES } from './matrix.ts';

const MP3: FormatDescriptor = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' };
const WAV: FormatDescriptor = { ext: 'wav', mime: 'audio/wav', category: 'audio' };
const OPUS: FormatDescriptor = { ext: 'opus', mime: 'audio/opus', category: 'audio' };
const MP4: FormatDescriptor = { ext: 'mp4', mime: 'video/mp4', category: 'video' };
const PNG: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };

function stubProbes(opts: { decode?: boolean; encode?: boolean } = {}): {
  decode: ReturnType<typeof vi.fn>;
  encode: ReturnType<typeof vi.fn>;
} {
  const decode = vi.fn().mockResolvedValue({ supported: opts.decode ?? true, config: {} });
  const encode = vi.fn().mockResolvedValue({ supported: opts.encode ?? true, config: {} });
  vi.stubGlobal('AudioDecoder', { isConfigSupported: decode });
  vi.stubGlobal('AudioEncoder', { isConfigSupported: encode });
  return { decode, encode };
}

describe('TranscodeBackend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('has the agreed name and priority', () => {
    const b = new TranscodeBackend();
    expect(b.name).toBe('webcodecs-transcode');
    expect(b.priority).toBe(0);
  });

  describe('canHandle — static matrix gate', () => {
    it('rejects an off-matrix pair (mp3 → mp4) WITHOUT probing', async () => {
      const { decode, encode } = stubProbes();
      const b = new TranscodeBackend();
      expect(await b.canHandle(MP3, MP4)).toBe(false);
      expect(decode).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    });

    it('rejects a non-audio input (png → wav) as an unsupported pair (no throw)', async () => {
      stubProbes();
      const b = new TranscodeBackend();
      expect(await b.canHandle(PNG, WAV)).toBe(false);
    });

    it('rejects → mp3 (no WebCodecs mp3 encoder)', async () => {
      stubProbes();
      const b = new TranscodeBackend();
      expect(await b.canHandle(WAV, MP3)).toBe(false);
    });
  });

  describe('canHandle — concrete codec probe', () => {
    it('accepts a fully supported pair (mp3 → opus)', async () => {
      stubProbes({ decode: true, encode: true });
      const b = new TranscodeBackend();
      expect(await b.canHandle(MP3, OPUS)).toBe(true);
    });

    it('accepts a pcm-only pair (wav → wav) without any probe', async () => {
      const { decode, encode } = stubProbes();
      const b = new TranscodeBackend();
      expect(await b.canHandle(WAV, WAV)).toBe(true);
      expect(decode).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    });

    it('rejects when the decoder isConfigSupported=false (Safari-audio sim)', async () => {
      stubProbes({ decode: false, encode: true });
      const b = new TranscodeBackend();
      expect(await b.canHandle(MP3, WAV)).toBe(false); // wav = pcm sink, only decode probes
    });

    it('rejects when the encoder isConfigSupported=false', async () => {
      stubProbes({ decode: true, encode: false });
      const b = new TranscodeBackend();
      expect(await b.canHandle(WAV, OPUS)).toBe(false); // wav = pcm source, only encode probes
    });

    it('caches the probe result across repeated calls (one isConfigSupported)', async () => {
      const { decode } = stubProbes({ decode: true });
      const b = new TranscodeBackend();
      expect(await b.canHandle(MP3, WAV)).toBe(true);
      expect(await b.canHandle(MP3, WAV)).toBe(true);
      expect(await b.canHandle(MP3, WAV)).toBe(true);
      expect(decode).toHaveBeenCalledTimes(1);
    });

    it('returns false (not throws) when the WebCodecs globals are absent', async () => {
      vi.stubGlobal('AudioDecoder', undefined);
      vi.stubGlobal('AudioEncoder', undefined);
      const b = new TranscodeBackend();
      await expect(b.canHandle(MP3, OPUS)).resolves.toBe(false);
    });
  });

  describe('convert — input cap enforced first', () => {
    it('rejects an oversized input before reading the bytes', async () => {
      const b = new TranscodeBackend();
      const oversized = {
        size: MAX_INPUT_BYTES + 1,
        type: 'audio/mpeg',
        arrayBuffer: () => Promise.reject(new Error('should not be read')),
      } as unknown as Blob;

      await expect(b.convert(oversized, WAV, { format: 'wav' })).rejects.toThrow(
        TranscodeInputTooLargeError,
      );
      await expect(b.convert(oversized, WAV, { format: 'wav' })).rejects.toMatchObject({
        code: 'TRANSCODE_INPUT_TOO_LARGE',
      });
    });
  });

  describe('registerTranscodeBackend', () => {
    it('registers into a provided registry and is unregisterable by name', () => {
      const registry = new BackendRegistry();
      const backend = registerTranscodeBackend(registry);
      expect(backend).toBeInstanceOf(TranscodeBackend);
      expect(registry.list().map((x) => x.name)).toContain('webcodecs-transcode');
      expect(registry.unregister('webcodecs-transcode')).toBe(true);
      expect(registry.list()).toHaveLength(0);
    });
  });
});
