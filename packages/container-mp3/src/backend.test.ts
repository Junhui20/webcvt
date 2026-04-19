import type { FormatDescriptor } from '@webcvt/core';
import { WebcvtError } from '@webcvt/core';
import { loadFixture } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { MP3_FORMAT, Mp3Backend } from './backend.ts';
import { Mp3EncodeNotImplementedError } from './errors.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MP3_DESCRIPTOR: FormatDescriptor = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' };
const WAV_DESCRIPTOR: FormatDescriptor = { ext: 'wav', mime: 'audio/wav', category: 'audio' };
const IMAGE_DESCRIPTOR: FormatDescriptor = { ext: 'png', mime: 'image/png', category: 'image' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mp3Backend', () => {
  const backend = new Mp3Backend();

  it('has stable name "container-mp3"', () => {
    expect(backend.name).toBe('container-mp3');
  });

  describe('canHandle', () => {
    it('accepts MP3 input to MP3 output', async () => {
      expect(await backend.canHandle(MP3_DESCRIPTOR, MP3_DESCRIPTOR)).toBe(true);
    });

    it('accepts MP3 input to any audio output', async () => {
      expect(await backend.canHandle(MP3_DESCRIPTOR, WAV_DESCRIPTOR)).toBe(true);
    });

    it('accepts alternative MP3 MIME types', async () => {
      const altMp3 = { ...MP3_DESCRIPTOR, mime: 'audio/mp3' };
      expect(await backend.canHandle(altMp3, WAV_DESCRIPTOR)).toBe(true);
    });

    it('rejects non-MP3 input', async () => {
      expect(await backend.canHandle(WAV_DESCRIPTOR, MP3_DESCRIPTOR)).toBe(false);
    });

    it('rejects MP3 input to non-audio output (image)', async () => {
      expect(await backend.canHandle(MP3_DESCRIPTOR, IMAGE_DESCRIPTOR)).toBe(false);
    });
  });

  describe('convert — MP3 identity round-trip', () => {
    it('round-trips the fixture MP3 as MP3 output', async () => {
      const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
      const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/mpeg' });
      const result = await backend.convert(blob, MP3_DESCRIPTOR, {
        format: 'mp3',
      });

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.backend).toBe('container-mp3');
      expect(result.hardwareAccelerated).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('calls onProgress callback during conversion', async () => {
      const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
      const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/mpeg' });
      const phases: string[] = [];

      await backend.convert(blob, MP3_DESCRIPTOR, {
        format: 'mp3',
        onProgress: (e) => {
          if (e.phase) phases.push(e.phase);
        },
      });

      expect(phases).toContain('demux');
      expect(phases).toContain('done');
    });

    it('throws Mp3EncodeNotImplementedError for non-MP3 audio output', async () => {
      const data = await loadFixture('audio/sine-1s-44100-mono.mp3');
      const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/mpeg' });

      await expect(backend.convert(blob, WAV_DESCRIPTOR, { format: 'wav' })).rejects.toThrow(
        Mp3EncodeNotImplementedError,
      );
    });
  });
});

describe('MP3_FORMAT descriptor', () => {
  it('has correct ext, mime, and category', () => {
    expect(MP3_FORMAT.ext).toBe('mp3');
    expect(MP3_FORMAT.mime).toBe('audio/mpeg');
    expect(MP3_FORMAT.category).toBe('audio');
  });
});

// --- Security regression: Fix 3 — OOM protection for oversized input ---

describe('Mp3Backend — input size cap', () => {
  it('throws when input Blob exceeds 200 MiB', async () => {
    const backend = new Mp3Backend();
    // Construct a stub that satisfies the Blob interface for this code path.
    // The guard checks `.size` before calling `.arrayBuffer()`, so we do not
    // need to allocate actual memory.
    const oversizedBlob = {
      size: 201 * 1024 * 1024, // 201 MiB
      type: 'audio/mpeg',
      arrayBuffer: () => Promise.reject(new Error('should not be called')),
      slice: () => {
        throw new Error('should not be called');
      },
      stream: () => {
        throw new Error('should not be called');
      },
      text: () => {
        throw new Error('should not be called');
      },
    } as unknown as Blob;

    await expect(
      backend.convert(oversizedBlob, { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' }, {}),
    ).rejects.toThrow(WebcvtError);

    await expect(
      backend.convert(oversizedBlob, { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' }, {}),
    ).rejects.toMatchObject({ code: 'MP3_INPUT_TOO_LARGE' });
  });
});
