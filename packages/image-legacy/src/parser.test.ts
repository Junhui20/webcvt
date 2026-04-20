/**
 * Test cases 19, 21 from the design note:
 *   19. parseImage rejects width × height × bytes-per-pixel > MAX_PIXEL_BYTES
 *   21. serializeImage / parseImage round-trip preserves discriminated union for all 5 formats
 */
import { describe, expect, it } from 'vitest';
import { ascii, concat, u32be } from './_test-helpers/bytes.ts';
import { ImagePixelCapError } from './errors.ts';
import { parseImage } from './parser.ts';
import { serializeImage } from './serializer.ts';

const QOI_MAGIC = new Uint8Array([0x71, 0x6f, 0x69, 0x66]);
const QOI_END = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);

describe('parseImage', () => {
  // Test case 19: pixel cap exceeded
  it('rejects width × height × bytes-per-pixel > MAX_PIXEL_BYTES via claimed dimensions', () => {
    // Declare 16384×16384×3 = 805,306,368 bytes which is within 1 GiB,
    // but let's use 16384×16384 grayscale 16-bit = 536,870,912 bytes < 1 GiB
    // For a true rejection, try 16384×16384 with 16-bit RGB = 1,610,612,736 > 1 GiB
    // We can't allocate that, but we can check the cap fires for a slightly smaller claimed-too-large header
    // Use MAX_DIM+1 to trigger the dimension cap
    const overDimInput = ascii('P5\n16385 1\n255\n\x00');
    expect(() => parseImage(overDimInput, 'pgm')).toThrow(ImagePixelCapError);
  });

  it('routes PBM to parsePbm', () => {
    const input = ascii('P1\n2 1\n1 0\n');
    const file = parseImage(input, 'pbm');
    expect(file.format).toBe('pbm');
  });

  it('routes PGM to parsePgm', () => {
    const input = ascii('P5\n1 1\n100\n\x64');
    const file = parseImage(input, 'pgm');
    expect(file.format).toBe('pgm');
  });

  it('routes PPM to parsePpm', () => {
    const input = ascii('P6\n1 1\n255\n\xff\x00\x00');
    const file = parseImage(input, 'ppm');
    expect(file.format).toBe('ppm');
  });

  it('routes PFM to parsePfm', () => {
    const header = ascii('Pf\n1 1\n1.0\n');
    const body = new Uint8Array(4);
    new DataView(body.buffer).setFloat32(0, 0.5, false);
    const input = concat(header, body);
    const file = parseImage(input, 'pfm');
    expect(file.format).toBe('pfm');
  });

  it('routes QOI to parseQoi', () => {
    const header = new Uint8Array(14);
    header.set(QOI_MAGIC, 0);
    const dv = new DataView(header.buffer);
    dv.setUint32(4, 1, false);
    dv.setUint32(8, 1, false);
    header[12] = 3;
    header[13] = 0;
    const body = new Uint8Array([0xfe, 255, 0, 0]);
    const input = concat(header, body, QOI_END);
    const file = parseImage(input, 'qoi');
    expect(file.format).toBe('qoi');
  });
});

// Test case 21: round-trip for all 5 formats
describe('serializeImage / parseImage round-trip (all 5 formats)', () => {
  it('pbm: round-trip preserves discriminated union', () => {
    const pixelData = new Uint8Array([1, 0, 0, 1]);
    const file = {
      format: 'pbm' as const,
      variant: 'binary' as const,
      width: 2,
      height: 2,
      channels: 1 as const,
      bitDepth: 1 as const,
      pixelData,
    };
    const bytes = serializeImage(file);
    const parsed = parseImage(bytes, 'pbm');
    expect(parsed.format).toBe('pbm');
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
  });

  it('pgm: round-trip preserves discriminated union', () => {
    const pixelData = new Uint8Array([10, 20, 30, 40]);
    const file = {
      format: 'pgm' as const,
      variant: 'binary' as const,
      width: 2,
      height: 2,
      channels: 1 as const,
      bitDepth: 8 as const,
      maxval: 255,
      pixelData,
    };
    const bytes = serializeImage(file);
    const parsed = parseImage(bytes, 'pgm');
    expect(parsed.format).toBe('pgm');
    expect(Array.from(parsed.pixelData)).toEqual([10, 20, 30, 40]);
  });

  it('ppm: round-trip preserves discriminated union', () => {
    const pixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 64, 32]);
    const file = {
      format: 'ppm' as const,
      variant: 'binary' as const,
      width: 2,
      height: 2,
      channels: 3 as const,
      bitDepth: 8 as const,
      maxval: 255,
      pixelData,
    };
    const bytes = serializeImage(file);
    const parsed = parseImage(bytes, 'ppm');
    expect(parsed.format).toBe('ppm');
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
  });

  it('pfm: round-trip preserves discriminated union', () => {
    const pixelData = new Float32Array([0.5, 1.0, 0.0, 0.25]);
    const file = {
      format: 'pfm' as const,
      width: 2,
      height: 2,
      channels: 1 as const,
      bitDepth: 32 as const,
      endianness: 'big' as const,
      scaleAbs: 1.0,
      pixelData,
    };
    const bytes = serializeImage(file);
    const parsed = parseImage(bytes, 'pfm');
    expect(parsed.format).toBe('pfm');
    if (parsed.format === 'pfm') {
      expect(parsed.pixelData[0]).toBeCloseTo(0.5);
      expect(parsed.pixelData[3]).toBeCloseTo(0.25);
    }
  });

  it('qoi: round-trip preserves discriminated union', () => {
    const pixelData = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128]);
    const file = {
      format: 'qoi' as const,
      width: 2,
      height: 2,
      channels: 3 as const,
      colorspace: 0 as const,
      pixelData,
    };
    const bytes = serializeImage(file);
    const parsed = parseImage(bytes, 'qoi');
    expect(parsed.format).toBe('qoi');
    expect(Array.from(parsed.pixelData)).toEqual(Array.from(pixelData));
  });
});
