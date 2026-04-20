/**
 * Tests for loader.ts — mock @ffmpeg/ffmpeg via vi.mock to avoid real WASM IO.
 *
 * The loader.ts module uses dynamic import('@ffmpeg/ffmpeg') which cannot be
 * intercepted by a standard spy. We use vi.mock with factory and vi.doMock
 * to replace it at the module graph level.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasmLoadError } from './errors.ts';

// ---------------------------------------------------------------------------
// Mock @ffmpeg/ffmpeg
// ---------------------------------------------------------------------------

const mockLoad = vi.fn(async () => undefined);
const mockTerminate = vi.fn(() => undefined);
const MockFFmpegConstructor = vi.fn(() => ({
  load: mockLoad,
  exec: vi.fn(async () => 0),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => new Uint8Array()),
  deleteFile: vi.fn(async () => undefined),
  terminate: mockTerminate,
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: MockFFmpegConstructor,
}));

// ---------------------------------------------------------------------------
// Import loader AFTER setting up the mock
// ---------------------------------------------------------------------------

import { ensureLoaded, getCachedInstance, resetLoader, setCachedInstance } from './loader.ts';

beforeEach(() => {
  resetLoader();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureLoaded — basic load', () => {
  it('calls FFmpeg constructor and load()', async () => {
    await ensureLoaded();
    expect(MockFFmpegConstructor).toHaveBeenCalledOnce();
    expect(mockLoad).toHaveBeenCalledOnce();
  });

  it('returns a non-null instance', async () => {
    const inst = await ensureLoaded();
    expect(inst).not.toBeNull();
  });

  it('caches the instance — second call does NOT construct again', async () => {
    await ensureLoaded();
    await ensureLoaded();
    expect(MockFFmpegConstructor).toHaveBeenCalledOnce();
  });
});

describe('ensureLoaded — lazy-load race (Trap #1): N concurrent calls collapse to 1 import', () => {
  it('10 concurrent calls result in exactly 1 FFmpeg constructor invocation', async () => {
    const calls = Array.from({ length: 10 }, () => ensureLoaded());
    await Promise.all(calls);
    expect(MockFFmpegConstructor).toHaveBeenCalledOnce();
  });
});

describe('ensureLoaded — error recovery', () => {
  it('throws WasmLoadError when ffmpeg.load() rejects', async () => {
    mockLoad.mockRejectedValueOnce(new Error('network error'));

    await expect(ensureLoaded()).rejects.toBeInstanceOf(WasmLoadError);
  });

  it('allows retry after failed load', async () => {
    mockLoad.mockRejectedValueOnce(new Error('first fail'));
    await expect(ensureLoaded()).rejects.toBeInstanceOf(WasmLoadError);

    // Reset the rejection — next call should succeed
    await expect(ensureLoaded()).resolves.toBeDefined();
    expect(MockFFmpegConstructor).toHaveBeenCalledTimes(2);
  });
});

describe('resetLoader', () => {
  it('clears cached instance so next call re-loads', async () => {
    await ensureLoaded();
    resetLoader();
    expect(getCachedInstance()).toBeNull();

    await ensureLoaded();
    expect(MockFFmpegConstructor).toHaveBeenCalledTimes(2);
  });
});

describe('setCachedInstance', () => {
  it('setting null also resets loading promise', async () => {
    await ensureLoaded();
    setCachedInstance(null);
    expect(getCachedInstance()).toBeNull();

    // Next ensureLoaded should start fresh
    await ensureLoaded();
    expect(MockFFmpegConstructor).toHaveBeenCalledTimes(2);
  });
});
