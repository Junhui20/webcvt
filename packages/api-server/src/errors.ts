/**
 * Typed error classes for @catlabtech/webcvt-api-server plus the single place
 * that maps every error (ours + core's) to an HTTP status code and JSON body.
 *
 * All error codes are UPPER_SNAKE_CASE strings for programmatic matching, and
 * extend core's {@link WebcvtError} so consumers can catch the whole family.
 */

import { NoBackendError, UnsupportedFormatError, WebcvtError } from '@catlabtech/webcvt-core';

/**
 * Thrown for malformed requests: missing `file`/`to`, or input whose format
 * cannot be detected. Maps to HTTP 400.
 */
export class ApiBadRequestError extends WebcvtError {
  constructor(message: string) {
    super('BAD_REQUEST', message);
    this.name = 'ApiBadRequestError';
  }
}

/**
 * Thrown when the request body exceeds the server's `maxInputBytes` cap.
 * Maps to HTTP 413.
 */
export class ApiInputTooLargeError extends WebcvtError {
  constructor(size: number | undefined, max: number) {
    super(
      'INPUT_TOO_LARGE',
      size === undefined
        ? `Request body exceeds the maximum of ${max} bytes.`
        : `Request body is ${size} bytes which exceeds the maximum of ${max} bytes.`,
    );
    this.name = 'ApiInputTooLargeError';
  }
}

/** Shape of the JSON error body returned by every failing endpoint. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/** HTTP status codes this API ever returns for an error. */
export type ApiErrorStatus = 400 | 413 | 415 | 500;

/**
 * Map any thrown value to the HTTP status code this API reports for it.
 *
 * - {@link ApiBadRequestError} → 400
 * - {@link ApiInputTooLargeError} → 413
 * - {@link UnsupportedFormatError} / {@link NoBackendError} → 415
 * - any other {@link WebcvtError} or unexpected error → 500
 *
 * Subclasses are checked before their base so the most specific status wins.
 */
export function httpStatusForError(err: unknown): ApiErrorStatus {
  if (err instanceof ApiBadRequestError) return 400;
  if (err instanceof ApiInputTooLargeError) return 413;
  if (err instanceof UnsupportedFormatError) return 415;
  if (err instanceof NoBackendError) return 415;
  return 500;
}

/**
 * Build the JSON error body for any thrown value, preferring the
 * {@link WebcvtError} `code` when present.
 */
export function toApiErrorBody(err: unknown): ApiErrorBody {
  if (err instanceof WebcvtError) {
    return { error: { code: err.code, message: err.message } };
  }
  if (err instanceof Error) {
    return { error: { code: 'INTERNAL', message: err.message } };
  }
  return { error: { code: 'INTERNAL', message: 'Internal server error.' } };
}
