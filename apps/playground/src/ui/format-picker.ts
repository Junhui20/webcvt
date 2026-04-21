import type { FormatDescriptor } from '@webcvt/core';
import type { TargetOption } from '../backend-loader.ts';

export type PickerChangeHandler = (target: TargetOption) => void;

/**
 * Render the target format picker from the given allowlist options.
 * Pre-selects the first option.
 */
export function renderFormatPicker(
  container: HTMLElement,
  targets: readonly TargetOption[],
  onChange: PickerChangeHandler,
): FormatDescriptor | null {
  const section = container.querySelector<HTMLElement>('#picker-section');
  const select = container.querySelector<HTMLSelectElement>('#format-select');
  const convertBtn = container.querySelector<HTMLButtonElement>('#convert-btn');
  if (!section || !select || !convertBtn) return null;

  select.innerHTML = '';
  for (const t of targets) {
    const opt = document.createElement('option');
    opt.value = t.format.ext;
    opt.textContent = `${t.format.ext.toUpperCase()} — ${t.format.description ?? t.format.category}`;
    select.appendChild(opt);
  }

  const getSelected = (): TargetOption | undefined =>
    targets.find((t) => t.format.ext === select.value);

  select.onchange = () => {
    const t = getSelected();
    if (t) onChange(t);
  };

  section.hidden = false;
  convertBtn.disabled = false;

  const first = targets[0];
  return first?.format ?? null;
}

export function hideFormatPicker(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>('#picker-section');
  if (section) section.hidden = true;
}

export function getSelectedTarget(
  container: HTMLElement,
  targets: readonly TargetOption[],
): TargetOption | undefined {
  const select = container.querySelector<HTMLSelectElement>('#format-select');
  if (!select) return undefined;
  return targets.find((t) => t.format.ext === select.value);
}
