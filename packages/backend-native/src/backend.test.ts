/**
 * NativeBackend unit tests.
 *
 * node:child_process is mocked so NO real binary is ever executed. The fake
 * process writes the expected output file (when configured) and emits a chosen
 * exit code / error / hang, letting us exercise success, non-zero exit, spawn
 * error, timeout, and "exited 0 but no output" without touching ffmpeg/pandoc.
 *
 * node:fs is REAL: input/output temp files are written into os.tmpdir() and we
 * assert they are cleaned up afterward.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { BackendRegistry } from '@catlabtech/webcvt-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above imports — `spawn` resolves to this mock everywhere.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { NativeBackend } from './backend.ts';
import {
  NativeConversionFailedError,
  NativeInputTooLargeError,
  NativeTimeoutError,
  NativeToolNotFoundError,
  NativeUnsupportedPairError,
} from './errors.ts';
import { registerNativeBackend } from './index.ts';
import type { ToolName } from './tools.ts';

const mockSpawn = vi.mocked(spawn);

// ---------------------------------------------------------------------------
// Fake child process
// ---------------------------------------------------------------------------

interface FakeChild extends EventEmitter {
  stderr: EventEmitter;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

const spawnedChildren: FakeChild[] = [];

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    // Emulate the OS delivering the signal: the process then closes.
    queueMicrotask(() => child.emit('close', null, signal ?? 'SIGTERM'));
    return true;
  });
  return child;
}

interface FakeCfg {
  code?: number | null;
  stderr?: string;
  stderrChunks?: Array<string | Buffer>;
  hang?: boolean;
  emitError?: Error;
  throwSync?: Error;
  onSpawn?: (args: string[]) => void;
}

function fakeSpawn(cfg: FakeCfg) {
  return ((_bin: string, args: string[]) => {
    if (cfg.throwSync) throw cfg.throwSync;
    const child = makeChild();
    spawnedChildren.push(child);
    if (cfg.hang) return child; // never closes on its own; awaits kill()
    setTimeout(() => {
      if (cfg.stderr) child.stderr.emit('data', Buffer.from(cfg.stderr));
      for (const chunk of cfg.stderrChunks ?? []) child.stderr.emit('data', chunk);
      if (cfg.emitError) {
        child.emit('error', cfg.emitError);
        return;
      }
      cfg.onSpawn?.(args);
      const code = 'code' in cfg ? cfg.code : 0;
      child.emit('close', code ?? null, null);
    }, 1);
    return child;
    // biome-ignore lint/suspicious/noExplicitAny: test double for ChildProcess
  }) as unknown as (...a: any[]) => any;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AVI_BLOB_TYPE = 'video/x-msvideo';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MP4_FD = { ext: 'mp4', mime: 'video/mp4', category: 'video' as const };
const AVI_FD = { ext: 'avi', mime: AVI_BLOB_TYPE, category: 'video' as const };
const MP3_FD = { ext: 'mp3', mime: 'audio/mpeg', category: 'audio' as const };
const PDF_FD = { ext: 'pdf', mime: 'application/pdf', category: 'document' as const };

function aviBlob(size = 8): Blob {
  return new Blob([new Uint8Array(size)], { type: AVI_BLOB_TYPE });
}

function presentFindTool(tool: ToolName): string {
  return `/opt/bin/${tool}`;
}

function firstCall(): { bin: string; args: string[]; opts: Record<string, unknown> } {
  const call = mockSpawn.mock.calls[0];
  expect(call).toBeDefined();
  return {
    bin: call![0] as unknown as string,
    args: call![1] as unknown as string[],
    opts: (call![2] ?? {}) as Record<string, unknown>,
  };
}

beforeEach(() => {
  mockSpawn.mockReset();
  spawnedChildren.length = 0;
});

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('canHandle', () => {
  it('true when the pair is routable AND the tool is present', async () => {
    const backend = new NativeBackend({ findTool: presentFindTool });
    expect(await backend.canHandle(AVI_FD, MP4_FD)).toBe(true);
  });

  it('false when the pair is routable but the tool is missing', async () => {
    const backend = new NativeBackend({ findTool: () => null });
    expect(await backend.canHandle(AVI_FD, MP4_FD)).toBe(false);
  });

  it('false when the pair is not in the table (regardless of tools)', async () => {
    const backend = new NativeBackend({ findTool: presentFindTool });
    expect(await backend.canHandle(AVI_FD, MP3_FD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// convert — success
// ---------------------------------------------------------------------------

describe('convert — success', () => {
  it('spawns the resolved binary with the exact argv array, no shell, and returns the produced blob', async () => {
    const expected = new Uint8Array([9, 8, 7, 6]);
    mockSpawn.mockImplementation(
      fakeSpawn({
        code: 0,
        onSpawn: (args) => writeFileSync(args[args.length - 1] as string, expected),
      }),
    );

    const onProgress = vi.fn();
    const backend = new NativeBackend({ findTool: presentFindTool });
    const result = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD, onProgress });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const { bin, args, opts } = firstCall();

    // Correct binary (from injected findTool).
    expect(bin).toBe('/opt/bin/ffmpeg');
    // Correct argv ARRAY built solely by the routing table.
    expect(Array.isArray(args)).toBe(true);
    expect(args[0]).toBe('-y');
    expect(args[1]).toBe('-i');
    expect(args[2]).toMatch(/-in\.avi$/);
    expect(args[3]).toMatch(/-out\.mp4$/);
    // SECURITY: no shell.
    expect(opts).not.toHaveProperty('shell');
    expect(opts.shell).toBeUndefined();
    expect(opts.stdio).toEqual(['ignore', 'ignore', 'pipe']);

    // Result shape + payload.
    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(outBytes)).toEqual([9, 8, 7, 6]);
    expect(result.blob.type).toBe('video/mp4');
    expect(result.format).toBe(MP4_FD);
    expect(result.backend).toBe('native');
    expect(result.hardwareAccelerated).toBe(false);
    expect(typeof result.durationMs).toBe('number');
    expect(onProgress).toHaveBeenCalledWith({ percent: 100, phase: 'done' });

    // Temp files cleaned up on success.
    expect(existsSync(args[2] as string)).toBe(false);
    expect(existsSync(args[3] as string)).toBe(false);
  });

  it('handles LibreOffice outdir output (produced file != named outPath) and cleans it up', async () => {
    const expected = new Uint8Array([1, 2, 3]);
    mockSpawn.mockImplementation(
      fakeSpawn({
        code: 0,
        onSpawn: (args) => {
          const outdir = args[args.indexOf('--outdir') + 1] as string;
          const input = args[args.length - 1] as string;
          const produced = join(outdir, `${basename(input, extname(input))}.pdf`);
          writeFileSync(produced, expected);
        },
      }),
    );

    const backend = new NativeBackend({ findTool: presentFindTool });
    const docx = new Blob([new Uint8Array(8)], { type: DOCX_TYPE });
    const result = await backend.convert(docx, PDF_FD, { format: PDF_FD });

    const { bin, args } = firstCall();
    expect(bin).toBe('/opt/bin/libreoffice');
    expect(args).toEqual([
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      expect.any(String),
      expect.stringMatching(/-in\.docx$/),
    ]);

    const outBytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(outBytes)).toEqual([1, 2, 3]);

    const outdir = args[args.indexOf('--outdir') + 1] as string;
    const input = args[args.length - 1] as string;
    const produced = join(outdir, `${basename(input, extname(input))}.pdf`);
    expect(existsSync(produced)).toBe(false);
    expect(existsSync(input)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// convert — failure modes
// ---------------------------------------------------------------------------

describe('convert — failures', () => {
  it('non-zero exit → NativeConversionFailedError with exit code + stderr tail, temp cleaned', async () => {
    mockSpawn.mockImplementation(fakeSpawn({ code: 3, stderr: 'ffmpeg: something boom\n' }));
    const backend = new NativeBackend({ findTool: presentFindTool });

    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    expect(err.exitCode).toBe(3);
    expect(err.stderr).toContain('boom');

    const { args } = firstCall();
    expect(existsSync(args[2] as string)).toBe(false); // input temp removed
  });

  it('exited 0 but produced no output → NativeConversionFailedError', async () => {
    mockSpawn.mockImplementation(fakeSpawn({ code: 0 })); // no onSpawn → no file
    const backend = new NativeBackend({ findTool: presentFindTool });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    const { args } = firstCall();
    expect(existsSync(args[2] as string)).toBe(false);
  });

  it("spawn 'error' event → NativeConversionFailedError (-1)", async () => {
    mockSpawn.mockImplementation(fakeSpawn({ emitError: new Error('ENOENT no such tool') }));
    const backend = new NativeBackend({ findTool: presentFindTool });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    expect(err.exitCode).toBe(-1);
    expect(err.stderr).toContain('ENOENT');
  });

  it('synchronous spawn throw → NativeConversionFailedError', async () => {
    mockSpawn.mockImplementation(fakeSpawn({ throwSync: new Error('boom-sync') }));
    const backend = new NativeBackend({ findTool: presentFindTool });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    expect(err.stderr).toContain('boom-sync');
  });

  it('timeout → NativeTimeoutError and the child is SIGKILLed', async () => {
    mockSpawn.mockImplementation(fakeSpawn({ hang: true }));
    const backend = new NativeBackend({ findTool: presentFindTool, timeoutMs: 20 });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeTimeoutError);
    expect(err.timeoutMs).toBe(20);
    expect(spawnedChildren[0]?.kill).toHaveBeenCalledWith('SIGKILL');
    const { args } = firstCall();
    expect(existsSync(args[2] as string)).toBe(false); // cleaned up after timeout
  });

  it('missing tool → NativeToolNotFoundError, spawn never called', async () => {
    const backend = new NativeBackend({ findTool: () => null });
    await expect(backend.convert(aviBlob(), MP4_FD, { format: MP4_FD })).rejects.toBeInstanceOf(
      NativeToolNotFoundError,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('unsupported pair → NativeUnsupportedPairError, spawn never called', async () => {
    const backend = new NativeBackend({ findTool: presentFindTool });
    const blob = new Blob([new Uint8Array(4)], { type: 'text/markdown' });
    await expect(backend.convert(blob, MP3_FD, { format: MP3_FD })).rejects.toBeInstanceOf(
      NativeUnsupportedPairError,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('input larger than the cap → NativeInputTooLargeError, spawn never called', async () => {
    const backend = new NativeBackend({ findTool: presentFindTool, maxInputBytes: 4 });
    await expect(backend.convert(aviBlob(16), MP4_FD, { format: MP4_FD })).rejects.toBeInstanceOf(
      NativeInputTooLargeError,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('null exit code (killed by signal, not timeout) → NativeConversionFailedError(-1)', async () => {
    mockSpawn.mockImplementation(fakeSpawn({ code: null }));
    const backend = new NativeBackend({ findTool: presentFindTool });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    expect(err.exitCode).toBe(-1);
  });

  it('caps captured stderr at maxStderrBytes across string + buffer chunks', async () => {
    mockSpawn.mockImplementation(
      fakeSpawn({ code: 1, stderrChunks: ['abcdefghij', Buffer.from('klmnop')] }),
    );
    const backend = new NativeBackend({ findTool: presentFindTool, maxStderrBytes: 4 });
    const err = await backend.convert(aviBlob(), MP4_FD, { format: MP4_FD }).catch((e) => e);
    expect(err).toBeInstanceOf(NativeConversionFailedError);
    expect(err.stderr.length).toBeLessThanOrEqual(4);
  });

  it('empty blob MIME with an unsupported pair still rejects with NativeUnsupportedPairError', async () => {
    const backend = new NativeBackend({ findTool: presentFindTool });
    const blob = new Blob([new Uint8Array(2)], { type: '' });
    await expect(backend.convert(blob, MP3_FD, { format: MP3_FD })).rejects.toBeInstanceOf(
      NativeUnsupportedPairError,
    );
  });
});

// ---------------------------------------------------------------------------
// registerNativeBackend
// ---------------------------------------------------------------------------

describe('registerNativeBackend', () => {
  it('constructs and registers a NativeBackend into the given registry', () => {
    const registry = new BackendRegistry();
    const backend = registerNativeBackend(registry, { findTool: presentFindTool });
    expect(backend).toBeInstanceOf(NativeBackend);
    expect(registry.list().some((b) => b.name === 'native')).toBe(true);
  });

  it('NativeBackend defaults to the real findTool when no override is supplied', () => {
    const backend = new NativeBackend();
    expect(backend.name).toBe('native');
  });
});
