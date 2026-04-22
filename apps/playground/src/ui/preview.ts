import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { escHtml, formatBytes } from '../utils.ts';

/**
 * Show a preview card for the detected file.
 * For images, loads dimensions via createImageBitmap.
 */
export async function showPreview(
  container: HTMLElement,
  file: File,
  format: FormatDescriptor,
): Promise<void> {
  const section = container.querySelector<HTMLElement>('#preview-section');
  const card = container.querySelector<HTMLElement>('#preview-card');
  if (!section || !card) return;

  let dimensionText = '';
  if (format.category === 'image') {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
      URL.revokeObjectURL(url);
      if (img.naturalWidth > 0) {
        dimensionText = ` ${img.naturalWidth}×${img.naturalHeight}`;
      }
    } catch {
      // Non-critical — dimensions are best-effort
    }
  }

  card.innerHTML = `
    <span class="badge badge--format">${escHtml(format.ext.toUpperCase())}</span>
    <span class="preview-filename">${escHtml(file.name)}</span>
    <span class="preview-meta">${escHtml(format.description ?? format.category)}${escHtml(dimensionText)}, ${escHtml(formatBytes(file.size))}</span>
  `;
  section.hidden = false;
}

export function hidePreview(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>('#preview-section');
  if (section) section.hidden = true;
}
