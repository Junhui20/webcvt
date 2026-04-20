/**
 * Test cases 1–9 from the design note:
 *   1. parsePbm decodes a 4×2 P1 ASCII bitmap
 *   2. parsePbm decodes a 9×1 P4 binary bitmap with row padding (2-byte stride)
 *   3. parsePbm rejects P1 with non-0/1 ASCII byte
 *   4. parsePgm decodes a 2×2 P5 8-bit grayscale
 *   5. parsePgm decodes a 2×2 P5 16-bit big-endian grayscale (maxval=65535)
 *   6. parsePgm rejects sample > maxval with PgmSampleOutOfRangeError
 *   7. parsePgm strips header # comment between width and height tokens
 *   8. parsePpm decodes a 2×2 P6 8-bit RGB and round-trips byte-equal
 *   9. parsePpm decodes a 2×2 P6 16-bit big-endian RGB
 */
import { describe, expect, it } from 'vitest';
import {
  buildP1,
  buildP2,
  buildP3,
  buildP4,
  buildP5,
  buildP6,
} from './_test-helpers/build-netpbm.ts';
import { ascii, concat, u16be } from './_test-helpers/bytes.ts';
import {
  ImageInputTooLargeError,
  ImagePixelCapError,
  PbmBadAsciiByteError,
  PbmBadMagicError,
  PbmSizeMismatchError,
  PgmBadMagicError,
  PgmBadMaxvalError,
  PgmSampleOutOfRangeError,
  PpmBadMagicError,
  PpmSampleOutOfRangeError,
} from './errors.ts';
import {
  parsePbm,
  parsePgm,
  parsePpm,
  serializePbm,
  serializePgm,
  serializePpm,
} from './netpbm.ts';

// ---------------------------------------------------------------------------
// PBM tests
// ---------------------------------------------------------------------------

describe('parsePbm', () => {
  // Test case 1: P1 ASCII 4×2
  it('decodes a 4×2 P1 ASCII bitmap', () => {
    const bits = [1, 0, 1, 0, 0, 1, 0, 1];
    const input = buildP1(4, 2, bits);
    const file = parsePbm(input);
    expect(file.format).toBe('pbm');
    expect(file.variant).toBe('ascii');
    expect(file.width).toBe(4);
    expect(file.height).toBe(2);
    expect(file.channels).toBe(1);
    expect(file.bitDepth).toBe(1);
    expect(Array.from(file.pixelData)).toEqual(bits);
  });

  // Test case 2: P4 binary 9×1 with 2-byte stride
  it('decodes a 9×1 P4 binary bitmap with row padding (2-byte stride)', () => {
    // 9 pixels → stride = ceil(9/8) = 2 bytes per row
    // Pixels: 1 1 1 0 0 0 0 0  1  (last bit in second byte, position 7)
    const bits = [1, 1, 1, 0, 0, 0, 0, 0, 1];
    const input = buildP4(9, 1, bits);
    const file = parsePbm(input);
    expect(file.variant).toBe('binary');
    expect(file.width).toBe(9);
    expect(file.height).toBe(1);
    expect(Array.from(file.pixelData)).toEqual(bits);
  });

  // P4 2-byte stride validates correct pixel extraction
  it('correctly reads 9-pixel wide row (2-byte stride)', () => {
    // All 1s
    const bits = new Array(9).fill(1);
    const file = parsePbm(buildP4(9, 1, bits));
    expect(Array.from(file.pixelData)).toEqual(bits);
  });

  // P4 round-trip
  it('round-trips P4 binary byte-equal', () => {
    const bits = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const input = buildP4(8, 2, bits);
    const file = parsePbm(input);
    const out = serializePbm(file);
    expect(out).toEqual(input);
  });

  // P1 round-trip (semantic only — re-emitted canonical)
  it('round-trips P1 ASCII semantically', () => {
    const bits = [1, 0, 0, 1];
    const input = buildP1(2, 2, bits);
    const file = parsePbm(input);
    const out = serializePbm(file);
    const reparsed = parsePbm(out);
    expect(Array.from(reparsed.pixelData)).toEqual(bits);
  });

  // Test case 3: P1 with invalid ASCII byte
  it('rejects P1 with non-0/1 ASCII byte', () => {
    // '2' is 0x32
    const input = ascii('P1\n2 1\n1 2\n');
    expect(() => parsePbm(input)).toThrow(PbmBadAsciiByteError);
  });

  it('rejects unknown magic', () => {
    const input = ascii('P9\n2 2\n1 0 0 1\n');
    expect(() => parsePbm(input)).toThrow(PbmBadMagicError);
  });

  it('rejects P4 binary with wrong byte count (too short)', () => {
    // 2×2 P4: stride=1, expected body=2 bytes, provide only 1
    const header = ascii('P4\n2 2\n');
    const body = new Uint8Array([0xc0]); // only 1 byte instead of 2
    const input = concat(header, body);
    expect(() => parsePbm(input)).toThrow(PbmSizeMismatchError);
  });

  it('rejects input exceeding MAX_INPUT_BYTES', () => {
    // Use a fake large buffer via a Proxy-like approach
    // Instead: create an object that reports a large .length
    const large = new Uint8Array(1);
    Object.defineProperty(large, 'length', { get: () => 201 * 1024 * 1024 });
    expect(() => parsePbm(large)).toThrow(ImageInputTooLargeError);
  });

  it('rejects oversized dimensions before allocation', () => {
    // Declare dimensions that exceed MAX_PIXELS but keep input small
    const input = ascii(`P1\n16385 1\n${'0 '.repeat(10)}`);
    expect(() => parsePbm(input)).toThrow(ImagePixelCapError);
  });

  it('rejects dimension 0', () => {
    const input = ascii('P1\n0 1\n');
    expect(() => parsePbm(input)).toThrow(ImagePixelCapError);
  });
});

describe('serializePbm', () => {
  it('produces P1 header with correct magic', () => {
    const pixelData = new Uint8Array([1, 0, 0, 1]);
    const out = serializePbm({
      format: 'pbm',
      variant: 'ascii',
      width: 2,
      height: 2,
      channels: 1,
      bitDepth: 1,
      pixelData,
    });
    const str = new TextDecoder().decode(out);
    expect(str.startsWith('P1\n')).toBe(true);
  });

  it('produces P4 header with correct magic', () => {
    const pixelData = new Uint8Array([1, 0, 0, 1]);
    const out = serializePbm({
      format: 'pbm',
      variant: 'binary',
      width: 2,
      height: 2,
      channels: 1,
      bitDepth: 1,
      pixelData,
    });
    const str = new TextDecoder().decode(out.subarray(0, 3));
    expect(str).toBe('P4\n');
  });
});

// ---------------------------------------------------------------------------
// PGM tests
// ---------------------------------------------------------------------------

describe('parsePgm', () => {
  // Test case 4: P5 8-bit 2×2
  it('decodes a 2×2 P5 8-bit grayscale', () => {
    const samples = [10, 20, 30, 40];
    const input = buildP5(2, 2, 255, samples);
    const file = parsePgm(input);
    expect(file.format).toBe('pgm');
    expect(file.variant).toBe('binary');
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);
    expect(file.channels).toBe(1);
    expect(file.bitDepth).toBe(8);
    expect(file.maxval).toBe(255);
    expect(Array.from(file.pixelData)).toEqual(samples);
  });

  // Test case 5: P5 16-bit big-endian 2×2
  it('decodes a 2×2 P5 16-bit big-endian grayscale (maxval=65535)', () => {
    const samples = [1000, 20000, 40000, 60000];
    const input = buildP5(2, 2, 65535, samples);
    const file = parsePgm(input);
    expect(file.bitDepth).toBe(16);
    expect(file.maxval).toBe(65535);
    expect(Array.from(file.pixelData)).toEqual(samples);
  });

  // Test case 6: P2 sample > maxval
  it('rejects sample > maxval with PgmSampleOutOfRangeError', () => {
    // maxval=100 but sample 150
    const input = ascii('P2\n2 1\n100\n50 150\n');
    expect(() => parsePgm(input)).toThrow(PgmSampleOutOfRangeError);
  });

  // Test case 7: # comment between width and height tokens
  it('strips header # comment between width and height tokens', () => {
    const input = ascii('P5\n2 # this is a comment\n2\n255\n\x0a\x14\x1e\x28');
    const file = parsePgm(input);
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);
    expect(Array.from(file.pixelData)).toEqual([10, 20, 30, 40]);
  });

  it('rejects unknown magic', () => {
    const input = ascii('P1\n2 2\n255\n');
    expect(() => parsePgm(input)).toThrow(PgmBadMagicError);
  });

  it('rejects maxval=0', () => {
    const input = ascii('P5\n1 1\n0\n\x00');
    expect(() => parsePgm(input)).toThrow(PgmBadMaxvalError);
  });

  it('rejects maxval=65536', () => {
    const input = ascii('P2\n1 1\n65536\n0\n');
    expect(() => parsePgm(input)).toThrow(PgmBadMaxvalError);
  });

  it('rejects P2 ASCII with wrong token count (too few)', () => {
    // 2×2 = 4 samples but only 3 provided
    const input = ascii('P2\n2 2\n255\n10 20 30\n');
    expect(() => parsePgm(input)).toThrow(PgmSampleOutOfRangeError);
  });

  it('round-trips P5 8-bit byte-equal', () => {
    const samples = [0, 128, 64, 255];
    const input = buildP5(2, 2, 255, samples);
    const file = parsePgm(input);
    const out = serializePgm(file);
    expect(out).toEqual(input);
  });

  it('round-trips P5 16-bit byte-equal', () => {
    const samples = [0, 32768, 16384, 65535];
    const input = buildP5(2, 2, 65535, samples);
    const file = parsePgm(input);
    const out = serializePgm(file);
    expect(out).toEqual(input);
  });

  it('round-trips P2 ASCII semantically', () => {
    const samples = [10, 20, 30, 40];
    const input = buildP2(2, 2, 100, samples);
    const file = parsePgm(input);
    const out = serializePgm(file);
    const reparsed = parsePgm(out);
    expect(Array.from(reparsed.pixelData)).toEqual(samples);
  });
});

// ---------------------------------------------------------------------------
// PPM tests
// ---------------------------------------------------------------------------

describe('parsePpm', () => {
  // Test case 8: P6 8-bit 2×2 round-trip byte-equal
  it('decodes a 2×2 P6 8-bit RGB and round-trips byte-equal', () => {
    // 2x2 RGB: 4 pixels × 3 channels = 12 samples
    const rgb = [255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128];
    const input = buildP6(2, 2, 255, rgb);
    const file = parsePpm(input);
    expect(file.format).toBe('ppm');
    expect(file.variant).toBe('binary');
    expect(file.width).toBe(2);
    expect(file.height).toBe(2);
    expect(file.channels).toBe(3);
    expect(file.bitDepth).toBe(8);
    expect(Array.from(file.pixelData)).toEqual(rgb);
    // Round-trip byte-equal
    const out = serializePpm(file);
    expect(out).toEqual(input);
  });

  // Test case 9: P6 16-bit big-endian 2×2
  it('decodes a 2×2 P6 16-bit big-endian RGB', () => {
    const rgb = [60000, 0, 0, 0, 60000, 0, 0, 0, 60000, 30000, 30000, 30000];
    const input = buildP6(2, 2, 65535, rgb);
    const file = parsePpm(input);
    expect(file.bitDepth).toBe(16);
    expect(file.maxval).toBe(65535);
    expect(Array.from(file.pixelData)).toEqual(rgb);
  });

  it('rejects unknown magic', () => {
    const input = ascii('P1\n2 2\n255\n');
    expect(() => parsePpm(input)).toThrow(PpmBadMagicError);
  });

  it('rejects invalid maxval (0) in PPM header', () => {
    const input = ascii('P6\n1 1\n0\n\x00\x00\x00');
    expect(() => parsePpm(input)).toThrow(PpmSampleOutOfRangeError);
  });

  it('rejects P3 with wrong sample count (too few tokens)', () => {
    // 2×1 = 6 samples but only 3 provided
    const input = ascii('P3\n2 1\n255\n255 0 0\n');
    expect(() => parsePpm(input)).toThrow(PpmSampleOutOfRangeError);
  });

  it('round-trips P6 16-bit byte-equal', () => {
    const rgb = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000];
    const input = buildP6(2, 2, 65535, rgb);
    const file = parsePpm(input);
    const out = serializePpm(file);
    expect(out).toEqual(input);
  });

  it('rejects P3 sample > maxval', () => {
    const input = ascii('P3\n1 1\n100\n50 101 30\n');
    expect(() => parsePpm(input)).toThrow(PpmSampleOutOfRangeError);
  });

  it('decodes P3 ASCII PPM', () => {
    const input = ascii('P3\n2 1\n255\n255 0 0 0 255 0\n');
    const file = parsePpm(input);
    expect(file.variant).toBe('ascii');
    expect(Array.from(file.pixelData)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('rejects P6 binary sample > maxval (maxval=100, sample=101)', () => {
    // Build P6 with maxval=100 but a sample=101 in binary body
    const header = ascii('P6\n1 1\n100\n');
    const body = new Uint8Array([101, 0, 0]); // r=101 > maxval
    const input = concat(header, body);
    expect(() => parsePpm(input)).toThrow(PpmSampleOutOfRangeError);
  });

  it('round-trips P3 ASCII PPM semantically', () => {
    const rgb = [100, 50, 25, 200, 150, 75];
    const input = buildP3(2, 1, 255, rgb);
    const file = parsePpm(input);
    const out = serializePpm(file);
    const reparsed = parsePpm(out);
    expect(Array.from(reparsed.pixelData)).toEqual(rgb);
  });

  it('serializes P3 ASCII PPM correctly', () => {
    const pixelData = new Uint8Array([255, 128, 0, 0, 64, 32]);
    const file = {
      format: 'ppm' as const,
      variant: 'ascii' as const,
      width: 2,
      height: 1,
      channels: 3 as const,
      bitDepth: 8 as const,
      maxval: 255,
      pixelData,
    };
    const out = serializePpm(file);
    const str = new TextDecoder().decode(out);
    expect(str.startsWith('P3\n')).toBe(true);
    expect(str).toContain('255');
  });

  it('serializes P6 16-bit binary PPM correctly', () => {
    const pixelData = new Uint16Array([1000, 2000, 3000]);
    const file = {
      format: 'ppm' as const,
      variant: 'binary' as const,
      width: 1,
      height: 1,
      channels: 3 as const,
      bitDepth: 16 as const,
      maxval: 65535,
      pixelData,
    };
    const out = serializePpm(file);
    const parsed = parsePpm(out);
    expect(Array.from(parsed.pixelData)).toEqual([1000, 2000, 3000]);
  });
});

// ---------------------------------------------------------------------------
// Sec-H-2: P5/P6 truncated raster must throw typed error before reading
// out-of-bounds bytes (which would silently substitute 0 via `??0`).
// ---------------------------------------------------------------------------

describe('Sec-H-2: truncated binary raster rejection', () => {
  it('rejects truncated P5 8-bit raster', () => {
    // Header declares 4 samples (2×2), body has only 2 bytes
    const header = ascii('P5\n2 2\n255\n');
    const truncatedBody = new Uint8Array(2);
    const input = concat(header, truncatedBody);
    expect(() => parsePgm(input)).toThrow(PbmSizeMismatchError);
  });

  it('rejects truncated P5 16-bit raster', () => {
    // Header declares 4 samples × 2 bytes = 8 bytes, body has only 4 bytes
    const header = ascii('P5\n2 2\n65535\n');
    const truncatedBody = new Uint8Array(4);
    const input = concat(header, truncatedBody);
    expect(() => parsePgm(input)).toThrow(PbmSizeMismatchError);
  });

  it('rejects truncated P6 8-bit raster', () => {
    // Header declares 2×2×3 = 12 samples, body has only 6 bytes
    const header = ascii('P6\n2 2\n255\n');
    const truncatedBody = new Uint8Array(6);
    const input = concat(header, truncatedBody);
    expect(() => parsePpm(input)).toThrow(PbmSizeMismatchError);
  });

  it('rejects truncated P6 16-bit raster', () => {
    // Header declares 2×2×3×2 = 24 bytes, body has only 8 bytes
    const header = ascii('P6\n2 2\n65535\n');
    const truncatedBody = new Uint8Array(8);
    const input = concat(header, truncatedBody);
    expect(() => parsePpm(input)).toThrow(PbmSizeMismatchError);
  });
});
