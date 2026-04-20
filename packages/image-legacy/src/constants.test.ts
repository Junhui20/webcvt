import { describe, expect, it } from 'vitest';
import {
  MAX_DIM,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
  MAX_PIXEL_BYTES,
  PBM_MIME,
  PFM_MIME,
  PGM_MIME,
  PPM_MIME,
  QOI_END_MARKER,
  QOI_MAGIC,
  QOI_MAX_RUN,
  QOI_MIME,
  QOI_OP_RGB,
  QOI_OP_RGBA,
} from './constants.ts';

describe('constants', () => {
  it('MAX_INPUT_BYTES is 200 MiB', () => {
    expect(MAX_INPUT_BYTES).toBe(200 * 1024 * 1024);
  });

  it('MAX_PIXELS is 16384 * 16384', () => {
    expect(MAX_PIXELS).toBe(16384 * 16384);
  });

  it('MAX_PIXEL_BYTES is 1 GiB', () => {
    expect(MAX_PIXEL_BYTES).toBe(1024 * 1024 * 1024);
  });

  it('MAX_DIM is 16384', () => {
    expect(MAX_DIM).toBe(16384);
  });

  it('MIME types are correct', () => {
    expect(PBM_MIME).toBe('image/x-portable-bitmap');
    expect(PGM_MIME).toBe('image/x-portable-graymap');
    expect(PPM_MIME).toBe('image/x-portable-pixmap');
    expect(PFM_MIME).toBe('image/x-portable-floatmap');
    expect(QOI_MIME).toBe('image/qoi');
  });

  it('QOI magic is "qoif"', () => {
    expect(Array.from(QOI_MAGIC)).toEqual([0x71, 0x6f, 0x69, 0x66]);
  });

  it('QOI end marker is [0,0,0,0,0,0,0,1]', () => {
    expect(Array.from(QOI_END_MARKER)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('QOI opcodes have correct values', () => {
    expect(QOI_OP_RGB).toBe(0xfe);
    expect(QOI_OP_RGBA).toBe(0xff);
    expect(QOI_MAX_RUN).toBe(62);
  });
});
