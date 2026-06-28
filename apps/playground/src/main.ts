import './styles.css';
import { getTargetsFor } from './backend-loader.ts';
import { type BatchInput, bundleZip, runBatch, sharedTargets } from './batch-runner.ts';
import { runConversion } from './conversion.ts';
import { detectFileFormat } from './format-detector.ts';
import { createStore } from './state.ts';
import type { AppState } from './types.ts';
import { PlaygroundError, REPO_URL } from './types.ts';
import {
  getBatchSelectedExt,
  hideBatch,
  renderBatch,
  setBatchConverting,
  setBatchItemStatus,
  showBatchFooter,
} from './ui/batch.ts';
import { createDropzone, resetDropzone } from './ui/dropzone.ts';
import { getSelectedTarget, hideFormatPicker, renderFormatPicker } from './ui/format-picker.ts';
import { hidePreview, showPreview } from './ui/preview.ts';
import { hideProgress, showProgress } from './ui/progress-bar.ts';
import { hideResult, showResult } from './ui/result.ts';
import { renderSamples } from './ui/samples.ts';
import { escHtml, formatBytes } from './utils.ts';

const VERSION = import.meta.env.VITE_WEBCVT_VERSION as string | undefined;

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const app = requireEl('app');
const errorSection = requireEl('error-section');
const cancelBtn = requireEl('cancel-btn');
const resetBtn = requireEl('reset-btn');
const versionBadge = document.getElementById('version-badge');

const store = createStore<AppState>({ phase: { kind: 'idle' }, targetFormat: null });

let abortController: AbortController | null = null;
let currentObjectUrl: string | null = null;
let currentTargets: ReturnType<typeof getTargetsFor> = [];
let batchAbort: AbortController | null = null;
let batchZipUrl: string | null = null;

function revokeObjectUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/**
 * Show an error using plain text — for user-supplied content (filenames,
 * error messages). Uses textContent so no HTML escaping is needed by callers.
 */
function showErrorText(text: string | null): void {
  if (!text) {
    errorSection.hidden = true;
    errorSection.textContent = '';
    return;
  }
  errorSection.textContent = '';
  const p = document.createElement('p');
  p.className = 'error-text';
  p.textContent = text;
  errorSection.appendChild(p);
  errorSection.hidden = false;
}

/**
 * Show an error using trusted HTML — for messages that include safe,
 * hard-coded anchor tags (GitHub issue links). All user-controlled text
 * fragments MUST be escaped with escHtml() before being passed here.
 */
function showErrorHtml(trustedHtml: string): void {
  errorSection.innerHTML = `<p class="error-text">${trustedHtml}</p>`;
  errorSection.hidden = false;
}

function hideError(): void {
  errorSection.hidden = true;
  errorSection.textContent = '';
}

/** Sync Cancel / Reset button visibility to the current phase. */
function syncButtons(phaseKind: AppState['phase']['kind']): void {
  cancelBtn.hidden = phaseKind !== 'converting';
  resetBtn.hidden = phaseKind !== 'done' && phaseKind !== 'error';
}

function resetToIdle(): void {
  revokeObjectUrl();
  abortController?.abort();
  abortController = null;
  currentTargets = [];
  store.set({ phase: { kind: 'idle' }, targetFormat: null });
  resetDropzone(app);
  hidePreview(app);
  hideFormatPicker(app);
  hideProgress(app);
  hideResult(app);
  hideError();
  batchAbort?.abort();
  batchAbort = null;
  revokeBatchZip();
  hideBatch(app);
  syncButtons('idle');
}

function revokeBatchZip(): void {
  if (batchZipUrl) {
    URL.revokeObjectURL(batchZipUrl);
    batchZipUrl = null;
  }
}

async function handleFile(file: File): Promise<void> {
  resetToIdle();
  store.patch({ phase: { kind: 'detecting' } });

  let format: Awaited<ReturnType<typeof detectFileFormat>>;
  try {
    format = await detectFileFormat(file);
  } catch {
    showErrorText(`Detection failed for "${file.name}". Please try another file.`);
    store.patch({ phase: { kind: 'idle' } });
    return;
  }

  if (!format) {
    showErrorHtml(
      `Unrecognized file format for &#x201c;${escHtml(file.name)}&#x201d;. ` +
        `<a href="${REPO_URL}/blob/main/docs/supported-formats.md" target="_blank" rel="noopener">Supported formats</a>`,
    );
    store.patch({ phase: { kind: 'idle' } });
    return;
  }

  const targets = getTargetsFor(format.ext);
  if (targets.length === 0) {
    showErrorHtml(
      `&#x201c;${escHtml(format.ext.toUpperCase())}&#x201d; is not supported as a demo input yet. ` +
        `<a href="${REPO_URL}/issues/new?title=Support+${encodeURIComponent(format.ext)}+input" target="_blank" rel="noopener">Request support</a>`,
    );
    store.patch({ phase: { kind: 'idle' } });
    return;
  }

  currentTargets = targets;
  const firstTarget = targets[0];
  store.patch({
    phase: { kind: 'ready', inputFormat: format, file },
    targetFormat: firstTarget?.format ?? null,
  });
  syncButtons('ready');

  await showPreview(app, file, format);
  renderFormatPicker(app, targets, (t) => {
    store.patch({ targetFormat: t.format });
  });
}

async function handleConvert(): Promise<void> {
  const state = store.get();
  if (state.phase.kind !== 'ready') return;
  const { file, inputFormat } = state.phase;

  const target = getSelectedTarget(app, currentTargets);
  if (!target) return;

  revokeObjectUrl();
  abortController = new AbortController();

  store.patch({ phase: { kind: 'converting', percent: 0 } });
  syncButtons('converting');
  hideResult(app);
  hideError();
  showProgress(app, 0);

  try {
    const result = await runConversion(file, inputFormat, target, {
      onProgress: (ev) => {
        const phase = store.get().phase;
        if (phase.kind === 'converting') {
          store.patch({ phase: { kind: 'converting', percent: ev.percent, phase: ev.phase } });
          showProgress(app, ev.percent, ev.phase);
        }
      },
      signal: abortController.signal,
    });

    const objectUrl = URL.createObjectURL(result.blob);
    currentObjectUrl = objectUrl;
    hideProgress(app);
    store.patch({ phase: { kind: 'done', result, objectUrl } });
    syncButtons('done');
    showResult(app, result, file.name, objectUrl);
  } catch (err) {
    hideProgress(app);
    if (err instanceof PlaygroundError && err.code === 'CANCELLED') {
      revokeObjectUrl();
      hideResult(app);
      store.patch({ phase: { kind: 'ready', inputFormat, file } });
      syncButtons('ready');
      return;
    }
    const message =
      err instanceof PlaygroundError ? err.message : `Unexpected error: ${String(err)}`;
    store.patch({ phase: { kind: 'error', message } });
    syncButtons('error');
    // conversion.ts already produces trusted HTML for PlaygroundError messages
    if (err instanceof PlaygroundError) {
      showErrorHtml(message);
    } else {
      showErrorText(message);
    }
  }
}

// ---------------------------------------------------------------------------
// Batch (multiple files)
// ---------------------------------------------------------------------------

async function handleBatch(files: File[]): Promise<void> {
  resetToIdle();

  const inputs: BatchInput[] = [];
  for (const file of files) {
    let format: Awaited<ReturnType<typeof detectFileFormat>>;
    try {
      format = await detectFileFormat(file);
    } catch {
      format = undefined;
    }
    if (format && getTargetsFor(format.ext).length > 0) {
      inputs.push({ file, inputFormat: format });
    }
  }

  if (inputs.length === 0) {
    showErrorText('None of the selected files are supported for conversion.');
    return;
  }

  const targets = sharedTargets(inputs);
  renderBatch(app, inputs, targets, {
    onConvert: () => void runBatchConvert(inputs),
    onCancel: () => batchAbort?.abort(),
    onReset: () => resetToIdle(),
  });
}

async function runBatchConvert(inputs: readonly BatchInput[]): Promise<void> {
  const outputExt = getBatchSelectedExt(app);
  if (!outputExt) return;

  revokeBatchZip();
  batchAbort = new AbortController();
  setBatchConverting(app, true);

  const outcomes = await runBatch(inputs, outputExt, {
    signal: batchAbort.signal,
    onItemStart: (i) => setBatchItemStatus(app, i, 'converting'),
    onItemDone: (i, outcome) => {
      if (outcome.result) {
        setBatchItemStatus(
          app,
          i,
          'done',
          `${outcome.result.format.ext.toUpperCase()} · ${formatBytes(outcome.result.blob.size)}`,
        );
      } else {
        const detail = outcome.error?.message ?? 'failed';
        setBatchItemStatus(
          app,
          i,
          'error',
          detail.length > 48 ? `${detail.slice(0, 48)}…` : detail,
        );
      }
    },
  });

  setBatchConverting(app, false);
  const ok = outcomes.filter((o) => o.result !== null).length;
  const fail = outcomes.length - ok;

  let zipUrl: string | null = null;
  if (ok > 0) {
    try {
      const zipBlob = await bundleZip(outcomes);
      zipUrl = URL.createObjectURL(zipBlob);
      batchZipUrl = zipUrl;
    } catch {
      zipUrl = null;
    }
  }
  showBatchFooter(app, ok, fail, zipUrl);
}

// Wire version badge
if (versionBadge && VERSION) versionBadge.textContent = `v${VERSION}`;

// Initialise button visibility
syncButtons('idle');

// Wire dropzone + samples
createDropzone(app, (files) => {
  if (files.length <= 1) {
    const single = files[0];
    if (single) void handleFile(single);
  } else {
    void handleBatch(files);
  }
});
renderSamples(app, (file) => void handleFile(file));

// Wire buttons
document.getElementById('convert-btn')?.addEventListener('click', () => void handleConvert());
cancelBtn.addEventListener('click', () => {
  abortController?.abort();
});
resetBtn.addEventListener('click', () => {
  resetToIdle();
});

// Dev-mode cross-origin isolation warning
if (!globalThis.crossOriginIsolated && import.meta.env.DEV) {
  console.warn(
    '[webcvt] crossOriginIsolated is false — SharedArrayBuffer and WebCodecs may be limited.',
  );
}
