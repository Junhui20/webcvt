/**
 * Tests for the RoundTripBackend base class.
 *
 * These lock down the shared behaviour the nine container packages rely on:
 * canHandle modes, the optional size guard, the exact progress sequence, and
 * the result block. Container-package tests then verify their own wiring.
 */

import { describe, expect, it, vi } from 'vitest';
import { RoundTripBackend, type RoundTripBackendConfig } from './round-trip-backend.ts';
import type { FormatDescriptor, ProgressEvent } from './types.ts';
import { WebcvtError } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const A_MIME = 'audio/a';
const B_MIME = 'audio/b';

function fmt(mime: string, category: FormatDescriptor['category'] = 'audio'): FormatDescriptor {
  return { ext: mime.split('/')[1] ?? mime, mime, category };
}

/** Identity parse/serialize over raw bytes, so output === input round-trips. */
function makeBackend(
  overrides: Partial<RoundTripBackendConfig<Uint8Array>> = {},
): RoundTripBackend<Uint8Array> {
  return new RoundTripBackend<Uint8Array>({
    name: 'test-backend',
    mimes: new Set([A_MIME, B_MIME]),
    parse: (bytes) => bytes,
    serialize: (parsed) => parsed,
    encodeNotImplemented: () => new WebcvtError('TEST_ENCODE', 'encode not implemented'),
    demuxStep: { percent: 5, phase: 'demux' },
    serializeStep: { percent: 50, phase: 'mux' },
    ...overrides,
  });
}

function blob(bytes: number[], mime = A_MIME): Blob {
  return new Blob([new Uint8Array(bytes).buffer], { type: mime });
}

// ---------------------------------------------------------------------------
// name
// ---------------------------------------------------------------------------

describe('RoundTripBackend.name', () => {
  it('reflects the configured name', () => {
    expect(makeBackend().name).toBe('test-backend');
  });
});

// ---------------------------------------------------------------------------
// canHandle modes
// ---------------------------------------------------------------------------

describe('RoundTripBackend.canHandle — identity-set (default)', () => {
  const backend = makeBackend();

  it('accepts input and output both in the MIME set (including cross-relabel)', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt(A_MIME))).toBe(true);
    expect(await backend.canHandle(fmt(A_MIME), fmt(B_MIME))).toBe(true);
  });

  it('rejects input outside the set', async () => {
    expect(await backend.canHandle(fmt('audio/other'), fmt(A_MIME))).toBe(false);
  });

  it('rejects output outside the set', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt('audio/other'))).toBe(false);
  });
});

describe('RoundTripBackend.canHandle — strict-identity', () => {
  const backend = makeBackend({ canHandleMode: 'strict-identity' });

  it('accepts only exact input.mime === output.mime', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt(A_MIME))).toBe(true);
  });

  it('rejects a cross-MIME relabel even when both are in the set', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt(B_MIME))).toBe(false);
  });
});

describe('RoundTripBackend.canHandle — acceptsOutput override', () => {
  const backend = makeBackend({
    acceptsOutput: (_input, output) => output.category === 'audio',
  });

  it('accepts any audio output for a supported input', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt('audio/anything'))).toBe(true);
  });

  it('rejects a non-audio output', async () => {
    expect(await backend.canHandle(fmt(A_MIME), fmt('image/png', 'image'))).toBe(false);
  });

  it('still gates on the input MIME first', async () => {
    expect(await backend.canHandle(fmt('audio/other'), fmt('audio/anything'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// size guard
// ---------------------------------------------------------------------------

describe('RoundTripBackend size guard', () => {
  it('throws the provided error when input exceeds the cap, before reading bytes', async () => {
    const err = new WebcvtError('TOO_BIG', 'too big');
    const backend = makeBackend({
      sizeGuard: { maxBytes: 10, error: () => err },
    });
    const hostile = {
      size: 11,
      arrayBuffer: () => Promise.reject(new Error('must not be read')),
    } as unknown as Blob;

    await expect(backend.convert(hostile, fmt(A_MIME), {})).rejects.toBe(err);
  });

  it('passes the actual size and configured max to the error factory', async () => {
    const factory = vi.fn((_size: number, _max: number) => new WebcvtError('TOO_BIG', 'x'));
    const backend = makeBackend({ sizeGuard: { maxBytes: 10, error: factory } });
    const hostile = { size: 11, arrayBuffer: () => Promise.reject(new Error()) } as unknown as Blob;

    await expect(backend.convert(hostile, fmt(A_MIME), {})).rejects.toThrow();
    expect(factory).toHaveBeenCalledWith(11, 10);
  });

  it('allows input exactly at the cap', async () => {
    const backend = makeBackend({
      sizeGuard: { maxBytes: 4, error: () => new WebcvtError('TOO_BIG', 'x') },
    });
    const result = await backend.convert(blob([1, 2, 3, 4]), fmt(A_MIME), {});
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('never checks size when no guard is configured', async () => {
    const backend = makeBackend(); // no sizeGuard
    const big = {
      size: Number.MAX_SAFE_INTEGER,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
    } as unknown as Blob;
    const result = await backend.convert(big, fmt(A_MIME), {});
    expect(result.blob).toBeInstanceOf(Blob);
  });
});

// ---------------------------------------------------------------------------
// progress sequence
// ---------------------------------------------------------------------------

describe('RoundTripBackend progress sequence', () => {
  it('emits demux → serialize → done in order with configured percents/phases', async () => {
    const backend = makeBackend({
      demuxStep: { percent: 10, phase: 'demux' },
      serializeStep: { percent: 60, phase: 'mux' },
    });
    const events: ProgressEvent[] = [];
    await backend.convert(blob([1, 2, 3]), fmt(A_MIME), {
      onProgress: (e) => events.push(e),
    });

    expect(events).toEqual([
      { percent: 10, phase: 'demux' },
      { percent: 60, phase: 'mux' },
      { percent: 100, phase: 'done' },
    ]);
  });

  it('emits demux progress before an encode-not-implemented output is rejected', async () => {
    const backend = makeBackend();
    const events: ProgressEvent[] = [];
    await expect(
      backend.convert(blob([1, 2, 3]), fmt('audio/other'), {
        onProgress: (e) => events.push(e),
      }),
    ).rejects.toThrow();
    // Base parses first, so the demux + serialize steps fire before the throw.
    expect(events).toEqual([
      { percent: 5, phase: 'demux' },
      { percent: 50, phase: 'mux' },
    ]);
  });

  it('does not require an onProgress callback', async () => {
    const backend = makeBackend();
    await expect(backend.convert(blob([1]), fmt(A_MIME), {})).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// result block + serialize
// ---------------------------------------------------------------------------

describe('RoundTripBackend result block', () => {
  it('returns the canonical result fields', async () => {
    const backend = makeBackend();
    const result = await backend.convert(blob([1, 2, 3, 4, 5]), fmt(B_MIME), {});
    const outputFmt = fmt(B_MIME);
    const result2 = await backend.convert(blob([1, 2, 3]), outputFmt, {});

    expect(result.format).toEqual(fmt(B_MIME));
    expect(result2.format).toBe(outputFmt); // returns the exact descriptor passed in
    expect(result.backend).toBe('test-backend');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('uses the requested output.mime for the Blob when outputMime is unset', async () => {
    const backend = makeBackend();
    const result = await backend.convert(blob([1], A_MIME), fmt(B_MIME), {});
    expect(result.blob.type).toBe(B_MIME);
  });

  it('uses a fixed outputMime for the Blob when configured', async () => {
    const backend = makeBackend({ outputMime: A_MIME });
    const result = await backend.convert(blob([1], A_MIME), fmt(B_MIME), {});
    expect(result.blob.type).toBe(A_MIME);
  });

  it('round-trips the bytes through parse + serialize', async () => {
    const backend = makeBackend();
    const result = await backend.convert(blob([7, 8, 9]), fmt(A_MIME), {});
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('awaits an async serialize (e.g. a lazily-imported serializer)', async () => {
    const backend = makeBackend({
      serialize: async (parsed) => {
        await Promise.resolve();
        return parsed;
      },
    });
    const result = await backend.convert(blob([1, 2]), fmt(A_MIME), {});
    expect(result.blob.size).toBe(2);
  });

  it('throws the configured encode error for a non-identity output', async () => {
    const backend = makeBackend({
      encodeNotImplemented: (output) =>
        new WebcvtError('TEST_ENCODE', `no encode to ${output.mime}`),
    });
    await expect(backend.convert(blob([1]), fmt('audio/other'), {})).rejects.toMatchObject({
      code: 'TEST_ENCODE',
      message: 'no encode to audio/other',
    });
  });
});
