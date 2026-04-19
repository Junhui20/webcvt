/**
 * Tests for AacBackend.
 */

import { loadFixtureBlob } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { AAC_FORMAT, AacBackend } from './backend.ts';
import { AdtsEncodeNotImplementedError, AdtsInputTooLargeError } from './errors.ts';

const AAC_MIME = 'audio/aac';
const WAV_FORMAT = { ext: 'wav', mime: 'audio/wav', category: 'audio' as const };
const VIDEO_FORMAT = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };
const MP3_FORMAT = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' as const };

// ---------------------------------------------------------------------------
// canHandle tests
// ---------------------------------------------------------------------------

describe('AacBackend.canHandle', () => {
  const backend = new AacBackend();

  it('returns true for AAC input → AAC output (identity)', async () => {
    const result = await backend.canHandle(AAC_FORMAT, AAC_FORMAT);
    expect(result).toBe(true);
  });

  it('returns false for AAC input → WAV output (Phase 1 identity only)', async () => {
    const result = await backend.canHandle(AAC_FORMAT, WAV_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for AAC input → video output', async () => {
    const result = await backend.canHandle(AAC_FORMAT, VIDEO_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for non-AAC input', async () => {
    const result = await backend.canHandle(MP3_FORMAT, AAC_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for WAV input → AAC output (encode path goes to backend-wasm)', async () => {
    const result = await backend.canHandle(WAV_FORMAT, AAC_FORMAT);
    expect(result).toBe(false);
  });

  // Q-1: HE-AAC MIMEs must NOT be handled here — they route to @webcvt/backend-wasm (Trap #7).
  it('returns false for audio/aacp input → AAC output (HE-AAC routes to backend-wasm)', async () => {
    const aacpFormat = { ext: 'aac', mime: 'audio/aacp', category: 'audio' as const };
    const result = await backend.canHandle(aacpFormat, AAC_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for audio/x-aac input → AAC output (HE-AAC routes to backend-wasm)', async () => {
    const xAacFormat = { ext: 'aac', mime: 'audio/x-aac', category: 'audio' as const };
    const result = await backend.canHandle(xAacFormat, AAC_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for AAC input → audio/aacp output (HE-AAC routes to backend-wasm)', async () => {
    const aacpFormat = { ext: 'aac', mime: 'audio/aacp', category: 'audio' as const };
    const result = await backend.canHandle(AAC_FORMAT, aacpFormat);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// name property
// ---------------------------------------------------------------------------

describe('AacBackend.name', () => {
  it('is container-aac', () => {
    const backend = new AacBackend();
    expect(backend.name).toBe('container-aac');
  });
});

// ---------------------------------------------------------------------------
// AAC_FORMAT descriptor
// ---------------------------------------------------------------------------

describe('AAC_FORMAT', () => {
  it('has correct ext, mime, category', () => {
    expect(AAC_FORMAT.ext).toBe('aac');
    expect(AAC_FORMAT.mime).toBe('audio/aac');
    expect(AAC_FORMAT.category).toBe('audio');
  });

  it('has a description', () => {
    expect(AAC_FORMAT.description).toBeDefined();
    expect(AAC_FORMAT.description).toContain('Audio');
  });
});

// ---------------------------------------------------------------------------
// convert tests (identity path)
// ---------------------------------------------------------------------------

describe('AacBackend.convert (identity AAC → AAC)', () => {
  it('round-trips fixture to a Blob with AAC mime type', async () => {
    const backend = new AacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.aac', AAC_MIME);
    const result = await backend.convert(blob, AAC_FORMAT, { format: AAC_FORMAT });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe(AAC_MIME);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.backend).toBe('container-aac');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invokes progress callbacks', async () => {
    const backend = new AacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.aac', AAC_MIME);
    const phases: string[] = [];

    await backend.convert(blob, AAC_FORMAT, {
      format: AAC_FORMAT,
      onProgress: (e) => {
        if (e.phase !== undefined) phases.push(e.phase);
      },
    });

    expect(phases).toContain('demux');
    expect(phases).toContain('done');
  });

  it('throws AdtsInputTooLargeError for input > 200 MiB', async () => {
    const backend = new AacBackend();
    const bigBlob = new Blob([new Uint8Array(201 * 1024 * 1024)], { type: AAC_MIME });
    await expect(backend.convert(bigBlob, AAC_FORMAT, { format: AAC_FORMAT })).rejects.toThrow(
      AdtsInputTooLargeError,
    );
  });

  it('result format matches the requested output format', async () => {
    const backend = new AacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.aac', AAC_MIME);
    const result = await backend.convert(blob, AAC_FORMAT, { format: AAC_FORMAT });
    expect(result.format).toBe(AAC_FORMAT);
  });
});

// ---------------------------------------------------------------------------
// convert tests (non-AAC output → Phase 1 not implemented)
// ---------------------------------------------------------------------------

describe('AacBackend.convert (non-AAC output)', () => {
  it('throws AdtsEncodeNotImplementedError for AAC → WAV', async () => {
    const backend = new AacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.aac', AAC_MIME);
    await expect(backend.convert(blob, WAV_FORMAT, { format: WAV_FORMAT })).rejects.toThrow(
      AdtsEncodeNotImplementedError,
    );
  });
});
