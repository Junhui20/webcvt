import { NoBackendError, UnsupportedFormatError, WebcvtError, convert } from '@webcvt/core';
import type { ConvertResult, FormatDescriptor, ProgressEvent } from '@webcvt/core';
import { loadBackend } from './backend-loader.ts';
import type { TargetOption } from './backend-loader.ts';
import { PlaygroundError, REPO_URL } from './types.ts';
import { escHtml } from './utils.ts';

export interface ConversionCallbacks {
  readonly onProgress: (event: ProgressEvent) => void;
  readonly signal: AbortSignal;
}

/**
 * Load the backend for `target` then run the conversion.
 * Maps webcvt error types to PlaygroundError with trusted-HTML messages.
 * All user-controlled text fragments are escaped with escHtml().
 */
export async function runConversion(
  file: File,
  inputFormat: FormatDescriptor,
  target: TargetOption,
  callbacks: ConversionCallbacks,
): Promise<ConvertResult> {
  await loadBackend(target);

  try {
    return await convert(file, {
      format: target.format,
      onProgress: callbacks.onProgress,
      signal: callbacks.signal,
    });
  } catch (err) {
    if (callbacks.signal.aborted) {
      throw new PlaygroundError('CANCELLED', 'Conversion cancelled.');
    }
    if (err instanceof NoBackendError) {
      throw new PlaygroundError(
        'NO_BACKEND',
        `No backend available for ${escHtml(inputFormat.ext)} → ${escHtml(target.format.ext)}. This format combination may require a WASM backend. <a href="${REPO_URL}/issues/new?title=No+backend+for+${encodeURIComponent(inputFormat.ext)}+to+${encodeURIComponent(target.format.ext)}" target="_blank" rel="noopener">Open an issue</a>`,
      );
    }
    if (err instanceof UnsupportedFormatError) {
      throw new PlaygroundError(
        'UNSUPPORTED',
        `Unsupported format conversion. <a href="${REPO_URL}/issues/new" target="_blank" rel="noopener">Report on GitHub</a>`,
      );
    }
    if (err instanceof WebcvtError) {
      throw new PlaygroundError(
        err.code,
        `Conversion failed (${escHtml(err.code)}): ${escHtml(err.message)}. <a href="${REPO_URL}/issues/new" target="_blank" rel="noopener">Report on GitHub</a>`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new PlaygroundError(
      'UNKNOWN',
      `Unexpected error: ${escHtml(msg)}. <a href="${REPO_URL}/issues/new" target="_blank" rel="noopener">Report on GitHub</a>`,
    );
  }
}
