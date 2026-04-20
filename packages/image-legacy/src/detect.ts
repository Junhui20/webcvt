/**
 * Magic-byte detection for @webcvt/image-legacy.
 *
 * Checks first 4 bytes for most formats. The Netpbm magics (P1–P6, Pf, PF)
 * and QOI's "qoif" are fully byte-disjoint — disambiguation is unambiguous.
 * TGA has no fixed magic and uses structural detection (footer + header heuristic).
 *
 * NOTE: detection is NOT applied automatically inside parseImage. The caller
 * must pass a format hint explicitly to defend against coincidences in truncated
 * inputs. detectImageFormat is an opt-in helper only.
 *
 * TGA detection strategy (Trap #5 from TGA design note):
 *   (1) Footer-first: if last 18 bytes match "TRUEVISION-XFILE.\0" → 'tga'
 *   (2) Header heuristic: sanity check on colorMapType/imageType/pixelDepth/reserved bits/dims
 *   (3) null otherwise.
 */

import {
  PCX_ENCODING_RLE,
  PCX_HEADER_SIZE,
  PCX_MAGIC,
  TGA_FOOTER_SIGNATURE,
  TGA_FOOTER_SIZE,
} from './constants.ts';
import { isTgaHeader } from './tga.ts';
import { isXbmHeader } from './xbm.ts';
import { isXpmHeader } from './xpm.ts';

export type ImageFormat =
  | 'pbm'
  | 'pgm'
  | 'ppm'
  | 'pfm'
  | 'qoi'
  | 'tiff'
  | 'tga'
  | 'xbm'
  | 'pcx'
  | 'xpm';

/**
 * Sniff the format of input and return the matching ImageFormat or null.
 * TGA has no fixed magic; uses footer-first then header heuristic detection.
 *
 * Recognized magics:
 *   'P1' (0x50 0x31) → 'pbm'    (ASCII PBM)
 *   'P4' (0x50 0x34) → 'pbm'    (binary PBM)
 *   'P2' (0x50 0x32) → 'pgm'    (ASCII PGM)
 *   'P5' (0x50 0x35) → 'pgm'    (binary PGM)
 *   'P3' (0x50 0x33) → 'ppm'    (ASCII PPM)
 *   'P6' (0x50 0x36) → 'ppm'    (binary PPM)
 *   'Pf' (0x50 0x66) → 'pfm'    (grayscale PFM)
 *   'PF' (0x50 0x46) → 'pfm'    (RGB PFM)
 *   'qoif' (0x71 0x6F 0x69 0x66) → 'qoi'
 *   II*\0 (0x49 0x49 0x2A 0x00) → 'tiff'  (TIFF little-endian)
 *   MM\0* (0x4D 0x4D 0x00 0x2A) → 'tiff'  (TIFF big-endian)
 *
 * NOTE: BigTIFF (magic 43) is NOT matched here — it is handled as an
 * unsupported feature inside parseTiff, not as a separate format variant.
 */
export function detectImageFormat(input: Uint8Array): ImageFormat | null {
  if (input.length < 2) return null;

  // input.length >= 2 is guaranteed here; ?? 0 is defensive for noUncheckedIndexedAccess
  /* v8 ignore next 2 */
  const b0 = input[0] ?? 0;
  const b1 = input[1] ?? 0;

  // PCX: magic byte 0x0A at offset 0, encoding=1 at offset 2, valid version at offset 1
  // Must be checked before TGA heuristic (TGA has no fixed magic)
  if (b0 === PCX_MAGIC && input.length >= PCX_HEADER_SIZE) {
    const version = b1;
    const encoding = input[2] ?? 0;
    const validVersion =
      version === 0 || version === 2 || version === 3 || version === 4 || version === 5;
    if (validVersion && encoding === PCX_ENCODING_RLE) {
      return 'pcx';
    }
  }

  // QOI: 4-byte magic "qoif"
  if (input.length >= 4) {
    // input.length >= 4 is guaranteed here; ?? 0 is defensive for noUncheckedIndexedAccess
    /* v8 ignore next */
    if (b0 === 0x71 && b1 === 0x6f && (input[2] ?? 0) === 0x69 && (input[3] ?? 0) === 0x66) {
      return 'qoi';
    }

    // TIFF little-endian: II*\0 (0x49 0x49 0x2A 0x00)
    /* v8 ignore next */
    if (b0 === 0x49 && b1 === 0x49 && (input[2] ?? 0) === 0x2a && (input[3] ?? 0) === 0x00) {
      return 'tiff';
    }

    // TIFF big-endian: MM\0* (0x4D 0x4D 0x00 0x2A)
    /* v8 ignore next */
    if (b0 === 0x4d && b1 === 0x4d && (input[2] ?? 0) === 0x00 && (input[3] ?? 0) === 0x2a) {
      return 'tiff';
    }
  }

  // All Netpbm magics start with 'P' (0x50)
  if (b0 === 0x50) {
    switch (b1) {
      case 0x31:
        return 'pbm'; // P1
      case 0x34:
        return 'pbm'; // P4
      case 0x32:
        return 'pgm'; // P2
      case 0x35:
        return 'pgm'; // P5
      case 0x33:
        return 'ppm'; // P3
      case 0x36:
        return 'ppm'; // P6
      case 0x66:
        return 'pfm'; // Pf
      case 0x46:
        return 'pfm'; // PF
    }
  }

  // TGA: no fixed magic — structural detection (Trap #5)
  // Strategy (1): footer-first — if last 18 bytes match TGA 2.0 signature → 'tga'
  if (input.length >= TGA_FOOTER_SIZE) {
    const sigStart = input.length - TGA_FOOTER_SIZE + 8;
    let footerMatch = true;
    for (let i = 0; i < TGA_FOOTER_SIGNATURE.length; i++) {
      if ((input[sigStart + i] ?? 0) !== (TGA_FOOTER_SIGNATURE[i] ?? 0)) {
        footerMatch = false;
        break;
      }
    }
    if (footerMatch) return 'tga';
  }

  // Strategy (2): header heuristic for TGA 1.0 (no footer)
  if (isTgaHeader(input)) {
    return 'tga';
  }

  // XPM: `/* XPM */` comment or `static char *` shape.
  // Must come before XBM (XBM starts with '#define', XPM starts with '/* XPM */' or 'static').
  if (isXpmHeader(input)) {
    return 'xpm';
  }

  // XBM: no fixed magic bytes — lookahead-validated #define detection (Trap #6).
  // Must come after TGA (which uses structural detection) because XBM files start
  // with '#' which is unambiguous vs all other formats checked above.
  if (isXbmHeader(input)) {
    return 'xbm';
  }

  return null;
}
