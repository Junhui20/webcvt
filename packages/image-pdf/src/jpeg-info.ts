/**
 * Minimal JPEG header parser — extracts dimensions and component count from the
 * Start-Of-Frame (SOF) marker so a JPEG can be embedded into a PDF via DCTDecode
 * without re-encoding.
 *
 * Hardened against malformed input: every segment length is bounds-checked
 * against the buffer before use.
 */

import { PdfDecodeError } from './errors.ts';

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  /** Number of colour components: 1 = grayscale, 3 = YCbCr/RGB, 4 = CMYK. */
  readonly components: number;
}

/** Parse a JPEG's SOF marker. Throws PdfDecodeError on malformed/non-JPEG input. */
export function parseJpegInfo(bytes: Uint8Array): JpegInfo {
  const n = bytes.length;
  const at = (k: number): number => bytes[k] ?? 0;

  if (n < 4 || at(0) !== 0xff || at(1) !== 0xd8) {
    throw new PdfDecodeError('Not a JPEG (missing SOI marker).');
  }

  let i = 2;
  while (i + 1 < n) {
    if (at(i) !== 0xff) {
      i++;
      continue;
    }
    let marker = at(i + 1);
    // Skip fill bytes (sequences of 0xFF).
    while (marker === 0xff && i + 2 < n) {
      i++;
      marker = at(i + 1);
    }
    i += 2;

    // Standalone markers carry no length: SOI(D8), EOI(D9), RSTn(D0-D7), TEM(01).
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (i + 1 >= n) break;
    const len = (at(i) << 8) | at(i + 1);
    if (len < 2 || i + len > n) {
      throw new PdfDecodeError('Malformed JPEG segment length.');
    }

    // SOF markers C0-CF, excluding DHT(C4), JPG(C8), DAC(CC).
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOF body: precision(1) height(2) width(2) components(1)
      if (i + 7 >= n) throw new PdfDecodeError('Truncated JPEG SOF segment.');
      const height = (at(i + 3) << 8) | at(i + 4);
      const width = (at(i + 5) << 8) | at(i + 6);
      const components = at(i + 7);
      if (width === 0 || height === 0) {
        throw new PdfDecodeError('JPEG reports zero width or height.');
      }
      return { width, height, components };
    }

    i += len;
  }

  throw new PdfDecodeError('No SOF marker found in JPEG.');
}
