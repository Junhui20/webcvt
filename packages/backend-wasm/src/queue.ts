/**
 * SerialQueue — single-file serial task executor for @catlabtech/webcvt-backend-wasm.
 *
 * FFmpeg.wasm is not re-entrant: concurrent calls would corrupt internal
 * state. All convert() calls are serialised through this queue.
 *
 * Abort support (Trap #16) at three tiers:
 * 1. Pre-start: if signal is already aborted, reject immediately before
 *    the task function is even called.
 * 2. Mid-run: signal.addEventListener('abort') → terminate() + reject with
 *    AbortError. The backend nulls instance+loading after terminate().
 * 3. Post-complete: abort of an already-resolved promise is a no-op.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A task function that takes an AbortSignal and returns a Promise. */
export type Task<T> = (signal: AbortSignal) => Promise<T>;

// ---------------------------------------------------------------------------
// SerialQueue
// ---------------------------------------------------------------------------

/**
 * Promise-chain based serial queue. Guarantees exactly one task runs at a
 * time, in FIFO order. Does not require Worker threads.
 */
export class SerialQueue {
  /** The tail of the current promise chain. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Enqueues a task. Returns a Promise that resolves/rejects when the task
   * completes (which may be after other currently-queued tasks finish first).
   *
   * @param task    - Async function receiving an AbortSignal.
   * @param signal  - Optional external AbortSignal. Pre-start abort throws
   *                  immediately; mid-run abort is forwarded to the task.
   */
  enqueue<T>(task: Task<T>, signal?: AbortSignal): Promise<T> {
    const result = this.tail.then((): Promise<T> => {
      // Tier 1: Pre-start abort check
      if (signal?.aborted === true) {
        return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }

      return new Promise<T>((resolve, reject) => {
        let abortHandler: (() => void) | null = null;

        // Tier 2: Mid-run abort listener
        if (signal !== undefined) {
          abortHandler = () => {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        }

        task(signal ?? new AbortController().signal)
          .then((value) => {
            if (abortHandler !== null && signal !== undefined) {
              signal.removeEventListener('abort', abortHandler);
            }
            resolve(value);
          })
          .catch((err: unknown) => {
            if (abortHandler !== null && signal !== undefined) {
              signal.removeEventListener('abort', abortHandler);
            }
            reject(err);
          });
      });
    });

    // Advance the tail. Swallow errors so a failed task doesn't block the queue.
    this.tail = result.catch(() => undefined);

    return result;
  }

  /**
   * Drains the queue: returns a Promise that resolves once all currently
   * enqueued tasks have settled (including failed ones).
   */
  drain(): Promise<void> {
    return this.tail.then(() => undefined).catch(() => undefined);
  }
}
