import type { ConvertResult } from '@webcvt/core';
import { formatBytes } from '../utils.ts';

/**
 * Display the download result card.
 * Returns the object URL so the caller can revoke it later.
 */
export function showResult(
  container: HTMLElement,
  result: ConvertResult,
  originalName: string,
  objectUrl: string,
): void {
  const section = container.querySelector<HTMLElement>('#result-section');
  const downloadBtn = container.querySelector<HTMLAnchorElement>('#download-btn');
  const resultMeta = container.querySelector<HTMLElement>('#result-meta');
  if (!section || !downloadBtn || !resultMeta) return;

  const outputName = originalName.replace(/\.[^.]+$/, `.${result.format.ext}`);
  downloadBtn.href = objectUrl;
  downloadBtn.download = outputName;

  const accel = result.hardwareAccelerated ? ' · GPU' : '';
  resultMeta.textContent =
    `${result.format.ext.toUpperCase()} · ${formatBytes(result.blob.size)} · ` +
    `${result.durationMs} ms · via ${result.backend}${accel}`;

  section.hidden = false;
}

export function hideResult(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>('#result-section');
  const downloadBtn = container.querySelector<HTMLAnchorElement>('#download-btn');
  if (section) section.hidden = true;
  if (downloadBtn) {
    downloadBtn.href = '#';
    downloadBtn.removeAttribute('download');
  }
}
