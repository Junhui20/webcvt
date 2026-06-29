/**
 * NativeBackend — the server-side escape hatch for webcvt.
 *
 * Converts files by spawning native CLI tools (ffmpeg / pandoc / libreoffice /
 * ghostscript) when they are installed. NOT browser-safe: imports
 * node:child_process, node:fs, node:os, node:crypto.
 *
 * Security invariants:
 * - spawn() is ALWAYS called as spawn(binPath, argvArray, { stdio }).
 *   `shell` is NEVER passed and no command string is ever constructed — there
 *   is no shell to inject into.
 * - The argv array comes solely from the routing table's buildArgs(); the only
 *   "paths" in it are temp paths we created ourselves in os.tmpdir().
 * - The input/output extensions used in temp filenames are sanitised so a
 *   hostile FormatDescriptor cannot escape the temp directory.
 * - Both temp files are deleted in a `finally` on every path (success, failure,
 *   timeout, missing output).
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Backend,
  ConvertOptions,
  ConvertResult,
  FormatDescriptor,
} from '@catlabtech/webcvt-core';
import { DEFAULT_TIMEOUT_MS, MAX_INPUT_BYTES, MAX_STDERR_BYTES, TEMP_PREFIX } from './constants.ts';
import {
  NativeConversionFailedError,
  NativeInputTooLargeError,
  NativeTimeoutError,
  NativeToolNotFoundError,
  NativeUnsupportedPairError,
} from './errors.ts';
import { type ToolName, findRoute, inputExtForMime } from './tools.ts';
import { findTool as defaultFindTool } from './which.ts';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface NativeBackendOptions {
  /** Override the input size cap (bytes). Default MAX_INPUT_BYTES. */
  readonly maxInputBytes?: number;
  /** Override the per-invocation timeout (ms). Default DEFAULT_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Override the max stderr capture (bytes). Default MAX_STDERR_BYTES. */
  readonly maxStderrBytes?: number;
  /**
   * Override tool resolution. Primarily for testing — defaults to the real
   * PATH/env based resolver in which.ts.
   */
  readonly findTool?: (tool: ToolName) => string | null;
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/** Strip everything but [a-z0-9] from an extension so it is filename-safe. */
function sanitizeExt(ext: string): string {
  const cleaned = ext
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16);
  return cleaned.length > 0 ? cleaned : 'bin';
}

// ---------------------------------------------------------------------------
// Spawn runner — the single point where a child process is created
// ---------------------------------------------------------------------------

interface SpawnParams {
  readonly tool: ToolName;
  readonly binPath: string;
  readonly argv: string[];
  readonly timeoutMs: number;
  readonly maxStderrBytes: number;
}

/**
 * Spawn the tool, enforce a timeout, capture (capped) stderr, and resolve on a
 * zero exit code. Rejects with a typed error on non-zero exit, spawn failure,
 * or timeout.
 */
function runTool(params: SpawnParams): Promise<void> {
  const { tool, binPath, argv, timeoutMs, maxStderrBytes } = params;

  return new Promise<void>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      // SECURITY: argv array, never a shell. No `shell` key is passed.
      child = spawn(binPath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      rejectPromise(
        new NativeConversionFailedError(
          tool,
          -1,
          `failed to spawn ${tool}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    let settled = false;
    let timedOut = false;
    let stderr = '';

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (stderr.length >= maxStderrBytes) return;
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (stderr.length > maxStderrBytes) stderr = stderr.slice(0, maxStderrBytes);
    });

    child.on('error', (err: Error) => {
      finish(() =>
        rejectPromise(
          new NativeConversionFailedError(tool, -1, `spawn error for ${tool}: ${err.message}`),
        ),
      );
    });

    child.on('close', (code: number | null) => {
      finish(() => {
        if (timedOut) {
          rejectPromise(new NativeTimeoutError(tool, timeoutMs));
          return;
        }
        if (code === 0) {
          resolvePromise();
          return;
        }
        rejectPromise(new NativeConversionFailedError(tool, code ?? -1, stderr));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// NativeBackend
// ---------------------------------------------------------------------------

export class NativeBackend implements Backend {
  readonly name = 'native';

  private readonly maxInputBytes: number;
  private readonly timeoutMs: number;
  private readonly maxStderrBytes: number;
  private readonly findTool: (tool: ToolName) => string | null;

  constructor(options?: NativeBackendOptions) {
    this.maxInputBytes = options?.maxInputBytes ?? MAX_INPUT_BYTES;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxStderrBytes = options?.maxStderrBytes ?? MAX_STDERR_BYTES;
    this.findTool = options?.findTool ?? defaultFindTool;
  }

  // -------------------------------------------------------------------------
  // Backend.canHandle — true only when the pair is routable AND the tool exists
  // -------------------------------------------------------------------------

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    const route = findRoute(input, output);
    if (route === undefined) return false;
    return this.findTool(route.tool) !== null;
  }

  // -------------------------------------------------------------------------
  // Backend.convert
  // -------------------------------------------------------------------------

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    // 1. Enforce the input cap first.
    if (input.size > this.maxInputBytes) {
      throw new NativeInputTooLargeError(input.size, this.maxInputBytes);
    }

    // 2. Recover the input extension from the Blob's MIME, then resolve the
    //    route (control-flow signal when absent).
    const inputExt = inputExtForMime(input.type);
    const route = findRoute({ ext: inputExt }, output);
    if (route === undefined) {
      throw new NativeUnsupportedPairError(inputExt || input.type || '(unknown)', output.ext);
    }

    // 3. Resolve the tool.
    const binPath = this.findTool(route.tool);
    if (binPath === null) {
      throw new NativeToolNotFoundError(route.tool);
    }

    // 4. Allocate temp paths under os.tmpdir() with a random, collision-free id.
    const id = randomUUID();
    const dir = tmpdir();
    const inPath = join(dir, `${TEMP_PREFIX}${id}-in.${sanitizeExt(inputExt)}`);
    const outPath = join(dir, `${TEMP_PREFIX}${id}-out.${sanitizeExt(output.ext)}`);
    const producedPath = route.resolveProducedPath?.(inPath, outPath) ?? outPath;

    // Every path we may need to clean up.
    const cleanupPaths = new Set([inPath, outPath, producedPath]);
    const startMs = Date.now();

    try {
      // Write the input Blob to its temp file.
      const inputBytes = new Uint8Array(await input.arrayBuffer());
      await writeFile(inPath, inputBytes);

      // Build argv strictly from the routing table — no user flags reach argv.
      const argv = route.buildArgs(inPath, outPath, options);

      await runTool({
        tool: route.tool,
        binPath,
        argv,
        timeoutMs: this.timeoutMs,
        maxStderrBytes: this.maxStderrBytes,
      });

      // Read the produced file.
      let outputBytes: Uint8Array;
      try {
        outputBytes = new Uint8Array(await readFile(producedPath));
      } catch (err) {
        throw new NativeConversionFailedError(
          route.tool,
          0,
          `${route.tool} exited 0 but produced no output at ${producedPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      options.onProgress?.({ percent: 100, phase: 'done' });

      return {
        blob: new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime }),
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    } finally {
      // Delete BOTH temp files (and any produced file) on every exit path.
      await Promise.all(
        [...cleanupPaths].map((path) => rm(path, { force: true }).catch(() => undefined)),
      );
    }
  }
}
