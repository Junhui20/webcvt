import { describe, expect, it } from 'vitest';
import {
  APNG_BLEND_OP_OVER,
  APNG_BLEND_OP_SOURCE,
  APNG_DISPOSE_OP_BACKGROUND,
  APNG_DISPOSE_OP_NONE,
  APNG_DISPOSE_OP_PREVIOUS,
  FOURCC_VP8,
  FOURCC_VP8L,
  FOURCC_VP8X,
  GIF87A_MAGIC,
  GIF89A_MAGIC,
  GIF_APP_LABEL,
  GIF_GCE_LABEL,
  GIF_IMAGE_SEPARATOR,
  GIF_TRAILER,
  MAX_DIM,
  MAX_FRAMES,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  PNG_MAGIC,
  RIFF_MAGIC,
  VP8L_SIGNATURE,
  VP8X_ANIMATION_FLAG,
  WEBP_FOURCC,
} from './constants.ts';

describe('constants', () => {
  it('MAX_INPUT_BYTES is 200 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(200 * 1024 * 1024);
  });

  it('MAX_PIXELS is 16384 squared', () => {
    expect(MAX_PIXELS).toBe(16384 * 16384);
  });

  it('MAX_DIM is 16384', () => {
    expect(MAX_DIM).toBe(16384);
  });

  it('MAX_FRAMES is 4096', () => {
    expect(MAX_FRAMES).toBe(4096);
  });

  it('GIF87A magic spells GIF87a in ASCII', () => {
    expect(Array.from(GIF87A_MAGIC)).toEqual([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
  });

  it('GIF89A magic spells GIF89a in ASCII', () => {
    expect(Array.from(GIF89A_MAGIC)).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  });

  it('PNG_MAGIC matches the 8-byte PNG signature', () => {
    expect(Array.from(PNG_MAGIC)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('RIFF_MAGIC is RIFF in ASCII', () => {
    expect(new TextDecoder().decode(RIFF_MAGIC)).toBe('RIFF');
  });

  it('WEBP_FOURCC is WEBP in ASCII', () => {
    expect(new TextDecoder().decode(WEBP_FOURCC)).toBe('WEBP');
  });

  it('GIF block codes have correct values', () => {
    expect(GIF_TRAILER).toBe(0x3b);
    expect(GIF_IMAGE_SEPARATOR).toBe(0x2c);
    expect(GIF_GCE_LABEL).toBe(0xf9);
    expect(GIF_APP_LABEL).toBe(0xff);
  });

  it('APNG dispose ops are 0, 1, 2', () => {
    expect(APNG_DISPOSE_OP_NONE).toBe(0);
    expect(APNG_DISPOSE_OP_BACKGROUND).toBe(1);
    expect(APNG_DISPOSE_OP_PREVIOUS).toBe(2);
  });

  it('APNG blend ops are 0, 1', () => {
    expect(APNG_BLEND_OP_SOURCE).toBe(0);
    expect(APNG_BLEND_OP_OVER).toBe(1);
  });

  it('VP8X animation flag is bit 1 (value 2)', () => {
    expect(VP8X_ANIMATION_FLAG).toBe(2);
  });

  it('FOURCC_VP8 has trailing space (Trap §13)', () => {
    expect(FOURCC_VP8).toBe('VP8 ');
    expect(FOURCC_VP8.length).toBe(4);
  });

  it('FOURCC_VP8L is VP8L', () => {
    expect(FOURCC_VP8L).toBe('VP8L');
  });

  it('FOURCC_VP8X is VP8X', () => {
    expect(FOURCC_VP8X).toBe('VP8X');
  });

  it('VP8L_SIGNATURE is 0x2F', () => {
    expect(VP8L_SIGNATURE).toBe(0x2f);
  });
});
