import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import type { BatchInput } from '../batch-runner.ts';
import { escHtml, formatBytes } from '../utils.ts';

export type BatchStatus = 'pending' | 'converting' | 'done' | 'error';

export interface BatchHandlers {
  readonly onConvert: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
}

/** Render the batch list + shared format picker, and wire the action buttons. */
export function renderBatch(
  container: HTMLElement,
  inputs: readonly BatchInput[],
  targets: readonly FormatDescriptor[],
  handlers: BatchHandlers,
): void {
  const section = container.querySelector<HTMLElement>('#batch-section');
  const count = container.querySelector<HTMLElement>('#batch-count');
  const select = container.querySelector<HTMLSelectElement>('#batch-format-select');
  const list = container.querySelector<HTMLElement>('#batch-list');
  const convertBtn = container.querySelector<HTMLButtonElement>('#batch-convert-btn');
  const cancelBtn = container.querySelector<HTMLButtonElement>('#batch-cancel-btn');
  const resetBtn = container.querySelector<HTMLButtonElement>('#batch-reset-btn');
  const footer = container.querySelector<HTMLElement>('#batch-footer');
  if (!section || !count || !select || !list || !convertBtn || !cancelBtn || !resetBtn || !footer)
    return;

  count.textContent = String(inputs.length);

  const hasTargets = targets.length > 0;
  select.innerHTML = '';
  for (const fmt of targets) {
    const opt = document.createElement('option');
    opt.value = fmt.ext;
    opt.textContent = `${fmt.ext.toUpperCase()} — ${fmt.description ?? fmt.category}`;
    select.appendChild(opt);
  }
  select.disabled = !hasTargets;
  convertBtn.disabled = !hasTargets;

  const statusLabel = hasTargets ? 'ready' : 'no common target';
  list.innerHTML = inputs
    .map(
      (inp, i) =>
        `<div class="batch-row" data-index="${i}" role="listitem"><span class="batch-name">${escHtml(inp.file.name)}</span><span class="badge badge--format">${escHtml(inp.inputFormat.ext.toUpperCase())}</span><span class="batch-meta">${escHtml(formatBytes(inp.file.size))}</span><span class="batch-status" data-status="pending">${statusLabel}</span></div>`,
    )
    .join('');

  convertBtn.hidden = false;
  cancelBtn.hidden = true;
  resetBtn.hidden = false;
  footer.hidden = true;
  convertBtn.onclick = handlers.onConvert;
  cancelBtn.onclick = handlers.onCancel;
  resetBtn.onclick = handlers.onReset;

  section.hidden = false;
}

/** Read the selected output extension from the batch picker. */
export function getBatchSelectedExt(container: HTMLElement): string {
  return container.querySelector<HTMLSelectElement>('#batch-format-select')?.value ?? '';
}

/** Toggle the converting state (swaps Convert ↔ Cancel, disables the picker). */
export function setBatchConverting(container: HTMLElement, converting: boolean): void {
  const convertBtn = container.querySelector<HTMLButtonElement>('#batch-convert-btn');
  const cancelBtn = container.querySelector<HTMLButtonElement>('#batch-cancel-btn');
  const select = container.querySelector<HTMLSelectElement>('#batch-format-select');
  if (convertBtn) convertBtn.hidden = converting;
  if (cancelBtn) cancelBtn.hidden = !converting;
  if (select) select.disabled = converting;
}

/** Update one file row's status badge. */
export function setBatchItemStatus(
  container: HTMLElement,
  index: number,
  status: BatchStatus,
  detail?: string,
): void {
  const el = container.querySelector<HTMLElement>(
    `.batch-row[data-index="${index}"] .batch-status`,
  );
  if (!el) return;
  el.dataset.status = status;
  el.textContent =
    status === 'converting'
      ? 'converting…'
      : status === 'done'
        ? (detail ?? 'done')
        : status === 'error'
          ? (detail ?? 'failed')
          : 'ready';
}

/** Show the summary + the "Download all (.zip)" button after the batch finishes. */
export function showBatchFooter(
  container: HTMLElement,
  okCount: number,
  failCount: number,
  zipUrl: string | null,
): void {
  const footer = container.querySelector<HTMLElement>('#batch-footer');
  const summary = container.querySelector<HTMLElement>('#batch-summary');
  const zip = container.querySelector<HTMLAnchorElement>('#batch-download-zip');
  const convertBtn = container.querySelector<HTMLButtonElement>('#batch-convert-btn');
  const cancelBtn = container.querySelector<HTMLButtonElement>('#batch-cancel-btn');
  if (!footer || !summary || !zip) return;
  if (convertBtn) convertBtn.hidden = true;
  if (cancelBtn) cancelBtn.hidden = true;
  summary.textContent = `${okCount} converted${failCount ? `, ${failCount} failed` : ''}.`;
  if (zipUrl && okCount > 0) {
    zip.href = zipUrl;
    zip.hidden = false;
  } else {
    zip.hidden = true;
  }
  footer.hidden = false;
}

export function hideBatch(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>('#batch-section');
  if (section) section.hidden = true;
}
