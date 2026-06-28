import { type ConvertContext, convert } from './convert.ts';
import type { ConvertOptions, ConvertResult } from './types.ts';

/** One item in a batch conversion. */
export interface BatchItem {
  /** Input blob to convert. */
  readonly input: Blob;
  /** Per-item convert options (target format, quality, per-item signal, …). */
  readonly options: ConvertOptions;
  /** Optional identifier (e.g. a filename) echoed back on the result. */
  readonly name?: string;
}

/** Outcome of a single batch item. Exactly one of `result` / `error` is non-null. */
export interface BatchItemResult {
  /** Index of this item in the input array (results are index-aligned). */
  readonly index: number;
  /** The `name` from the BatchItem, if provided. */
  readonly name?: string;
  /** The conversion result, or null if this item failed. */
  readonly result: ConvertResult | null;
  /** The error, or null if this item succeeded. */
  readonly error: Error | null;
}

export interface ConvertBatchOptions {
  /** Maximum number of conversions running at once. Default 4. */
  readonly concurrency?: number;
  /** Abort the whole batch. In-flight items are cancelled; pending items are marked aborted. */
  readonly signal?: AbortSignal;
  /** Called after each item settles, with the running completed/total counts. */
  readonly onItemComplete?: (result: BatchItemResult, completed: number, total: number) => void;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

/** Combine two AbortSignals into one (falls back to the batch signal if AbortSignal.any is absent). */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return typeof anyFn === 'function' ? anyFn([a, b]) : a;
}

/**
 * Convert many files concurrently. Each item is converted independently via
 * {@link convert}; a failure on one item is captured in that item's result and
 * never aborts the others. Results are returned index-aligned with `items`.
 *
 * @example
 *   const results = await convertBatch(
 *     files.map((f) => ({ input: f, options: { format: 'webp' }, name: f.name })),
 *     { concurrency: 4, onItemComplete: (r, done, total) => updateBar(done / total) },
 *   );
 *   const ok = results.filter((r) => r.result);
 *
 * @param items        - The files to convert (with per-item target options).
 * @param batchOptions - Concurrency, an overall abort signal, and a progress callback.
 * @param context      - Shared convert context (e.g. a specific BackendRegistry).
 */
export async function convertBatch(
  items: readonly BatchItem[],
  batchOptions: ConvertBatchOptions = {},
  context: ConvertContext = {},
): Promise<BatchItemResult[]> {
  const total = items.length;
  const results = new Array<BatchItemResult>(total);
  if (total === 0) return results;

  const concurrency = Math.max(1, Math.floor(batchOptions.concurrency ?? 4));
  let completed = 0;
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= total) return;
      const item = items[index];
      if (!item) continue;

      let res: BatchItemResult;
      if (batchOptions.signal?.aborted) {
        // Already aborted — mark this pending item without launching a conversion.
        res = { index, name: item.name, result: null, error: abortError(batchOptions.signal) };
      } else {
        const signal = combineSignals(batchOptions.signal, item.options.signal);
        const itemOptions: ConvertOptions =
          signal === item.options.signal ? item.options : { ...item.options, signal };
        try {
          const result = await convert(item.input, itemOptions, context);
          res = { index, name: item.name, result, error: null };
        } catch (err) {
          res = { index, name: item.name, result: null, error: toError(err) };
        }
      }

      results[index] = res;
      completed++;
      batchOptions.onItemComplete?.(res, completed, total);
    }
  };

  const workerCount = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
