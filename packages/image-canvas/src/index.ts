export { CanvasBackend } from './canvas-backend.ts';
export { writeIco } from './ico-writer.ts';
export { writeBmp } from './bmp-writer.ts';
export {
  type CanvasLike,
  type PixelBridgeErrorHooks,
  blobToImageData,
  canvasToBlob,
  createCanvas,
  hasPixelBridge,
  imageDataToBlob,
} from './pixel.ts';

// ---------------------------------------------------------------------------
// registerCanvasBackend — explicit opt-in (no auto-registration)
// ---------------------------------------------------------------------------

import type { BackendRegistry } from '@catlabtech/webcvt-core';
import { defaultRegistry } from '@catlabtech/webcvt-core';
import { CanvasBackend } from './canvas-backend.ts';

/**
 * Construct a CanvasBackend and register it with the given registry (or core's
 * defaultRegistry when omitted). Returns the constructed backend so the caller
 * can later unregister it by name (`registry.unregister('canvas')`).
 *
 * Must be called explicitly by the application — nothing registers on import.
 *
 * @example
 * ```ts
 * import { registerCanvasBackend } from '@catlabtech/webcvt-image-canvas';
 * registerCanvasBackend(); // registers into core's defaultRegistry
 * ```
 */
export function registerCanvasBackend(registry: BackendRegistry = defaultRegistry): CanvasBackend {
  const backend = new CanvasBackend();
  registry.register(backend);
  return backend;
}
