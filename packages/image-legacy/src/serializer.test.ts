import { describe, expect, it } from 'vitest';
import { parseImage } from './parser.ts';
import { serializeImage } from './serializer.ts';

describe('serializeImage', () => {
  it('routes to serializePbm', () => {
    const pixelData = new Uint8Array([0, 1]);
    const file = {
      format: 'pbm' as const,
      variant: 'ascii' as const,
      width: 2,
      height: 1,
      channels: 1 as const,
      bitDepth: 1 as const,
      pixelData,
    };
    const out = serializeImage(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x31); // '1'
  });

  it('routes to serializePgm', () => {
    const pixelData = new Uint8Array([128]);
    const file = {
      format: 'pgm' as const,
      variant: 'binary' as const,
      width: 1,
      height: 1,
      channels: 1 as const,
      bitDepth: 8 as const,
      maxval: 255,
      pixelData,
    };
    const out = serializeImage(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x35); // '5'
  });

  it('routes to serializePpm', () => {
    const pixelData = new Uint8Array([255, 0, 0]);
    const file = {
      format: 'ppm' as const,
      variant: 'binary' as const,
      width: 1,
      height: 1,
      channels: 3 as const,
      bitDepth: 8 as const,
      maxval: 255,
      pixelData,
    };
    const out = serializeImage(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x36); // '6'
  });

  it('routes to serializePfm', () => {
    const pixelData = new Float32Array([1.0]);
    const file = {
      format: 'pfm' as const,
      width: 1,
      height: 1,
      channels: 1 as const,
      bitDepth: 32 as const,
      endianness: 'big' as const,
      scaleAbs: 1.0,
      pixelData,
    };
    const out = serializeImage(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x66); // 'f'
  });

  it('routes to serializeQoi', () => {
    const pixelData = new Uint8Array([255, 0, 0]);
    const file = {
      format: 'qoi' as const,
      width: 1,
      height: 1,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const out = serializeImage(file);
    // QOI magic: qoif
    expect(out[0]).toBe(0x71);
    expect(out[1]).toBe(0x6f);
    expect(out[2]).toBe(0x69);
    expect(out[3]).toBe(0x66);
  });
});
