/**
 * Netpbm file builder helpers for @webcvt/image-legacy tests.
 *
 * Constructs on-disk byte sequences for parser tests.
 * All outputs follow the canonical Netpbm binary format.
 *
 * NOT exported from the package index — test use only.
 */

import { ascii, concat, u16be } from './bytes.ts';

// ---------------------------------------------------------------------------
// PBM builders
// ---------------------------------------------------------------------------

/**
 * Build a P1 (ASCII PBM) file from a flat array of 0/1 values.
 *
 * @param width   Image width.
 * @param height  Image height.
 * @param bits    Flat row-major array of 0 or 1 values.
 */
export function buildP1(width: number, height: number, bits: number[]): Uint8Array {
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) {
      row.push(String(bits[r * width + c] ?? 0));
    }
    rows.push(row.join(' '));
  }
  return ascii(`P1\n${width} ${height}\n${rows.join('\n')}\n`);
}

/**
 * Build a P4 (binary PBM) file from a flat array of 0/1 values.
 *
 * @param width   Image width.
 * @param height  Image height.
 * @param bits    Flat row-major array of 0 or 1 values.
 */
export function buildP4(width: number, height: number, bits: number[]): Uint8Array {
  const header = ascii(`P4\n${width} ${height}\n`);
  const stride = Math.ceil(width / 8);
  const body = new Uint8Array(height * stride);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if ((bits[r * width + c] ?? 0) !== 0) {
        const byteIdx = r * stride + Math.floor(c / 8);
        const bitIdx = 7 - (c % 8);
        body[byteIdx] = (body[byteIdx] ?? 0) | (1 << bitIdx);
      }
    }
  }
  return concat(header, body);
}

// ---------------------------------------------------------------------------
// PGM builders
// ---------------------------------------------------------------------------

/**
 * Build a P2 (ASCII PGM) file.
 */
export function buildP2(
  width: number,
  height: number,
  maxval: number,
  samples: number[],
): Uint8Array {
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) {
      row.push(String(samples[r * width + c] ?? 0));
    }
    rows.push(row.join(' '));
  }
  return ascii(`P2\n${width} ${height}\n${maxval}\n${rows.join('\n')}\n`);
}

/**
 * Build a P5 (binary PGM) file, 8-bit or 16-bit depending on maxval.
 */
export function buildP5(
  width: number,
  height: number,
  maxval: number,
  samples: number[],
): Uint8Array {
  const header = ascii(`P5\n${width} ${height}\n${maxval}\n`);
  const numSamples = width * height;

  if (maxval <= 255) {
    const body = new Uint8Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      body[i] = samples[i] ?? 0;
    }
    return concat(header, body);
  }

  // 16-bit big-endian
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < numSamples; i++) {
    parts.push(u16be(samples[i] ?? 0));
  }
  return concat(...parts);
}

// ---------------------------------------------------------------------------
// PPM builders
// ---------------------------------------------------------------------------

/**
 * Build a P6 (binary PPM) file, 8-bit or 16-bit depending on maxval.
 */
export function buildP6(
  width: number,
  height: number,
  maxval: number,
  rgbSamples: number[],
): Uint8Array {
  const header = ascii(`P6\n${width} ${height}\n${maxval}\n`);
  const numSamples = width * height * 3;

  if (maxval <= 255) {
    const body = new Uint8Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      body[i] = rgbSamples[i] ?? 0;
    }
    return concat(header, body);
  }

  // 16-bit big-endian
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < numSamples; i++) {
    parts.push(u16be(rgbSamples[i] ?? 0));
  }
  return concat(...parts);
}

/**
 * Build a P3 (ASCII PPM) file.
 */
export function buildP3(
  width: number,
  height: number,
  maxval: number,
  rgbSamples: number[],
): Uint8Array {
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) {
      const base = (r * width + c) * 3;
      row.push(
        `${rgbSamples[base] ?? 0} ${rgbSamples[base + 1] ?? 0} ${rgbSamples[base + 2] ?? 0}`,
      );
    }
    rows.push(row.join(' '));
  }
  return ascii(`P3\n${width} ${height}\n${maxval}\n${rows.join('\n')}\n`);
}
