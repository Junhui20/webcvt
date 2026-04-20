import { describe, expect, it, vi } from 'vitest';
import { type MemfsFFmpeg, withMemfsFiles } from './memfs.ts';

function makeFFmpeg(overrides?: Partial<MemfsFFmpeg>): MemfsFFmpeg {
  const store = new Map<string, Uint8Array>();
  const output = new Uint8Array([0x00, 0x01, 0x02]);

  return {
    writeFile: vi.fn(async (name: string, data: Uint8Array) => {
      store.set(name, data);
    }),
    readFile: vi.fn(async (_name: string) => output),
    deleteFile: vi.fn(async (_name: string) => undefined),
    ...overrides,
  };
}

describe('withMemfsFiles — happy path', () => {
  it('calls writeFile, invokes fn, reads output, deletes both paths', async () => {
    const ffmpeg = makeFFmpeg();
    const fn = vi.fn(async () => undefined);

    await withMemfsFiles(ffmpeg, 'mp4', 'webm', new Uint8Array([1, 2, 3]), fn);

    expect(ffmpeg.writeFile).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledOnce();
    expect(ffmpeg.readFile).toHaveBeenCalledOnce();
    // Both input and output paths should be deleted
    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('returns the output bytes from readFile', async () => {
    const expected = new Uint8Array([10, 20, 30]);
    const ffmpeg = makeFFmpeg({
      readFile: vi.fn(async () => expected),
    });

    const result = await withMemfsFiles(
      ffmpeg,
      'mp4',
      'webm',
      new Uint8Array([1]),
      async () => undefined,
    );

    expect(result).toBe(expected);
  });

  it('returns Uint8Array when readFile returns a string', async () => {
    const ffmpeg = makeFFmpeg({
      readFile: vi.fn(async () => 'hello'),
    });

    const result = await withMemfsFiles(
      ffmpeg,
      'srt',
      'vtt',
      new Uint8Array([]),
      async () => undefined,
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });
});

describe('withMemfsFiles — MEMFS cleanup on exec throw (Trap #4)', () => {
  it('calls deleteFile for BOTH paths even when fn throws', async () => {
    const ffmpeg = makeFFmpeg();

    await expect(
      withMemfsFiles(ffmpeg, 'mp4', 'webm', new Uint8Array([1]), async () => {
        throw new Error('exec failure');
      }),
    ).rejects.toThrow('exec failure');

    // deleteFile must be called for both paths despite the error
    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('calls deleteFile for BOTH paths when readFile throws', async () => {
    const ffmpeg = makeFFmpeg({
      readFile: vi.fn(async () => {
        throw new Error('read failure');
      }),
    });

    await expect(
      withMemfsFiles(ffmpeg, 'mp4', 'webm', new Uint8Array([1]), async () => undefined),
    ).rejects.toThrow('read failure');

    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2);
  });
});

describe('withMemfsFiles — path generation', () => {
  it('passes distinct input and output paths to fn', async () => {
    const ffmpeg = makeFFmpeg();
    let capturedCtx: { inputPath: string; outputPath: string } | null = null;

    await withMemfsFiles(ffmpeg, 'mp4', 'webm', new Uint8Array([]), async (ctx) => {
      capturedCtx = ctx;
    });

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.inputPath).not.toBe(capturedCtx!.outputPath);
    expect(capturedCtx!.inputPath).toMatch(/\.mp4$/);
    expect(capturedCtx!.outputPath).toMatch(/\.webm$/);
  });
});
