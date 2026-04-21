import { findByExt } from '@webcvt/core';
import type { FormatDescriptor } from '@webcvt/core';

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

const imageCanvasLoader = (): Promise<void> => import('@webcvt/image-canvas').then(() => undefined);
const imageLegacyLoader = (): Promise<void> => import('@webcvt/image-legacy').then(() => undefined);
const subtitleLoader = (): Promise<void> => import('@webcvt/subtitle').then(() => undefined);
const dataTextLoader = (): Promise<void> => import('@webcvt/data-text').then(() => undefined);
const archiveZipLoader = (): Promise<void> => import('@webcvt/archive-zip').then(() => undefined);

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
