/**
 * Typed error classes for @catlabtech/webcvt-backend-wasm.
 *
 * Three distinct failure modes — all extend WebcvtError so callers can
 * catch the base class and still switch on `err.code` for fine-grained
 * handling.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { MAX_STDERR_BYTES } from './constants.ts';

// ---------------------------------------------------------------------------
// WasmLoadError
// ---------------------------------------------------------------------------

/**
 * Thrown when the FFmpeg WASM module cannot be loaded.
 *
 * Typical causes: network failure, Content-Security-Policy blocking the
 * worker URL, SharedArrayBuffer unavailable without COOP/COEP headers.
 */
export class WasmLoadError extends WebcvtError {
  constructor(message: string, options?: ErrorOptions) {
    super('WASM_LOAD_FAILED', message, options);
    this.name = 'WasmLoadError';
  }
}

// ---------------------------------------------------------------------------
// WasmExecutionError
// ---------------------------------------------------------------------------

/**
 * Thrown when ffmpeg.exec() returns a non-zero exit code.
 *
 * `stderr` is truncated at MAX_STDERR_BYTES to avoid storing large
 * diagnostic dumps in the heap.
 */
export class WasmExecutionError extends WebcvtError {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(exitCode: number, stderr: string) {
    const truncated =
      stderr.length > MAX_STDERR_BYTES
        ? `${stderr.slice(0, MAX_STDERR_BYTES)}\n[truncated]`
        : stderr;
    super('WASM_EXEC_FAILED', `ffmpeg exited with code ${exitCode}`);
    this.name = 'WasmExecutionError';
    this.exitCode = exitCode;
    this.stderr = truncated;
  }
}

// ---------------------------------------------------------------------------
// WasmUnsupportedError
// ---------------------------------------------------------------------------

/**
 * Thrown when a requested MIME pair is not present in the allowlist.
 *
 * This is a normal control-flow signal: the registry will fall through to
 * the next backend rather than showing a user-visible error.
 */
export class WasmUnsupportedError extends WebcvtError {
  constructor(inputMime: string, outputMime: string) {
    super('WASM_UNSUPPORTED', `backend-wasm does not allowlist ${inputMime} \u2192 ${outputMime}.`);
    this.name = 'WasmUnsupportedError';
  }
}
