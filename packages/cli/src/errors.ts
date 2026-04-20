import { WebcvtError } from '@webcvt/core';

/**
 * Thrown for argv-parse failures or bad usage patterns detected at runtime.
 * Maps to exit code 2.
 */
export class CliBadUsageError extends WebcvtError {
  constructor(message: string) {
    super('BAD_USAGE', message);
    this.name = 'CliBadUsageError';
  }
}

/**
 * Thrown when the input size exceeds MAX_INPUT_BYTES.
 * Maps to exit code 1 (typed WebcvtError).
 */
export class CliInputTooLargeError extends WebcvtError {
  constructor(_actual: number, max: number) {
    const mb = (max / (1024 * 1024)).toFixed(0);
    super('INPUT_TOO_LARGE', `Input exceeds the ${mb} MiB limit. Use a smaller file.`);
    this.name = 'CliInputTooLargeError';
  }
}

/** Short usage hint appended to bad-usage error output. */
export const USAGE_HINT = "Run 'webcvt --help' for usage.";
