import { serializeZip } from '@catlabtech/webcvt-archive-zip';
import type { ConvertResult, FormatDescriptor } from '@catlabtech/webcvt-core';
import { type TargetOption, getTargetsFor } from './backend-loader.ts';
import { runConversion } from './conversion.ts';

/** A file plus its already-detected input format. */
export interface BatchInput {
  readonly file: File;
  readonly inputFormat: FormatDescriptor;
}

/** Outcome for one batch item — exactly one of result / error is set. */
export interface BatchOutcome {
  readonly file: File;
  readonly result: ConvertResult | null;
  readonly error: Error | null;
}

export interface BatchCallbacks {
  readonly onItemStart?: (index: number) => void;
  readonly onItemDone?: (index: number, outcome: BatchOutcome) => void;
  readonly signal: AbortSignal;
}

/** Small concurrency cap so a big drop doesn't spawn dozens of wasm loads at once. */
const CONCURRENCY = 3;

/** The TargetOption for a given input ext → output ext, or null if unsupported. */
function findTarget(inputExt: string, outputExt: string): TargetOption | null {
  return getTargetsFor(inputExt).find((t) => t.format.ext === outputExt) ?? null;
}

/**
 * Output formats common to ALL inputs (intersection of each input's targets), so the
 * single chosen format converts every file in the batch.
 */
export function sharedTargets(inputs: readonly BatchInput[]): FormatDescriptor[] {
  const first = inputs[0];
  if (!first) return [];
  const sets = inputs.map(
    (i) => new Set(getTargetsFor(i.inputFormat.ext).map((t) => t.format.ext)),
  );
  const firstTargets = getTargetsFor(first.inputFormat.ext);
  return firstTargets.map((t) => t.format).filter((fmt) => sets.every((s) => s.has(fmt.ext)));
}

/**
 * Run a batch with a bounded concurrency pool. Reuses the playground's runConversion
 * (filename-hint detection, typed errors) per file so every supported format works —
 * core's `convertBatch` is the equivalent library-level API (it re-detects via magic
 * bytes, which the playground deliberately avoids for text formats). One failure never
 * aborts the rest. Outcomes are index-aligned with `inputs`.
 */
export async function runBatch(
  inputs: readonly BatchInput[],
  outputExt: string,
  callbacks: BatchCallbacks,
): Promise<BatchOutcome[]> {
  const total = inputs.length;
  const outcomes = new Array<BatchOutcome>(total);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      const input = inputs[index];
      if (!input) continue;

      if (callbacks.signal.aborted) {
        outcomes[index] = { file: input.file, result: null, error: new Error('Cancelled') };
        callbacks.onItemDone?.(index, outcomes[index]);
        continue;
      }

      callbacks.onItemStart?.(index);
      const target = findTarget(input.inputFormat.ext, outputExt);
      let outcome: BatchOutcome;
      if (!target) {
        outcome = {
          file: input.file,
          result: null,
          error: new Error(`${input.inputFormat.ext} → ${outputExt} not supported`),
        };
      } else {
        try {
          const result = await runConversion(input.file, input.inputFormat, target, {
            onProgress: () => {},
            signal: callbacks.signal,
          });
          outcome = { file: input.file, result, error: null };
        } catch (err) {
          outcome = {
            file: input.file,
            result: null,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      }
      outcomes[index] = outcome;
      callbacks.onItemDone?.(index, outcome);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));
  return outcomes;
}

/** Output filename for an outcome (original name with the new extension). */
export function outputName(outcome: BatchOutcome): string {
  const ext = outcome.result?.format.ext ?? 'bin';
  return outcome.file.name.replace(/\.[^.]+$/, `.${ext}`);
}

/** Bundle all successful outcomes into a single ZIP blob (via @catlabtech/webcvt-archive-zip). */
export async function bundleZip(outcomes: readonly BatchOutcome[]): Promise<Blob> {
  const ok = outcomes.filter(
    (o): o is BatchOutcome & { result: ConvertResult } => o.result !== null,
  );
  const used = new Set<string>();
  const entries = await Promise.all(
    ok.map(async (o) => {
      let name = outputName(o);
      // De-duplicate identical output names.
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        const base = dot === -1 ? name : name.slice(0, dot);
        const ext = dot === -1 ? '' : name.slice(dot);
        let n = 2;
        while (used.has(`${base}-${n}${ext}`)) n++;
        name = `${base}-${n}${ext}`;
      }
      used.add(name);
      const bytes = new Uint8Array(await o.result.blob.arrayBuffer());
      return {
        name,
        method: 0 as const,
        crc32: 0,
        compressedSize: bytes.length,
        uncompressedSize: bytes.length,
        modified: new Date(),
        isDirectory: false,
        localHeaderOffset: 0,
        data: async () => bytes,
        stream: () => {
          throw new Error('stream() is not used by serializeZip');
        },
      };
    }),
  );
  const zipBytes = await serializeZip({ entries, comment: '' });
  return new Blob([zipBytes as BufferSource], { type: 'application/zip' });
}
