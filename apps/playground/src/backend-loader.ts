import { defaultRegistry, findByExt } from '@catlabtech/webcvt-core';
import type { Backend, FormatDescriptor } from '@catlabtech/webcvt-core';

export interface TargetOption {
  readonly format: FormatDescriptor;
  readonly loader: () => Promise<void>;
}

/** Resolve a format descriptor, throwing if the ext is unknown. */
function fmt(ext: string): FormatDescriptor {
  const f = findByExt(ext);
  if (!f) throw new Error(`Unknown format: ${ext}`);
  return f;
}

/**
 * Register a backend instance, tolerating duplicate registration (can happen
 * when the same loader runs twice across a user session). Looks up by backend
 * name rather than class identity because the Backend's `name` is the
 * registry's primary key.
 */
function tryRegister(backend: Backend): void {
  if (defaultRegistry.list().some((b) => b.name === backend.name)) return;
  defaultRegistry.register(backend);
}

const imageCanvasLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-canvas');
  tryRegister(new mod.CanvasBackend());
};
const imageLegacyLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-image-legacy');
  tryRegister(new mod.ImageLegacyBackend());
};
const subtitleLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-subtitle');
  tryRegister(new mod.SubtitleBackend());
};
const dataTextLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-data-text');
  tryRegister(new mod.DataTextBackend());
};
const archiveZipLoader = async (): Promise<void> => {
  const mod = await import('@catlabtech/webcvt-archive-zip');
  tryRegister(new mod.ArchiveBackend());
};

/**
 * Allowlist mapping input file extension to available conversion targets.
 * Each target carries the lazy-loader for its backend package.
 */
export const BACKEND_ALLOWLIST: Readonly<Record<string, readonly TargetOption[]>> = {
  // Image — canvas backend
  png: [
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
  ],
  jpg: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
  ],
  jpeg: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
    { format: fmt('ico'), loader: imageCanvasLoader },
  ],
  webp: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
    { format: fmt('bmp'), loader: imageCanvasLoader },
  ],
  gif: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
  ],
  bmp: [
    { format: fmt('png'), loader: imageCanvasLoader },
    { format: fmt('webp'), loader: imageCanvasLoader },
    { format: fmt('jpeg'), loader: imageCanvasLoader },
  ],
  // Image — legacy backend (TIFF, TGA, QOI, Netpbm)
  tiff: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  tga: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  qoi: [
    { format: fmt('png'), loader: imageLegacyLoader },
    { format: fmt('bmp'), loader: imageLegacyLoader },
  ],
  // Subtitle — subtitle backend
  srt: [
    { format: fmt('vtt'), loader: subtitleLoader },
    { format: fmt('ass'), loader: subtitleLoader },
  ],
  vtt: [
    { format: fmt('srt'), loader: subtitleLoader },
    { format: fmt('ass'), loader: subtitleLoader },
  ],
  ass: [
    { format: fmt('srt'), loader: subtitleLoader },
    { format: fmt('vtt'), loader: subtitleLoader },
  ],
  // Data-text — data-text backend
  csv: [
    { format: fmt('tsv'), loader: dataTextLoader },
    { format: fmt('json'), loader: dataTextLoader },
  ],
  tsv: [
    { format: fmt('csv'), loader: dataTextLoader },
    { format: fmt('json'), loader: dataTextLoader },
  ],
  json: [
    { format: fmt('csv'), loader: dataTextLoader },
    { format: fmt('yaml'), loader: dataTextLoader },
  ],
  // Archive — archive-zip backend
  zip: [{ format: fmt('tar'), loader: archiveZipLoader }],
};

/**
 * Return target options for a given input extension.
 * Returns an empty array for unsupported formats.
 */
export function getTargetsFor(inputExt: string): readonly TargetOption[] {
  return BACKEND_ALLOWLIST[inputExt.toLowerCase()] ?? [];
}

/**
 * Dynamically import the backend package for a target option.
 * After awaiting, the backend is registered in the default registry.
 */
export async function loadBackend(target: TargetOption): Promise<void> {
  await target.loader();
}
