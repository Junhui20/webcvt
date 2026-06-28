/**
 * Tests for jpeg-info.ts — SOF parsing and malformed-input handling.
 */

import { describe, expect, it } from 'vitest';
import { makeJpegHeader } from './_test-helpers/fixtures.ts';
import { PdfDecodeError } from './errors.ts';
import { parseJpegInfo } from './jpeg-info.ts';

describe('parseJpegInfo', () => {
  it('parses width, height and components from an RGB SOF0', () => {
    const info = parseJpegInfo(makeJpegHeader(640, 480, 3));
    expect(info.width).toBe(640);
    expect(info.height).toBe(480);
    expect(info.components).toBe(3);
  });

  it('parses a grayscale (1-component) JPEG', () => {
    expect(parseJpegInfo(makeJpegHeader(16, 8, 1).slice()).components).toBe(1);
  });

  it('skips preceding APPn segments before the SOF', () => {
    const sof = makeJpegHeader(32, 24, 3);
    // Inject an APP0 (FFE0, length 4, two payload bytes) after SOI.
    const withApp = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00,
      ...sof.slice(2),
    ]);
    const info = parseJpegInfo(withApp);
    expect(info.width).toBe(32);
    expect(info.height).toBe(24);
  });

  it('throws PdfDecodeError when there is no SOI marker', () => {
    expect(() => parseJpegInfo(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow(PdfDecodeError);
  });

  it('throws PdfDecodeError when no SOF marker is present', () => {
    // SOI + APP0 only, no SOF.
    const noSof = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    expect(() => parseJpegInfo(noSof)).toThrow(PdfDecodeError);
  });

  it('throws PdfDecodeError on a malformed segment length', () => {
    // SOI then a marker claiming length 1 (invalid; must be >= 2).
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
    expect(() => parseJpegInfo(bad)).toThrow(PdfDecodeError);
  });

  it('throws PdfDecodeError on zero dimensions', () => {
    expect(() => parseJpegInfo(makeJpegHeader(0, 0, 3))).toThrow(PdfDecodeError);
  });
});
