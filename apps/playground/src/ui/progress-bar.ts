/** Show and update the progress bar. Percent should be 0–100. */
export function showProgress(container: HTMLElement, percent: number, phase?: string): void {
  const section = container.querySelector<HTMLElement>('#progress-section');
  const track = container.querySelector<HTMLElement>('.progress-track');
  const bar = container.querySelector<HTMLElement>('#progress-bar-fill');
  const label = container.querySelector<HTMLElement>('#progress-label');
  if (!section || !track || !bar || !label) return;

  const clamped = Math.max(0, Math.min(100, percent));
  bar.style.width = `${clamped}%`;
  // aria-valuenow belongs on the element with role="progressbar" (.progress-track)
  track.setAttribute('aria-valuenow', String(clamped));
  label.textContent = phase ? `${phase} — ${clamped}%` : `${clamped}%`;
  section.hidden = false;
}

export function hideProgress(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>('#progress-section');
  const bar = container.querySelector<HTMLElement>('#progress-bar-fill');
  if (section) section.hidden = true;
  if (bar) bar.style.width = '0%';
}
