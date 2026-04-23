import { defaultRegistry } from '@catlabtech/webcvt-core';

interface BackendPkg {
  readonly pkg: string;
  readonly exportName: string;
  readonly id: string;
}

/**
 * Known backend packages. Each entry names: package name, named export for
 * backend class, and a stable id used for reporting.
 *
 * NOTE: export names verified against each package's src/index.ts.
 * Packages NOT matching the design note's suggested names:
 *   - image-canvas  → CanvasBackend (not ImageCanvasBackend)
 *   - image-svg     → SvgBackend (not ImageSvgBackend)
 *   - image-animation → AnimationBackend (not ImageAnimationBackend)
 *   - archive-zip   → ArchiveBackend (not ArchiveZipBackend)
 *   - backend-wasm  → no Backend class (Phase 4 placeholder only)
 */
const BACKEND_PACKAGES: readonly BackendPkg[] = [
  { pkg: '@catlabtech/webcvt-container-mp3', exportName: 'Mp3Backend', id: 'mp3' },
  { pkg: '@catlabtech/webcvt-container-wav', exportName: 'WavBackend', id: 'wav' },
  { pkg: '@catlabtech/webcvt-container-flac', exportName: 'FlacBackend', id: 'flac' },
  { pkg: '@catlabtech/webcvt-container-ogg', exportName: 'OggBackend', id: 'ogg' },
  { pkg: '@catlabtech/webcvt-container-aac', exportName: 'AacBackend', id: 'aac' },
  { pkg: '@catlabtech/webcvt-container-mp4', exportName: 'Mp4Backend', id: 'mp4' },
  { pkg: '@catlabtech/webcvt-container-webm', exportName: 'WebmBackend', id: 'webm' },
  { pkg: '@catlabtech/webcvt-container-mkv', exportName: 'MkvBackend', id: 'mkv' },
  { pkg: '@catlabtech/webcvt-container-ts', exportName: 'TsBackend', id: 'ts' },
  { pkg: '@catlabtech/webcvt-image-canvas', exportName: 'CanvasBackend', id: 'image-canvas' },
  { pkg: '@catlabtech/webcvt-image-svg', exportName: 'SvgBackend', id: 'image-svg' },
  {
    pkg: '@catlabtech/webcvt-image-animation',
    exportName: 'AnimationBackend',
    id: 'image-animation',
  },
  { pkg: '@catlabtech/webcvt-image-legacy', exportName: 'ImageLegacyBackend', id: 'image-legacy' },
  { pkg: '@catlabtech/webcvt-data-text', exportName: 'DataTextBackend', id: 'data-text' },
  { pkg: '@catlabtech/webcvt-archive-zip', exportName: 'ArchiveBackend', id: 'archive-zip' },
  { pkg: '@catlabtech/webcvt-subtitle', exportName: 'SubtitleBackend', id: 'subtitle' },
  // @catlabtech/webcvt-backend-wasm has no Backend class in the current phase; re-add when it does.
];

/**
 * Try to import each known backend package and register it in the default
 * registry. Missing packages (ERR_MODULE_NOT_FOUND) are silently skipped.
 * Returns the list of successfully registered backend ids.
 *
 * Set WEBCVT_DEBUG=1 to log skip reasons to stderr.
 */
export async function registerInstalledBackends(): Promise<readonly string[]> {
  const registered: string[] = [];

  for (const { pkg, exportName, id } of BACKEND_PACKAGES) {
    try {
      // Dynamic import — only succeeds when the package is installed.
      const mod = (await import(pkg)) as Record<string, unknown>;
      const Ctor = mod[exportName];
      if (typeof Ctor !== 'function') {
        if (process.env.WEBCVT_DEBUG) {
          process.stderr.write(
            `webcvt: skip ${pkg}: export '${exportName}' is not a constructor (got ${typeof Ctor})\n`,
          );
        }
        continue;
      }
      // Backend constructors must be no-arg per the design note (Trap #5).
      defaultRegistry.register(
        new (Ctor as new () => object)() as Parameters<typeof defaultRegistry.register>[0],
      );
      registered.push(id);
    } catch (err) {
      if (process.env.WEBCVT_DEBUG) {
        process.stderr.write(`webcvt: skip ${pkg}: ${(err as Error).message}\n`);
      }
    }
  }

  return registered;
}
