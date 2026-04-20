/**
 * Test cases 10–12 from the design note:
 *   10. parsePfm decodes a 2×2 PF big-endian RGB float and FLIPS rows top-down
 *   11. parsePfm decodes a 2×2 Pf little-endian grayscale (negative scale)
 *   12. parsePfm round-trips signed scale (e.g. -1.5) byte-equal
 */
import { describe, expect, it } from 'vitest';
import { ascii, concat, f32be, f32le } from './_test-helpers/bytes.ts';
import { ImagePixelCapError, PfmBadMagicError, PfmBadScaleError } from './errors.ts';
import { parsePfm, serializePfm } from './pfm.ts';

// Helper: build a PFM file manually
function buildPfm(
  magic: 'PF' | 'Pf',
  width: number,
  height: number,
  scale: number,
  floats: number[],
  littleEndian: boolean,
): Uint8Array {
  const header = ascii(`${magic}\n${width} ${height}\n${scale}\n`);
  const body = new Uint8Array(floats.length * 4);
  const dv = new DataView(body.buffer);
  for (let i = 0; i < floats.length; i++) {
    dv.setFloat32(i * 4, floats[i] ?? 0, littleEndian);
  }
  return concat(header, body);
}

describe('parsePfm', () => {
  // Test case 10: PF big-endian 2×2 RGB, verify row flip
  it('decodes a 2×2 PF big-endian RGB float and FLIPS rows top-down', () => {
    // On disk: bottom row first (row1), then top row (row0)
    // Bottom row = [1.0, 0.0, 0.0,  0.0, 1.0, 0.0]  (R,G,B for pixels 0 and 1 of bottom)
    // Top row    = [0.0, 0.0, 1.0,  1.0, 1.0, 1.0]
    // After flip: top row is first in memory
    const bottomRow = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]; // disk row 0
    const topRow = [0.0, 0.0, 1.0, 1.0, 1.0, 1.0]; // disk row 1
    const input = buildPfm('PF', 2, 2, 1.0, [...bottomRow, ...topRow], false /* big-endian */);

    const file = parsePfm(input);
    expect(file.format).toBe('pfm');
    expect(file.channels).toBe(3);
    expect(file.endianness).toBe('big');
    expect(file.scaleAbs).toBeCloseTo(1.0);
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);

    // After flip: memory[0..5] = topRow (disk row 1), memory[6..11] = bottomRow (disk row 0)
    expect(file.pixelData[0]).toBeCloseTo(0.0); // top-left R
    expect(file.pixelData[1]).toBeCloseTo(0.0); // top-left G
    expect(file.pixelData[2]).toBeCloseTo(1.0); // top-left B
    expect(file.pixelData[6]).toBeCloseTo(1.0); // bottom-left R
    expect(file.pixelData[7]).toBeCloseTo(0.0); // bottom-left G
    expect(file.pixelData[8]).toBeCloseTo(0.0); // bottom-left B
  });

  // Test case 11: Pf little-endian grayscale (negative scale)
  it('decodes a 2×2 Pf little-endian grayscale (negative scale)', () => {
    // scale < 0 → little-endian
    const bottomRow = [0.5, 1.0]; // disk row 0 = bottom row
    const topRow = [0.0, 0.25]; // disk row 1 = top row
    const input = buildPfm('Pf', 2, 2, -1.0, [...bottomRow, ...topRow], true /* little-endian */);

    const file = parsePfm(input);
    expect(file.channels).toBe(1);
    expect(file.endianness).toBe('little');
    // Memory: top row first after flip
    expect(file.pixelData[0]).toBeCloseTo(0.0); // top-left
    expect(file.pixelData[1]).toBeCloseTo(0.25); // top-right
    expect(file.pixelData[2]).toBeCloseTo(0.5); // bottom-left
    expect(file.pixelData[3]).toBeCloseTo(1.0); // bottom-right
  });

  // Test case 12: round-trips signed scale (-1.5) byte-equal
  it('round-trips signed scale (e.g. -1.5) byte-equal', () => {
    const floats = [1.0, 0.5, 0.0, 0.25]; // 2×2 Pf grayscale
    const input = buildPfm('Pf', 2, 2, -1.5, floats, true /* little-endian */);
    const file = parsePfm(input);
    expect(file.endianness).toBe('little');
    expect(file.scaleAbs).toBeCloseTo(1.5);
    const out = serializePfm(file);
    // Byte-equal round-trip
    expect(out).toEqual(input);
  });

  it('rejects unknown magic', () => {
    const input = ascii('P1\n1 1\n1.0\n');
    expect(() => parsePfm(input)).toThrow(PfmBadMagicError);
  });

  it('rejects scale = 0', () => {
    const input = ascii('Pf\n1 1\n0\n');
    expect(() => parsePfm(input)).toThrow(PfmBadScaleError);
  });

  it('rejects scale = NaN (not a number)', () => {
    const input = ascii('Pf\n1 1\nabc\n');
    expect(() => parsePfm(input)).toThrow(PfmBadScaleError);
  });

  it('rejects scale = Infinity', () => {
    const input = ascii('Pf\n1 1\nInfinity\n');
    expect(() => parsePfm(input)).toThrow(PfmBadScaleError);
  });

  it('rejects oversized dimensions', () => {
    const input = ascii('Pf\n16385 1\n1.0\n');
    expect(() => parsePfm(input)).toThrow(ImagePixelCapError);
  });

  it('rejects dimension 0', () => {
    const input = ascii('Pf\n0 1\n1.0\n');
    expect(() => parsePfm(input)).toThrow(ImagePixelCapError);
  });

  it('rejects height > MAX_DIM', () => {
    const input = ascii('PF\n1 16385\n1.0\n');
    expect(() => parsePfm(input)).toThrow(ImagePixelCapError);
  });

  // Sec-H-1: PFM truncated raster must throw typed error before DataView
  it('rejects truncated raster (Sec-H-1)', () => {
    // Header declares 4 floats (1 channel × 2 × 2 = 16 bytes), but body has only 8 bytes
    const header = ascii('Pf\n2 2\n1.0\n');
    const truncatedBody = new Uint8Array(8); // half the required 16 bytes
    const input = concat(header, truncatedBody);
    expect(() => parsePfm(input)).toThrow(ImagePixelCapError);
  });

  it('round-trips big-endian RGB PFM byte-equal', () => {
    const floats = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.5, 0.5, 0.5];
    const input = buildPfm('PF', 2, 2, 1.0, floats, false);
    const file = parsePfm(input);
    const out = serializePfm(file);
    expect(out).toEqual(input);
  });

  it('asymmetric pixel at known position validates row flip', () => {
    // 2×2 Pf grayscale: place distinctive value at known top-left position
    // PFM bottom-up on disk: row0 (disk) = bottom row, row1 (disk) = top row
    // Put 99.0 at top-left (disk row 1, col 0)
    const diskRow0 = [0.0, 0.0]; // bottom row
    const diskRow1 = [99.0, 0.0]; // top row (first col = 99)
    const input = buildPfm('Pf', 2, 2, 1.0, [...diskRow0, ...diskRow1], false);
    const file = parsePfm(input);
    // After flip: memory[0] = top-left = 99
    expect(file.pixelData[0]).toBeCloseTo(99.0);
    expect(file.pixelData[2]).toBeCloseTo(0.0); // bottom-left
  });
});

describe('serializePfm', () => {
  it('produces Pf magic for 1-channel', () => {
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
    const out = serializePfm(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x66); // 'f'
  });

  it('produces PF magic for 3-channel', () => {
    const pixelData = new Float32Array(12).fill(0.5);
    const file = {
      format: 'pfm' as const,
      width: 2,
      height: 2,
      channels: 3 as const,
      bitDepth: 32 as const,
      endianness: 'little' as const,
      scaleAbs: 1.0,
      pixelData,
    };
    const out = serializePfm(file);
    expect(out[0]).toBe(0x50); // 'P'
    expect(out[1]).toBe(0x46); // 'F'
  });

  it('emits negative scale for little-endian', () => {
    const pixelData = new Float32Array([1.0]);
    const file = {
      format: 'pfm' as const,
      width: 1,
      height: 1,
      channels: 1 as const,
      bitDepth: 32 as const,
      endianness: 'little' as const,
      scaleAbs: 2.5,
      pixelData,
    };
    const out = serializePfm(file);
    const header = new TextDecoder().decode(out.subarray(0, 20));
    expect(header).toContain('-2.5');
  });
});
