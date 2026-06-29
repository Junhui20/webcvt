/**
 * Typed error classes for @catlabtech/webcvt-backend-native.
 *
 * All extend WebcvtError so callers can catch the base class and still switch
 * on `err.code` (UPPER_SNAKE) for fine-grained handling. No code path in this
 * package throws a bare Error.
 */

import { WebcvtError } from '@catlabtech/webcvt-core';
import { MAX_STDERR_BYTES } from './constants.ts';
import type { ToolName } from './tools.ts';

// ---------------------------------------------------------------------------
// Install hints — actionable guidance surfaced when a tool is missing
// ---------------------------------------------------------------------------

const INSTALL_HINTS: Record<ToolName, string> = {
  ffmpeg:
    'Install ffmpeg (https://ffmpeg.org/download.html; e.g. `apt install ffmpeg` or `brew install ffmpeg`) or set WEBCVT_FFMPEG to its absolute path.',
  pandoc:
    'Install pandoc (https://pandoc.org/installing.html) or set WEBCVT_PANDOC to its absolute path.',
  libreoffice:
    'Install LibreOffice (https://www.libreoffice.org/get-help/install-howto/; binary `soffice`/`libreoffice`) or set WEBCVT_LIBREOFFICE to its absolute path.',
  ghostscript:
    'Install Ghostscript (https://www.ghostscript.com/releases/; binary `gs`; e.g. `apt install ghostscript` or `brew install ghostscript`) or set WEBCVT_GHOSTSCRIPT to its absolute path.',
};

/** Truncate a stderr capture so large diagnostic dumps never bloat the heap. */
function truncateStderr(stderr: string): string {
  if (stderr.length <= MAX_STDERR_BYTES) return stderr;
  return `${stderr.slice(0, MAX_STDERR_BYTES)}\n[truncated]`;
}

// ---------------------------------------------------------------------------
// NativeToolNotFoundError
// ---------------------------------------------------------------------------

/**
 * Thrown when the native tool required for a conversion is not installed and
 * not resolvable on PATH (and no WEBCVT_<TOOL> override points at it).
 */
export class NativeToolNotFoundError extends WebcvtError {
  readonly tool: ToolName;

  constructor(tool: ToolName) {
    super('NATIVE_TOOL_NOT_FOUND', `Native tool "${tool}" was not found. ${INSTALL_HINTS[tool]}`);
    this.name = 'NativeToolNotFoundError';
    this.tool = tool;
  }
}

// ---------------------------------------------------------------------------
// NativeUnsupportedPairError
// ---------------------------------------------------------------------------

/**
 * Thrown when an (input, output) pair has no route in the table.
 *
 * Like the wasm backend's unsupported error, this is a normal control-flow
 * signal — the registry falls through to the next backend.
 */
export class NativeUnsupportedPairError extends WebcvtError {
  readonly inputExt: string;
  readonly outputExt: string;

  constructor(inputExt: string, outputExt: string) {
    super('NATIVE_UNSUPPORTED_PAIR', `backend-native has no route for ${inputExt} → ${outputExt}.`);
    this.name = 'NativeUnsupportedPairError';
    this.inputExt = inputExt;
    this.outputExt = outputExt;
  }
}

// ---------------------------------------------------------------------------
// NativeInputTooLargeError
// ---------------------------------------------------------------------------

/** Thrown when the input Blob exceeds the configured MAX_INPUT_BYTES cap. */
export class NativeInputTooLargeError extends WebcvtError {
  readonly size: number;
  readonly limit: number;

  constructor(size: number, limit: number) {
    super(
      'NATIVE_INPUT_TOO_LARGE',
      `Input too large: ${size} bytes exceeds MAX_INPUT_BYTES (${limit} bytes).`,
    );
    this.name = 'NativeInputTooLargeError';
    this.size = size;
    this.limit = limit;
  }
}

// ---------------------------------------------------------------------------
// NativeConversionFailedError
// ---------------------------------------------------------------------------

/**
 * Thrown when the tool exits non-zero (or fails to spawn / produces no output).
 * `stderr` is truncated at MAX_STDERR_BYTES.
 */
export class NativeConversionFailedError extends WebcvtError {
  readonly tool: ToolName;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(tool: ToolName, exitCode: number, stderr: string) {
    super('NATIVE_CONVERSION_FAILED', `${tool} failed with exit code ${exitCode}.`);
    this.name = 'NativeConversionFailedError';
    this.tool = tool;
    this.exitCode = exitCode;
    this.stderr = truncateStderr(stderr);
  }
}

// ---------------------------------------------------------------------------
// NativeTimeoutError
// ---------------------------------------------------------------------------

/** Thrown when the tool runs longer than the configured timeout and is killed. */
export class NativeTimeoutError extends WebcvtError {
  readonly tool: ToolName;
  readonly timeoutMs: number;

  constructor(tool: ToolName, timeoutMs: number) {
    super('NATIVE_TIMEOUT', `${tool} timed out after ${timeoutMs}ms and was killed.`);
    this.name = 'NativeTimeoutError';
    this.tool = tool;
    this.timeoutMs = timeoutMs;
  }
}
