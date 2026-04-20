import { describe, expect, it } from 'vitest';
import { buildApng, minimalZlibPayload } from './_test-helpers/build-apng.ts';
import { buildGif } from './_test-helpers/build-gif.ts';
import { buildWebpAnim, minimalVp8lPayload } from './_test-helpers/build-webp-anim.ts';
import { detectAnimationFormat } from './detect.ts';

const PAYLOAD = minimalZlibPayload(10);

describe('detectAnimationFormat', () => {
  it('returns "gif" for GIF89a', () => {
    const gif = buildGif({
      canvasW: 4,
      canvasH: 4,
      frames: [{ w: 4, h: 4, indexed: new Array(16).fill(0) }],
    });
    expect(detectAnimationFormat(gif)).toBe('gif');
  });

  it('returns "gif" for GIF87a', () => {
    const gif = buildGif({
      canvasW: 4,
      canvasH: 4,
      frames: [{ w: 4, h: 4, indexed: new Array(16).fill(0) }],
    });
    const patched = new Uint8Array(gif);
    patched[4] = 0x37; // '7' → GIF87a
    expect(detectAnimationFormat(patched)).toBe('gif');
  });

  // Test 36: APNG detection only when acTL chunk present
  it('returns "apng" only when an acTL chunk is present in first 64 KiB of a PNG', () => {
    const apng = buildApng({ w: 4, h: 4, frames: [{ w: 4, h: 4, payload: PAYLOAD }] });
    expect(detectAnimationFormat(apng)).toBe('apng');
  });

  it('returns null for a static PNG (no acTL)', async () => {
    // Static PNG: PNG sig + IHDR + IDAT + IEND (no acTL)
    const { writePngChunk } = await import('./png-chunks.ts');
    const ihdr = new Uint8Array(13);
    ihdr[3] = 1;
    ihdr[7] = 1;
    ihdr[8] = 8;
    ihdr[9] = 2; // 1x1 RGB
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG sig
      ...writePngChunk('IHDR', ihdr),
      ...writePngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x00])),
      ...writePngChunk('IEND', new Uint8Array(0)),
    ]);
    expect(detectAnimationFormat(png)).toBeNull();
  });

  // Test 37: webp-anim detection only when VP8X has animation flag
  it('returns "webp-anim" only when VP8X has animation flag set', () => {
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
    expect(detectAnimationFormat(webp)).toBe('webp-anim');
  });

  it('returns null for a static WebP (VP8X without animation flag)', async () => {
    // Build a fake static WebP with VP8X but no animation flag
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x00; // no flags (no animation, no alpha)
    vp8xPayload[4] = 9;
    vp8xPayload[7] = 9; // 10x10

    const { writeRiffChunk } = await import('./riff.ts');
    const vp8xChunk = writeRiffChunk('VP8X', vp8xPayload);
    const innerTotal = vp8xChunk.length;
    const outerSize = 4 + innerTotal;
    const out = new Uint8Array(12 + innerTotal);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46;
    out[4] = outerSize & 0xff;
    out[5] = (outerSize >> 8) & 0xff;
    out[6] = (outerSize >> 16) & 0xff;
    out[7] = (outerSize >> 24) & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50;
    out.set(vp8xChunk, 12);
    expect(detectAnimationFormat(out)).toBeNull();
  });

  it('returns null for unknown formats', () => {
    expect(detectAnimationFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(detectAnimationFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    expect(detectAnimationFormat(new Uint8Array(0))).toBeNull();
    // 12+ byte buffer with no matching magic — exercises the final `return null` at end of function
    expect(detectAnimationFormat(new Uint8Array(12).fill(0x42))).toBeNull(); // 'BBBBBBBBBBBB'
    // JPEG header (FF D8 FF) with 12 bytes — not GIF/PNG/RIFF
    expect(
      detectAnimationFormat(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
      ),
    ).toBeNull();
  });

  it('returns null for truncated input', () => {
    expect(detectAnimationFormat(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('returns null for RIFF without WEBP FourCC (e.g. RIFF/AVI)', async () => {
    // Build a RIFF file with AVI  instead of WEBP
    const { writeRiffChunk } = await import('./riff.ts');
    const animChunk = writeRiffChunk('idx1', new Uint8Array(4));
    const outerSize = 4 + animChunk.length;
    const out = new Uint8Array(12 + animChunk.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46; // 'RIFF'
    out[4] = outerSize & 0xff;
    out[8] = 0x41;
    out[9] = 0x56;
    out[10] = 0x49;
    out[11] = 0x20; // 'AVI '
    out.set(animChunk, 12);
    expect(detectAnimationFormat(out)).toBeNull();
  });

  it('returns null for RIFF/WEBP without VP8X as first chunk', async () => {
    // Build a RIFF/WEBP where the first chunk is ANIM, not VP8X
    const { writeRiffChunk } = await import('./riff.ts');
    const animPayload = new Uint8Array(6);
    const animChunk = writeRiffChunk('ANIM', animPayload);
    const outerSize = 4 + animChunk.length;
    const out = new Uint8Array(12 + animChunk.length);
    out[0] = 0x52;
    out[1] = 0x49;
    out[2] = 0x46;
    out[3] = 0x46; // 'RIFF'
    out[4] = outerSize & 0xff;
    out[8] = 0x57;
    out[9] = 0x45;
    out[10] = 0x42;
    out[11] = 0x50; // 'WEBP'
    out.set(animChunk, 12);
    expect(detectAnimationFormat(out)).toBeNull();
  });

  it('returns null for PNG with acTL after IDAT (scanner stops at IDAT)', async () => {
    // Build static PNG: PNG sig + IHDR + IDAT then acTL after IDAT — scanner stops at IDAT
    const { writePngChunk } = await import('./png-chunks.ts');
    const ihdr = new Uint8Array(13);
    ihdr[3] = 4;
    ihdr[7] = 4;
    ihdr[8] = 8;
    ihdr[9] = 6; // 4x4 RGBA
    // acTL chunk
    const actl = new Uint8Array(8);
    actl[3] = 1; // numFrames = 1
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG sig
      ...writePngChunk('IHDR', ihdr),
      ...writePngChunk('IDAT', new Uint8Array([0x78, 0x9c])),
      ...writePngChunk('acTL', actl), // acTL AFTER IDAT — should not be detected
      ...writePngChunk('IEND', new Uint8Array(0)),
    ]);
    expect(detectAnimationFormat(png)).toBeNull();
  });

  it('returns null for PNG ending at IEND without acTL', async () => {
    const { writePngChunk } = await import('./png-chunks.ts');
    const ihdr = new Uint8Array(13);
    ihdr[3] = 1;
    ihdr[7] = 1;
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...writePngChunk('IHDR', ihdr),
      ...writePngChunk('IEND', new Uint8Array(0)),
    ]);
    expect(detectAnimationFormat(png)).toBeNull();
  });

  it('scans past ancillary chunks to find acTL before IDAT', async () => {
    // PNG sig + IHDR + pHYs (ancillary) + acTL + IDAT + IEND
    const { writePngChunk } = await import('./png-chunks.ts');
    const ihdr = new Uint8Array(13);
    ihdr[3] = 2;
    ihdr[7] = 2;
    ihdr[8] = 8;
    ihdr[9] = 6; // 2x2 RGBA
    const phys = new Uint8Array(9); // pHYs chunk
    const actl = new Uint8Array(8);
    actl[3] = 1; // numFrames = 1
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...writePngChunk('IHDR', ihdr),
      ...writePngChunk('pHYs', phys),
      ...writePngChunk('acTL', actl),
      ...writePngChunk('IDAT', new Uint8Array([0x78, 0x9c])),
      ...writePngChunk('IEND', new Uint8Array(0)),
    ]);
    expect(detectAnimationFormat(png)).toBe('apng');
  });
});
