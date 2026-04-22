/**
 * WasmBackend — the top-level Backend implementation for @catlabtech/webcvt-backend-wasm.
 *
 * Assembles: allowlist check, loader, serial queue, MEMFS marshalling,
 * command synthesis, progress parsing, idle reaper.
 *
 * Key invariants:
 * - canHandle() NEVER triggers import() (Trap #2).
 * - convert() is queued through SerialQueue (ffmpeg.wasm is not re-entrant).
 * - Idle reaper terminates the worker after IDLE_TIMEOUT_MS.
 * - dispose() is idempotent.
 * - Abort mid-exec nulls both instance and loading (Trap #12).
 */

import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { isAllowlisted } from './allowlist.ts';
import { buildCommand } from './command.ts';
import { IDLE_TIMEOUT_MS, MAX_INPUT_BYTES } from './constants.ts';
import { WasmExecutionError, WasmLoadError, WasmUnsupportedError } from './errors.ts';
import type { FFmpegInstance, WasmLoadOptions } from './loader.ts';
import { ensureLoaded, resetLoader, setCachedInstance } from './loader.ts';
import { withMemfsFiles } from './memfs.ts';
import { ProgressParser } from './progress.ts';
import { SerialQueue } from './queue.ts';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WasmBackendOptions {
  readonly load?: WasmLoadOptions;
  readonly idleTimeoutMs?: number;
  readonly maxInputBytes?: number;
}

// ---------------------------------------------------------------------------
// WasmBackend
// ---------------------------------------------------------------------------

export class WasmBackend implements Backend {
  readonly name = 'ffmpeg-wasm';

  private readonly queue = new SerialQueue();
  private readonly progressParser = new ProgressParser();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Local reference to the live instance — kept in sync with the module-level cache. */
  private liveInstance: FFmpegInstance | null = null;

  private readonly loadOptions: WasmLoadOptions | undefined;
  private readonly idleTimeoutMs: number;
  private readonly maxInputBytes: number;

  constructor(options?: WasmBackendOptions) {
    this.loadOptions = options?.load;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.maxInputBytes = options?.maxInputBytes ?? MAX_INPUT_BYTES;
  }

  // ---------------------------------------------------------------------------
  // Backend.canHandle — pure allowlist lookup, NEVER loads WASM (Trap #2)
  // ---------------------------------------------------------------------------

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    if (this.disposed) return false;
    return isAllowlisted(input.mime, output.mime);
  }

  // ---------------------------------------------------------------------------
  // Backend.convert
  // ---------------------------------------------------------------------------

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    if (this.disposed) {
      throw new WasmLoadError('WasmBackend has been disposed');
    }

    // Validate allowlist — throw before queuing to avoid wasted queue slots
    if (!isAllowlisted(input.type, output.mime)) {
      throw new WasmUnsupportedError(input.type, output.mime);
    }

    // Validate input size (Trap #11)
    if (input.size > this.maxInputBytes) {
      throw new WasmLoadError(
        `Input too large: ${input.size} bytes exceeds MAX_INPUT_BYTES (${this.maxInputBytes} bytes)`,
      );
    }

    const startMs = Date.now();

    return this.queue.enqueue(async (signal) => {
      // Cancel idle reaper — we are active again
      this.cancelIdleTimer();

      // Ensure WASM is loaded
      let ffmpeg: FFmpegInstance;
      try {
        ffmpeg = await ensureLoaded(this.loadOptions);
        this.liveInstance = ffmpeg;
      } catch (err) {
        if (err instanceof WasmLoadError) throw err;
        throw new WasmLoadError(
          `Failed to load ffmpeg.wasm: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      // Check abort before heavy work
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      // Read input blob → Uint8Array (Trap #11: drop ref after exec)
      const inputBytes = new Uint8Array(await input.arrayBuffer());

      // Set up progress parsing (Trap #3: listen to stderr only)
      this.progressParser.reset();

      const stderrLines: string[] = [];
      const logHandler = (data: { type: string; message: string }): void => {
        if (data.type !== 'stderr') return;
        stderrLines.push(data.message);

        const progressEvent = this.progressParser.parseLine(data.message);
        if (progressEvent !== null && !signal.aborted) {
          options.onProgress?.(progressEvent);
        }
      };

      ffmpeg.on('log', logHandler);

      // Determine file extensions from MIME
      const inputExt = mimeToExt(input.type);
      const outputExt = output.ext;

      let outputBytes: Uint8Array;
      try {
        outputBytes = await withMemfsFiles(ffmpeg, inputExt, outputExt, inputBytes, async (ctx) => {
          // Build command from lookup tables only (Trap #4)
          const argv = buildCommand(ctx.inputPath, ctx.outputPath, input.type, output, options);

          // Mid-exec abort: terminate() poisons instance (Trap #12)
          let abortCleanup: () => void = () => undefined;
          const abortPromise = new Promise<never>((_, reject) => {
            const handler = (): void => {
              this.terminateAndReset();
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', handler, { once: true });
            abortCleanup = () => signal.removeEventListener('abort', handler);
          });

          let exitCode: number;
          try {
            exitCode = await Promise.race([ffmpeg.exec(Array.from(argv)), abortPromise]);
          } finally {
            abortCleanup();
          }

          if (exitCode !== 0) {
            throw new WasmExecutionError(exitCode, stderrLines.join('\n'));
          }
        });
      } finally {
        ffmpeg.off('log', logHandler);
      }

      // Emit 100% on success
      if (!signal.aborted) {
        options.onProgress?.({ percent: 100, phase: 'done' });
      }

      // Schedule idle reaper
      this.scheduleIdleTimer();

      const durationMs = Date.now() - startMs;
      return {
        blob: new Blob([outputBytes.buffer as ArrayBuffer], { type: output.mime }),
        format: output,
        durationMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    }, options.signal);
  }

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  /**
   * Terminates the ffmpeg worker, cancels the idle reaper, and marks
   * this instance as disposed. Idempotent — safe to call multiple times.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.cancelIdleTimer();
    this.terminateAndReset();

    // Drain queue so in-flight converts settle
    await this.queue.drain();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private scheduleIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.terminateAndReset();
      this.idleTimer = null;
    }, this.idleTimeoutMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Terminates the live ffmpeg instance and nulls out both the instance
   * and loading promise so the next call performs a cold reload (Trap #12).
   */
  private terminateAndReset(): void {
    const inst = this.liveInstance;
    if (inst !== null) {
      try {
        inst.terminate();
      } catch {
        // Ignore terminate errors — instance may already be dead
      }
    }
    this.liveInstance = null;
    setCachedInstance(null);
    resetLoader();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps common MIME types to file extensions for MEMFS paths. */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-flv': 'flv',
  'video/3gpp': '3gp',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'image/vnd.adobe.photoshop': 'psd',
  'image/x-blp': 'blp',
  'image/vnd.ms-dds': 'dds',
  'application/postscript': 'eps',
  'image/jp2': 'jp2',
  'text/x-subrip': 'srt',
  'text/x-ass': 'ass',
  'text/vtt': 'vtt',
  'video/mp2t': 'ts',
  'video/x-ms-wmv': 'wmv',
  'video/x-f4v': 'f4v',
  'audio/x-ms-wma': 'wma',
  'audio/aiff': 'aiff',
} as const;

function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? mime.split('/')[1] ?? 'bin';
}
