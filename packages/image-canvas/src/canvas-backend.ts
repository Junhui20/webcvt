import type { Backend, ConvertOptions, ConvertResult, FormatDescriptor } from '@webcvt/core';
import { UnsupportedFormatError } from '@webcvt/core';
import { writeBmp } from './bmp-writer.ts';
import { writeIco } from './ico-writer.ts';

// ---------------------------------------------------------------------------
// Supported format sets
// ---------------------------------------------------------------------------

/** MIME types accepted as input (canvas can decode these via createImageBitmap). */
const SUPPORTED_INPUT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/gif', // decode-only
]);

/** MIME types accepted as output. GIF is intentionally excluded. */
const SUPPORTED_OUTPUT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/x-icon',
]);

// ---------------------------------------------------------------------------
// Canvas abstraction
// ---------------------------------------------------------------------------

/** Minimal interface covering both OffscreenCanvas and HTMLCanvasElement. */
interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2DLike | null;
}

interface CanvasRenderingContext2DLike {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

type ToBlob = (blob: Blob) => void;

/**
 * Creates a canvas of the requested size. Prefers OffscreenCanvas for
 * worker-thread compatibility; falls back to HTMLCanvasElement in environments
 * where OffscreenCanvas is unavailable (e.g. older Safari).
 */
function createCanvas(width: number, height: number): CanvasLike {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') {
    const oc = new globalThis.OffscreenCanvas(width, height) as unknown as CanvasLike;
    oc.width = width;
    oc.height = height;
    return oc;
  }
  // HTMLCanvasElement fallback (main thread only).
  const el = globalThis.document.createElement('canvas') as unknown as CanvasLike & {
    toBlob: (cb: ToBlob, type: string, quality?: number) => void;
  };
  el.width = width;
  el.height = height;
  return el;
}

/**
 * Encode the canvas to a Blob. Uses OffscreenCanvas.convertToBlob when
 * available, otherwise wraps HTMLCanvasElement.toBlob in a Promise.
 */
async function canvasToBlob(canvas: CanvasLike, mime: string, quality?: number): Promise<Blob> {
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
          reject(new Error('HTMLCanvasElement.toBlob produced null'));
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
// BMP fallback detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the canvas natively produced a BMP blob.
 * Some browsers return a different MIME (e.g. image/png) when they don't
 * support image/bmp; in that case we fall back to the self-written BMP writer.
 */
function isBmpBlob(blob: Blob): boolean {
  return blob.type === 'image/bmp';
}

// ---------------------------------------------------------------------------
// CanvasBackend
// ---------------------------------------------------------------------------

/**
 * Image conversion backend using the browser's Canvas API.
 *
 * Converts between PNG, JPG/JPEG, WebP, BMP, ICO.
 * GIF is supported as input only (decode via createImageBitmap, no encode).
 *
 * No WASM, no external codecs — pure Canvas + toBlob/convertToBlob.
 */
export class CanvasBackend implements Backend {
  readonly name = 'canvas';

  async canHandle(input: FormatDescriptor, output: FormatDescriptor): Promise<boolean> {
    return SUPPORTED_INPUT_MIMES.has(input.mime) && SUPPORTED_OUTPUT_MIMES.has(output.mime);
  }

  async convert(
    input: Blob,
    output: FormatDescriptor,
    options: ConvertOptions,
  ): Promise<ConvertResult> {
    const startMs = Date.now();

    // Validate formats up front so errors are thrown synchronously-ish.
    if (!SUPPORTED_INPUT_MIMES.has(input.type)) {
      throw new UnsupportedFormatError(input.type, 'input');
    }
    if (!SUPPORTED_OUTPUT_MIMES.has(output.mime)) {
      throw new UnsupportedFormatError(output.mime, 'output');
    }

    // Decode: browser decodes any supported image format into an ImageBitmap.
    const bitmap = await globalThis.createImageBitmap(input);

    try {
      const { width, height } = bitmap;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      if (ctx === null) {
        throw new Error('Could not get 2D context from canvas');
      }

      ctx.drawImage(bitmap, 0, 0);

      // Encode
      const blob = await encodeCanvas(canvas, bitmap, output, options);

      return {
        blob,
        format: output,
        durationMs: Date.now() - startMs,
        backend: this.name,
        hardwareAccelerated: false,
      };
    } finally {
      bitmap.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Encode helpers
// ---------------------------------------------------------------------------

async function encodeCanvas(
  canvas: CanvasLike,
  bitmap: ImageBitmap,
  output: FormatDescriptor,
  options: ConvertOptions,
): Promise<Blob> {
  switch (output.mime) {
    case 'image/x-icon':
      return encodeIco(canvas, bitmap);
    case 'image/bmp':
      return encodeBmp(canvas, bitmap);
    case 'image/jpeg':
      return canvasToBlob(canvas, 'image/jpeg', options.quality ?? 0.92);
    default:
      return canvasToBlob(canvas, output.mime, options.quality);
  }
}

/** Encode canvas as PNG, then wrap in ICO container. */
async function encodeIco(canvas: CanvasLike, bitmap: ImageBitmap): Promise<Blob> {
  const pngBlob = await canvasToBlob(canvas, 'image/png');
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  const icoBytes = writeIco(pngBytes, bitmap.width, bitmap.height);
  return new Blob([icoBytes.buffer as ArrayBuffer], { type: 'image/x-icon' });
}

/** Encode canvas as BMP, falling back to self-written writer when unsupported. */
async function encodeBmp(canvas: CanvasLike, bitmap: ImageBitmap): Promise<Blob> {
  const candidate = await canvasToBlob(canvas, 'image/bmp');

  if (isBmpBlob(candidate)) {
    return candidate;
  }

  // Browser doesn't support image/bmp natively — use the fallback writer.
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Could not get 2D context for BMP fallback');
  }
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const bmpBytes = writeBmp(imageData.data, bitmap.width, bitmap.height);
  return new Blob([bmpBytes.buffer as ArrayBuffer], { type: 'image/bmp' });
}
