/**
 * Tests for FlacBackend.
 */

import { loadFixtureBlob } from '@webcvt/test-utils';
import { describe, expect, it } from 'vitest';
import { FLAC_FORMAT, FlacBackend } from './backend.ts';
import { FlacEncodeNotImplementedError, FlacInputTooLargeError } from './errors.ts';

const FLAC_MIME = 'audio/flac';
const WAV_FORMAT = { ext: 'wav', mime: 'audio/wav', category: 'audio' as const };
const VIDEO_FORMAT = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };

// ---------------------------------------------------------------------------
// canHandle tests
// ---------------------------------------------------------------------------

describe('FlacBackend.canHandle', () => {
  const backend = new FlacBackend();

  it('returns true for FLAC input → FLAC output (identity)', async () => {
    const result = await backend.canHandle(FLAC_FORMAT, FLAC_FORMAT);
    expect(result).toBe(true);
  });

  // Q-1: Phase 1 is identity only. FLAC→WAV decode deferred to Phase 2.
  it('returns false for FLAC input → WAV output (Phase 1 identity only)', async () => {
    const result = await backend.canHandle(FLAC_FORMAT, WAV_FORMAT);
    expect(result).toBe(false);
  });

  it('returns true for audio/x-flac input → FLAC output', async () => {
    const xFlac = { ext: 'flac', mime: 'audio/x-flac', category: 'audio' as const };
    const result = await backend.canHandle(xFlac, FLAC_FORMAT);
    expect(result).toBe(true);
  });

  it('returns false for non-FLAC input', async () => {
    const mp3 = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' as const };
    const result = await backend.canHandle(mp3, FLAC_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for FLAC input → video output', async () => {
    const result = await backend.canHandle(FLAC_FORMAT, VIDEO_FORMAT);
    expect(result).toBe(false);
  });

  it('returns false for WAV input → FLAC output (encode path goes to backend-wasm)', async () => {
    const result = await backend.canHandle(WAV_FORMAT, FLAC_FORMAT);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// name property
// ---------------------------------------------------------------------------

describe('FlacBackend.name', () => {
  it('is container-flac', () => {
    const backend = new FlacBackend();
    expect(backend.name).toBe('container-flac');
  });
});

// ---------------------------------------------------------------------------
// FLAC_FORMAT descriptor
// ---------------------------------------------------------------------------

describe('FLAC_FORMAT', () => {
  it('has correct ext, mime, category', () => {
    expect(FLAC_FORMAT.ext).toBe('flac');
    expect(FLAC_FORMAT.mime).toBe('audio/flac');
    expect(FLAC_FORMAT.category).toBe('audio');
  });
});

// ---------------------------------------------------------------------------
// convert tests (identity path)
// ---------------------------------------------------------------------------

describe('FlacBackend.convert (identity FLAC → FLAC)', () => {
  it('round-trips fixture to a Blob with FLAC mime type', async () => {
    const backend = new FlacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.flac', FLAC_MIME);
    const result = await backend.convert(blob, FLAC_FORMAT, { format: FLAC_FORMAT });

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe(FLAC_MIME);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.backend).toBe('container-flac');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invokes progress callbacks', async () => {
    const backend = new FlacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.flac', FLAC_MIME);
    const phases: string[] = [];

    await backend.convert(blob, FLAC_FORMAT, {
      format: FLAC_FORMAT,
      onProgress: (e) => {
        if (e.phase !== undefined) phases.push(e.phase);
      },
    });

    expect(phases).toContain('demux');
    expect(phases).toContain('done');
  });

  it('throws FlacInputTooLargeError for input > 200 MiB', async () => {
    const backend = new FlacBackend();
    // Create a fake oversized blob
    const bigBlob = new Blob([new Uint8Array(201 * 1024 * 1024)], { type: FLAC_MIME });
    await expect(backend.convert(bigBlob, FLAC_FORMAT, { format: FLAC_FORMAT })).rejects.toThrow(
      FlacInputTooLargeError,
    );
  });
});

// ---------------------------------------------------------------------------
// convert tests (non-FLAC output → Phase 1 not implemented)
// ---------------------------------------------------------------------------

describe('FlacBackend.convert (non-FLAC output)', () => {
  it('throws FlacEncodeNotImplementedError for FLAC → WAV', async () => {
    const backend = new FlacBackend();
    const blob = await loadFixtureBlob('audio/sine-1s-44100-mono.flac', FLAC_MIME);
    await expect(backend.convert(blob, WAV_FORMAT, { format: WAV_FORMAT })).rejects.toThrow(
      FlacEncodeNotImplementedError,
    );
  });
});
