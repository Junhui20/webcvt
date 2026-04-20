/**
 * Magic-byte detection for @webcvt/image-legacy.
 *
 * Checks first 4 bytes only. The Netpbm magics (P1–P6, Pf, PF) and QOI's
 * "qoif" are fully byte-disjoint — disambiguation is unambiguous.
 *
 * NOTE: detection is NOT applied automatically inside parseImage. The caller
 * must pass a format hint explicitly to defend against coincidences in truncated
 * inputs. detectImageFormat is an opt-in helper only.
 */

export type ImageFormat = 'pbm' | 'pgm' | 'ppm' | 'pfm' | 'qoi';

/**
 * Sniff the first 4 bytes of input and return the matching ImageFormat or null.
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
 */
export function detectImageFormat(input: Uint8Array): ImageFormat | null {
  if (input.length < 2) return null;

  const b0 = input[0] ?? 0;
  const b1 = input[1] ?? 0;

  // QOI: 4-byte magic "qoif"
  if (input.length >= 4) {
    if (b0 === 0x71 && b1 === 0x6f && (input[2] ?? 0) === 0x69 && (input[3] ?? 0) === 0x66) {
      return 'qoi';
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

  return null;
}
