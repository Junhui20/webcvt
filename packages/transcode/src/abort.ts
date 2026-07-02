/**
 * Abort + pipeline-error helpers shared by the decode and encode drivers.
 */

import { TranscodeCodecError } from './errors.ts';

/** Throw an `AbortError` DOMException if the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/** Construct the standard `AbortError` DOMException (matches `fetch` semantics). */
export function createAbortError(): DOMException {
  return new DOMException('The transcode was aborted.', 'AbortError');
}

/** True for the `AbortError` DOMException thrown on cancellation. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Normalise an error thrown from a codec phase: abort errors pass through
 * untouched; anything else is wrapped as a {@link TranscodeCodecError} carrying
 * the phase label and original cause.
 */
export function asCodecError(err: unknown, phase: string): Error {
  if (isAbortError(err)) return err as DOMException;
  const message = err instanceof Error ? err.message : String(err);
  return new TranscodeCodecError(`${phase}: ${message}`, { cause: err });
}
