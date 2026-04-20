/**
 * WasmBackend unit tests — all wasm IO is mocked.
 *
 * Covers test plan cases from the design note §Test plan (~21 cases).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @ffmpeg/ffmpeg and loader BEFORE importing backend
// ---------------------------------------------------------------------------

const mockLog: Array<(data: { type: string; message: string }) => void> = [];

const mockExec = vi.fn(async () => 0);
const mockWriteFile = vi.fn(async () => undefined);
const mockReadFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
const mockDeleteFile = vi.fn(async () => undefined);
const mockTerminate = vi.fn(() => undefined);
const mockOn = vi.fn(
  (_event: string, handler: (data: { type: string; message: string }) => void) => {
    mockLog.push(handler);
  },
);
const mockOff = vi.fn(
  (_event: string, handler: (data: { type: string; message: string }) => void) => {
    const idx = mockLog.indexOf(handler);
    if (idx >= 0) mockLog.splice(idx, 1);
  },
);

const mockFFmpegInstance = {
  load: vi.fn(async () => undefined),
  exec: mockExec,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  deleteFile: mockDeleteFile,
  terminate: mockTerminate,
  on: mockOn,
  off: mockOff,
};

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: vi.fn(() => mockFFmpegInstance),
}));

// ---------------------------------------------------------------------------
// Import the backend after the mock is set up
// ---------------------------------------------------------------------------

import { WasmBackend } from './backend.ts';
import { WasmExecutionError, WasmLoadError, WasmUnsupportedError } from './errors.ts';
import { resetLoader } from './loader.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MP4_FD = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };
const WEBM_FD = { ext: 'webm', mime: 'video/webm', category: 'video' as const };
const MP3_FD = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' as const };
const MKV_FD = { ext: 'mkv', mime: 'video/x-matroska', category: 'video' as const };

function makeBlob(mime: string, size = 16): Blob {
  return new Blob([new Uint8Array(size)], { type: mime });
}

function makeOpts(overrides?: Partial<Parameters<WasmBackend['convert']>[2]>) {
  return { format: 'mp4' as const, ...overrides };
}

beforeEach(() => {
  resetLoader();
  vi.clearAllMocks();
  mockLog.length = 0;

  // Reset to happy-path defaults
  mockExec.mockResolvedValue(0);
  mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockFFmpegInstance.load.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Test case 1: canHandle returns true for every allowlisted pair
// ---------------------------------------------------------------------------

describe('canHandle — allowlisted pairs', () => {
  it('returns true for video/mp4 → video/webm', async () => {
    const backend = new WasmBackend();
    expect(await backend.canHandle(MP4_FD, WEBM_FD)).toBe(true);
  });

  it('returns true for video/mp4 → audio/mpeg (extraction)', async () => {
    const backend = new WasmBackend();
    expect(await backend.canHandle(MP4_FD, MP3_FD)).toBe(true);
  });

  it('returns true for video/x-matroska → video/mp4', async () => {
    const backend = new WasmBackend();
    expect(await backend.canHandle(MKV_FD, MP4_FD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test case 2: canHandle returns false for non-allowlisted
// ---------------------------------------------------------------------------

describe('canHandle — non-allowlisted pairs', () => {
  it('returns false for image/png → video/mp4', async () => {
    const backend = new WasmBackend();
    const pngFd = { ext: 'png', mime: 'image/png', category: 'image' as const };
    expect(await backend.canHandle(pngFd, MP4_FD)).toBe(false);
  });

  it('returns false for text/html → audio/mpeg', async () => {
    const backend = new WasmBackend();
    const htmlFd = { ext: 'html', mime: 'text/html', category: 'document' as const };
    expect(await backend.canHandle(htmlFd, MP3_FD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test case 3: canHandle does NOT trigger import() (spy)
// ---------------------------------------------------------------------------

describe('canHandle — no dynamic import', () => {
  it('does not call FFmpeg constructor (no import triggered)', async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ctor = vi.mocked(FFmpeg);
    ctor.mockClear();

    const backend = new WasmBackend();
    await backend.canHandle(MP4_FD, WEBM_FD);

    expect(ctor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test case 4–8: buildCommand integration (via convert)
// ---------------------------------------------------------------------------

describe('convert — command synthesis', () => {
  it('MP4→MP3 default quality: argv contains -vn and libmp3lame', async () => {
    const backend = new WasmBackend();
    const capturedArgv: string[][] = [];
    mockExec.mockImplementation(async (args: string[]) => {
      capturedArgv.push(args);
      return 0;
    });

    await backend.convert(makeBlob('video/mp4'), MP3_FD, makeOpts());

    const argv = capturedArgv[0];
    expect(argv).toBeDefined();
    expect(argv).toContain('-vn');
    expect(argv).toContain('libmp3lame');
  });

  it('video→video: argv does NOT contain -vn', async () => {
    const backend = new WasmBackend();
    const capturedArgv: string[][] = [];
    mockExec.mockImplementation(async (args: string[]) => {
      capturedArgv.push(args);
      return 0;
    });

    await backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts());
    const argv = capturedArgv[0];
    expect(argv).toBeDefined();
    expect(argv).not.toContain('-vn');
  });
});

// ---------------------------------------------------------------------------
// Test case 9–11: Progress events
// ---------------------------------------------------------------------------

describe('convert — progress events', () => {
  it('emits progress events from stderr time= parsing', async () => {
    const backend = new WasmBackend();
    const events: number[] = [];
    mockExec.mockImplementation(async () => {
      // Simulate stderr log entries via the on('log') handler
      for (const handler of [...mockLog]) {
        handler({ type: 'stderr', message: 'Duration: 00:00:10.00, start: 0' });
        handler({ type: 'stderr', message: 'frame=  25 time=00:00:02.50 bitrate=256' });
      }
      return 0;
    });

    await backend.convert(
      makeBlob('video/mp4'),
      WEBM_FD,
      makeOpts({
        onProgress: (e) => events.push(e.percent),
      }),
    );

    // Should have received a 25% event and a 100% event
    expect(events).toContain(25);
    expect(events).toContain(100);
  });

  it('does not crash on stdout-type log lines', async () => {
    const backend = new WasmBackend();
    mockExec.mockImplementation(async () => {
      for (const handler of [...mockLog]) {
        handler({ type: 'stdout', message: 'some stdout message' });
      }
      return 0;
    });

    await expect(
      backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts()),
    ).resolves.toBeDefined();
  });

  it('emits percent=-1 sentinel when no Duration line is found', async () => {
    const backend = new WasmBackend();
    const events: number[] = [];
    mockExec.mockImplementation(async () => {
      for (const handler of [...mockLog]) {
        // No Duration line — only time= line
        handler({ type: 'stderr', message: 'time=00:00:05.00 bitrate=256' });
      }
      return 0;
    });

    await backend.convert(
      makeBlob('video/mp4'),
      WEBM_FD,
      makeOpts({
        onProgress: (e) => events.push(e.percent),
      }),
    );

    expect(events).toContain(-1);
  });
});

// ---------------------------------------------------------------------------
// Test case 15–16: Idle reaper and dispose
// ---------------------------------------------------------------------------

describe('idle reaper', () => {
  it('schedules reaper after convert; terminates instance after timeout', async () => {
    // Use real timers but a very short timeout so we don't slow CI
    const backend = new WasmBackend({ idleTimeoutMs: 50 });

    await backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts());

    // Wait past the idle timeout
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockTerminate).toHaveBeenCalled();

    // Clean up: dispose prevents any further timer callbacks
    await backend.dispose();
  });
});

describe('dispose()', () => {
  it('is idempotent — calling twice does not throw', async () => {
    const backend = new WasmBackend();
    await expect(backend.dispose()).resolves.toBeUndefined();
    await expect(backend.dispose()).resolves.toBeUndefined();
  });

  it('returns false from canHandle after dispose', async () => {
    const backend = new WasmBackend();
    await backend.dispose();
    expect(await backend.canHandle(MP4_FD, WEBM_FD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test case 17: MEMFS cleanup even on exec throw (Trap #4)
// ---------------------------------------------------------------------------

describe('MEMFS cleanup on exec failure (Trap #4)', () => {
  it('calls deleteFile for both paths even when exec returns non-zero', async () => {
    const backend = new WasmBackend();
    mockExec.mockResolvedValue(1); // non-zero exit

    await expect(
      backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts()),
    ).rejects.toBeInstanceOf(WasmExecutionError);

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Test case 20: Error taxonomy
// ---------------------------------------------------------------------------

describe('error taxonomy', () => {
  it('non-zero exit code → WasmExecutionError', async () => {
    const backend = new WasmBackend();
    mockExec.mockResolvedValue(42);

    const err = await backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts()).catch((e) => e);
    expect(err).toBeInstanceOf(WasmExecutionError);
    expect((err as WasmExecutionError).exitCode).toBe(42);
  });

  it('allowlist miss → WasmUnsupportedError', async () => {
    const backend = new WasmBackend();
    const unknownFd = { ext: 'xyz', mime: 'application/xyz', category: 'data' as const };
    const inputBlob = makeBlob('application/xyz');

    const err = await backend.convert(inputBlob, unknownFd, makeOpts()).catch((e) => e);
    expect(err).toBeInstanceOf(WasmUnsupportedError);
  });

  it('ffmpeg.load() rejection → WasmLoadError', async () => {
    const backend = new WasmBackend();
    mockFFmpegInstance.load.mockRejectedValueOnce(new Error('COOP missing'));

    const err = await backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts()).catch((e) => e);
    expect(err).toBeInstanceOf(WasmLoadError);
  });
});

// ---------------------------------------------------------------------------
// Test case: result shape
// ---------------------------------------------------------------------------

describe('convert — result shape', () => {
  it('returns ConvertResult with blob, format, backend, durationMs', async () => {
    const backend = new WasmBackend();
    const result = await backend.convert(makeBlob('video/mp4'), WEBM_FD, makeOpts());

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('video/webm');
    expect(result.format).toBe(WEBM_FD);
    expect(result.backend).toBe('ffmpeg-wasm');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.hardwareAccelerated).toBe(false);
  });
});
