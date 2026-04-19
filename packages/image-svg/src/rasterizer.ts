/**
 * SVG rasterizer: SvgFile → Blob (PNG / JPEG / WebP).
 *
 * Implements the "Rasterization algorithm" from the design note §"Rasterization":
 *  1. Resolve output dimensions (fallback chain: opts → file → viewBox → 300×150).
 *  2. Cap at MAX_RASTERIZE_WIDTH × MAX_RASTERIZE_HEIGHT BEFORE canvas allocation.
 *  3. Wrap source in a Blob, create an object URL.
 *  4. Race Image.decode() against a 5 s AbortController timeout.
 *  5. Allocate OffscreenCanvas (fallback: HTMLCanvasElement).
 *  6. Fill background for JPEG (Trap §10).
 *  7. drawImage → convertToBlob / toBlob.
 *
 * Browser-only: depends on Image, OffscreenCanvas / HTMLCanvasElement,
 * URL.createObjectURL, AbortController.
 */

import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  JPEG_DEFAULT_BACKGROUND,
  JPEG_MIME,
  MAX_RASTERIZE_HEIGHT,
  MAX_RASTERIZE_WIDTH,
  MAX_SVG_PARSE_TIME_MS,
  SVG_MIME,
} from './constants.ts';
import { SvgRasterizeError, SvgRasterizeTooLargeError } from './errors.ts';
import type { SvgFile } from './parser.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RasterizeOptions {
  /** Output pixel width. Defaults to intrinsic width from SvgFile or 300. */
  readonly width?: number;
  /** Output pixel height. Defaults to intrinsic height from SvgFile or 150. */
  readonly height?: number;
  /** Output MIME type. */
  readonly format: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Encoder quality 0..1 for JPEG/WebP. Ignored for PNG. */
  readonly quality?: number;
  /** CSS color fill for background. Default: transparent (PNG/WebP) or '#fff' (JPEG). */
  readonly background?: string;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

interface CanvasLike {
  getContext(
    contextId: '2d',
    options?: { alpha?: boolean },
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  width: number;
  height: number;
}

/**
 * Create a canvas-like surface.
 * Feature-detection is deferred to call time (not module load time) so that
 * test environments can stub OffscreenCanvas via vi.stubGlobal() before
 * rasterizeSvg is invoked.
 */
function createCanvas(width: number, height: number): CanvasLike {
  // Check at call time to pick up stubs in test environments.
  // We check just for existence of OffscreenCanvas — the prototype.convertToBlob
  // check is skipped here because test stubs may not set it on the constructor
  // prototype. The canvasToBlob helper handles the fallback gracefully.
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
}

async function canvasToBlob(
  canvas: CanvasLike,
  type: string,
  quality: number | undefined,
): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  if (typeof canvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      (canvas.toBlob as NonNullable<CanvasLike['toBlob']>)(
        (blob) => {
          if (blob === null) {
            reject(new SvgRasterizeError('toBlob returned null'));
          } else {
            resolve(blob);
          }
        },
        type,
        quality,
      );
    });
  }
  throw new SvgRasterizeError(
    'No canvas-to-blob API available (OffscreenCanvas nor HTMLCanvasElement.toBlob).',
  );
}

// ---------------------------------------------------------------------------
// Public rasterize function
// ---------------------------------------------------------------------------

/**
 * Rasterize a validated SVG document to a PNG, JPEG, or WebP Blob.
 *
 * This function uses browser-only APIs (Image, OffscreenCanvas / HTMLCanvasElement,
 * URL.createObjectURL). Do NOT call from a Node.js environment without mocking.
 *
 * Throws:
 *  - `SvgRasterizeTooLargeError` — resolved dimensions exceed the cap.
 *  - `SvgRasterizeError` — Image.decode timeout, canvas error, or encode error.
 */
export async function rasterizeSvg(file: SvgFile, opts: RasterizeOptions): Promise<Blob> {
  // Step 1: resolve output dimensions.
  const width = opts.width ?? file.width ?? file.viewBox?.width ?? DEFAULT_RASTER_WIDTH;
  const height = opts.height ?? file.height ?? file.viewBox?.height ?? DEFAULT_RASTER_HEIGHT;

  // Validate dimensions before any allocation.
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_RASTERIZE_WIDTH ||
    height > MAX_RASTERIZE_HEIGHT
  ) {
    throw new SvgRasterizeTooLargeError(width, height, MAX_RASTERIZE_WIDTH, MAX_RASTERIZE_HEIGHT);
  }

  // Step 2: wrap source in a Blob and create a one-shot object URL.
  const svgBlob = new Blob([file.source], { type: `${SVG_MIME};charset=utf-8` });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    // Step 3: race Image.decode() against the timeout (Trap §9).
    const img = new Image();
    // `decoding` hints the layout/paint pipeline; it does NOT affect img.decode()
    // (which is always async). Set 'sync' as a small hint anyway.
    img.decoding = 'sync';
    img.src = objectUrl;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, MAX_SVG_PARSE_TIME_MS);

    try {
      await Promise.race([
        img.decode(),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(
              new SvgRasterizeError(`Image.decode() timed out after ${MAX_SVG_PARSE_TIME_MS} ms.`),
            );
          });
        }),
      ]);
    } catch (err) {
      if (err instanceof SvgRasterizeError) throw err;
      throw new SvgRasterizeError(`Image.decode() rejected: ${String(err)}`, err);
    } finally {
      clearTimeout(timeoutId);
    }

    // Step 4: allocate canvas.
    const isJpeg = opts.format === JPEG_MIME;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: !isJpeg });
    if (ctx === null) {
      throw new SvgRasterizeError('Failed to obtain 2D canvas context.');
    }

    // Step 5: fill background.
    const bg = isJpeg ? (opts.background ?? JPEG_DEFAULT_BACKGROUND) : opts.background;
    if (bg !== undefined) {
      (ctx as CanvasRenderingContext2D).fillStyle = bg;
      (ctx as CanvasRenderingContext2D).fillRect(0, 0, width, height);
    }

    // Step 6: draw the SVG.
    (ctx as CanvasRenderingContext2D).drawImage(
      img as unknown as CanvasImageSource,
      0,
      0,
      width,
      height,
    );

    // Step 7: encode.
    return await canvasToBlob(canvas, opts.format, opts.quality);
  } finally {
    // Trap §9: always revoke the object URL.
    URL.revokeObjectURL(objectUrl);
  }
}
