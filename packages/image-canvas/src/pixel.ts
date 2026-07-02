/**
 * Shared canvas pixel-bridge primitives for the webcvt image codecs.
 *
 * These OffscreenCanvas / HTMLCanvasElement round-trips were previously copied
 * verbatim into every `image-*` package's `pixel-bridge.ts` (and duplicated
 * again, privately, inside {@link ./canvas-backend.ts}). They are the canonical
 * source now:
 *
 * - {@link hasPixelBridge}   — environment capability probe.
 * - {@link imageDataToBlob}  — ImageData → Blob (encode side).
 * - {@link blobToImageData}  — Blob → ImageData (decode side).
 * - {@link createCanvas} / {@link canvasToBlob} — the low-level helpers the two
 *   round-trips (and CanvasBackend) build on.
 *
 * Each codec throws its *own* typed errors (e.g. `AvifEncodeError`), so failure
 * points are parameterized via {@link PixelBridgeErrorHooks}: callers inject
 * error factories and this package never depends on their error classes. When a
 * hook is omitted a generic `Error` (with an equivalent message) is thrown.
 *
 * Node.js note: OffscreenCanvas / createImageBitmap are unavailable in stock
 * Node; gate calls with {@link hasPixelBridge} first.
 */

// ---------------------------------------------------------------------------
// Canvas abstraction (covers both OffscreenCanvas and HTMLCanvasElement)
// ---------------------------------------------------------------------------

/** Minimal interface covering both OffscreenCanvas and HTMLCanvasElement. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): Canvas2DLike | null;
}

/** The subset of CanvasRenderingContext2D used by the pixel bridge. */
interface Canvas2DLike {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

// ---------------------------------------------------------------------------
// Injectable error factories
// ---------------------------------------------------------------------------

/**
 * Error factories for the pixel bridge's failure points. Every field is
 * optional; omitted hooks fall back to a generic `Error` with an equivalent
 * message. Codecs pass these so their public API keeps throwing typed errors.
 */
export interface PixelBridgeErrorHooks {
  /** A 2D context could not be obtained during `imageDataToBlob` (encode). */
  encodeContextError?: () => Error;
  /** A 2D context could not be obtained during `blobToImageData` (decode). */
  decodeContextError?: () => Error;
  /** `HTMLCanvasElement.toBlob` yielded `null`. */
  toBlobNullError?: () => Error;
  /** Decoded dimensions exceeded the pixel cap. */
  dimensionsTooLargeError?: (width: number, height: number, maxPixels: number) => Error;
}

function defaultEncodeContextError(): Error {
  return new Error('Could not get 2D context from canvas for pixel bridge (imageDataToBlob).');
}

function defaultDecodeContextError(): Error {
  return new Error('Could not get 2D context from canvas for pixel bridge (blobToImageData).');
}

function defaultToBlobNullError(): Error {
  return new Error(
    'HTMLCanvasElement.toBlob produced null — canvas may not support the requested MIME type.',
  );
}

function defaultDimensionsTooLargeError(width: number, height: number, maxPixels: number): Error {
  return new Error(
    `Image dimensions ${width}×${height} = ${width * height} pixels exceeds the ${maxPixels}-pixel cap.`,
  );
}

// ---------------------------------------------------------------------------
// Environment probe
// ---------------------------------------------------------------------------

/**
 * Returns true when canvas pixel-bridge operations are available.
 *
 * Requires OffscreenCanvas (or HTMLCanvasElement + document). By default it
 * also requires `createImageBitmap` (needed for the decode side,
 * {@link blobToImageData}); pass `{ requireImageBitmap: false }` for
 * encode-only codecs (e.g. HEIC decode) that never decode a blob to pixels.
 */
export function hasPixelBridge(options?: { requireImageBitmap?: boolean }): boolean {
  const requireImageBitmap = options?.requireImageBitmap ?? true;
  const hasCanvas =
    typeof globalThis.OffscreenCanvas !== 'undefined' ||
    (typeof globalThis.document !== 'undefined' &&
      typeof globalThis.document.createElement === 'function');
  if (!hasCanvas) return false;
  if (requireImageBitmap && typeof globalThis.createImageBitmap !== 'function') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Creates a canvas of the requested size. Prefers OffscreenCanvas for
 * worker-thread compatibility; falls back to HTMLCanvasElement in environments
 * where OffscreenCanvas is unavailable (e.g. older Safari).
 */
export function createCanvas(width: number, height: number): CanvasLike {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') {
    const oc = new globalThis.OffscreenCanvas(width, height) as unknown as CanvasLike;
    oc.width = width;
    oc.height = height;
    return oc;
  }
  // HTMLCanvasElement fallback (main thread only).
  const el = globalThis.document.createElement('canvas') as unknown as CanvasLike & {
    toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
  };
  el.width = width;
  el.height = height;
  return el;
}

/**
 * Encodes a canvas to a Blob. Uses OffscreenCanvas.convertToBlob when available,
 * otherwise wraps HTMLCanvasElement.toBlob in a Promise.
 *
 * @param onToBlobNull - Factory for the error thrown when `toBlob` yields null.
 */
export async function canvasToBlob(
  canvas: CanvasLike,
  mime: string,
  quality?: number,
  onToBlobNull: () => Error = defaultToBlobNullError,
): Promise<Blob> {
  if (typeof (canvas as { convertToBlob?: unknown }).convertToBlob === 'function') {
    const oc = canvas as unknown as {
      convertToBlob(opts: { type: string; quality?: number }): Promise<Blob>;
    };
    return oc.convertToBlob({ type: mime, quality });
  }

  // HTMLCanvasElement path
  return new Promise<Blob>((resolve, reject) => {
    const el = canvas as unknown as {
      toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
    };
    el.toBlob(
      (b) => {
        if (b === null) {
          reject(onToBlobNull());
        } else {
          resolve(b);
        }
      },
      mime,
      quality,
    );
  });
}

// ---------------------------------------------------------------------------
// imageDataToBlob (encode side)
// ---------------------------------------------------------------------------

/**
 * Converts ImageData to a Blob of the given MIME type via canvas.
 *
 * Used by codecs after their wasm decoder produces ImageData: paint it onto a
 * canvas and export the target canvas-native format (PNG/JPEG/WebP).
 *
 * @param imageData - Source pixel data (RGBA, 8-bit).
 * @param mime      - Target MIME type, e.g. 'image/png'.
 * @param quality   - Encode quality 0–1 for lossy formats (JPEG, WebP).
 * @param hooks     - Optional typed-error factories.
 */
export async function imageDataToBlob(
  imageData: ImageData,
  mime: string,
  quality?: number,
  hooks?: PixelBridgeErrorHooks,
): Promise<Blob> {
  const canvas = createCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw (hooks?.encodeContextError ?? defaultEncodeContextError)();
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, mime, quality, hooks?.toBlobNullError ?? defaultToBlobNullError);
}

// ---------------------------------------------------------------------------
// blobToImageData (decode side)
// ---------------------------------------------------------------------------

/**
 * Converts a Blob (PNG, JPEG, WebP, …) to ImageData via createImageBitmap.
 *
 * Used by codecs before their wasm encoder runs: the browser decodes the source
 * into an ImageBitmap, which is painted onto a canvas to read back pixel data.
 *
 * @param blob      - Input image blob (any format supported by createImageBitmap).
 * @param maxPixels - Pixel count cap (default: unbounded). Throws when
 *                    width×height exceeds this value, before painting.
 * @param hooks     - Optional typed-error factories.
 */
export async function blobToImageData(
  blob: Blob,
  maxPixels: number = Number.POSITIVE_INFINITY,
  hooks?: PixelBridgeErrorHooks,
): Promise<ImageData> {
  const bitmap = await globalThis.createImageBitmap(blob);
  try {
    const { width, height } = bitmap;

    // Pixel guard runs before any allocation/paint (free-function API — there is
    // no backend to guard on behalf of the caller).
    if (width * height > maxPixels) {
      throw (hooks?.dimensionsTooLargeError ?? defaultDimensionsTooLargeError)(
        width,
        height,
        maxPixels,
      );
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw (hooks?.decodeContextError ?? defaultDecodeContextError)();
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
