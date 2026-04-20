import { describe, expect, it } from 'vitest';
import { buildApng, minimalZlibPayload } from './_test-helpers/build-apng.ts';
import { buildGif } from './_test-helpers/build-gif.ts';
import { buildWebpAnim, minimalVp8lPayload } from './_test-helpers/build-webp-anim.ts';
import { APNG_FORMAT, AnimationBackend, GIF_FORMAT, WEBP_ANIM_FORMAT } from './backend.ts';

const backend = new AnimationBackend();
const PAYLOAD = minimalZlibPayload(10);

describe('AnimationBackend', () => {
  it('has the correct name', () => {
    expect(backend.name).toBe('image-animation');
  });

  it('canHandle GIF → GIF', async () => {
    expect(await backend.canHandle(GIF_FORMAT, GIF_FORMAT)).toBe(true);
  });

  it('canHandle APNG → APNG', async () => {
    expect(await backend.canHandle(APNG_FORMAT, APNG_FORMAT)).toBe(true);
  });

  it('canHandle WEBP → WEBP', async () => {
    expect(await backend.canHandle(WEBP_ANIM_FORMAT, WEBP_ANIM_FORMAT)).toBe(true);
  });

  it('cannot handle cross-format conversions', async () => {
    expect(await backend.canHandle(GIF_FORMAT, APNG_FORMAT)).toBe(false);
    expect(await backend.canHandle(APNG_FORMAT, GIF_FORMAT)).toBe(false);
    expect(await backend.canHandle(GIF_FORMAT, WEBP_ANIM_FORMAT)).toBe(false);
  });

  it('cannot handle unsupported MIME', async () => {
    const jpeg = { ext: 'jpg', mime: 'image/jpeg', category: 'image' as const };
    expect(await backend.canHandle(jpeg, jpeg)).toBe(false);
  });

  it('converts a GIF input to GIF output', async () => {
    const gif = buildGif({
      canvasW: 4,
      canvasH: 4,
      frames: [
        { w: 4, h: 4, indexed: new Array(16).fill(0) },
        { w: 4, h: 4, indexed: new Array(16).fill(1) },
      ],
      loopCount: 0,
    });
    const blob = new Blob([gif], { type: 'image/gif' });
    const result = await backend.convert(blob, GIF_FORMAT, { format: GIF_FORMAT });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.format.mime).toBe('image/gif');
    expect(result.backend).toBe('image-animation');
    expect(result.hardwareAccelerated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('converts an APNG input to APNG output', async () => {
    const apng = buildApng({
      w: 4,
      h: 4,
      frames: [{ w: 4, h: 4, payload: PAYLOAD }],
      idatIsFirstFrame: true,
    });
    const blob = new Blob([apng], { type: 'image/apng' });
    const result = await backend.convert(blob, APNG_FORMAT, { format: APNG_FORMAT });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.format.mime).toBe('image/apng');
  });

  it('converts an animated WebP to WebP output', async () => {
    const webp = buildWebpAnim({
      canvasW: 10,
      canvasH: 10,
      frames: [
        {
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          durationMs: 100,
          subFormat: 'VP8L',
          payload: minimalVp8lPayload(),
        },
      ],
    });
    const blob = new Blob([webp], { type: 'image/webp' });
    const result = await backend.convert(blob, WEBP_ANIM_FORMAT, { format: WEBP_ANIM_FORMAT });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.format.mime).toBe('image/webp');
  });

  it('calls onProgress callbacks during conversion', async () => {
    const gif = buildGif({
      canvasW: 2,
      canvasH: 2,
      frames: [{ w: 2, h: 2, indexed: [0, 1, 0, 1] }],
    });
    const blob = new Blob([gif], { type: 'image/gif' });
    const progressEvents: number[] = [];
    await backend.convert(blob, GIF_FORMAT, {
      format: GIF_FORMAT,
      onProgress: (evt) => progressEvents.push(evt.percent),
    });
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });

  it('throws for unsupported MIME in convert', async () => {
    const { AnimationUnsupportedFormatError } = await import('./errors.ts');
    const badBlob = new Blob([new Uint8Array(10)], { type: 'image/bmp' });
    const bmpFormat = { ext: 'bmp', mime: 'image/bmp', category: 'image' as const };
    await expect(backend.convert(badBlob, bmpFormat, { format: bmpFormat })).rejects.toBeInstanceOf(
      AnimationUnsupportedFormatError,
    );
  });

  it('throws AnimationUnsupportedFormatError for static WebP passed as image/webp', async () => {
    const { AnimationUnsupportedFormatError } = await import('./errors.ts');
    // Build a static WebP (VP8X without animation flag)
    const { writeRiffChunk } = await import('./riff.ts');
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x00; // no animation flag
    vp8xPayload[4] = 9;
    vp8xPayload[7] = 9; // 10x10
    const vp8xChunk = writeRiffChunk('VP8X', vp8xPayload);
    const outerSize = 4 + vp8xChunk.length;
    const out = new Uint8Array(12 + vp8xChunk.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(vp8xChunk, 12);
    const blob = new Blob([out], { type: 'image/webp' });
    await expect(
      backend.convert(blob, WEBP_ANIM_FORMAT, { format: WEBP_ANIM_FORMAT }),
    ).rejects.toBeInstanceOf(AnimationUnsupportedFormatError);
  });

  it('throws AnimationUnsupportedFormatError for static PNG passed as image/apng', async () => {
    const { AnimationUnsupportedFormatError } = await import('./errors.ts');
    // Build a static PNG (no acTL chunk)
    const { writePngChunk } = await import('./png-chunks.ts');
    const ihdr = new Uint8Array(13);
    ihdr[3] = 1;
    ihdr[7] = 1;
    ihdr[8] = 8;
    ihdr[9] = 6;
    const staticPng = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...writePngChunk('IHDR', ihdr),
      ...writePngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x00])),
      ...writePngChunk('IEND', new Uint8Array(0)),
    ]);
    const blob = new Blob([staticPng], { type: 'image/apng' });
    await expect(
      backend.convert(blob, APNG_FORMAT, { format: APNG_FORMAT }),
    ).rejects.toBeInstanceOf(AnimationUnsupportedFormatError);
  });
});
