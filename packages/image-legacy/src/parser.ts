/**
 * Top-level image parser dispatcher for @webcvt/image-legacy.
 *
 * parseImage(input, format) switches on format and routes to the appropriate
 * per-format parser. Format is an explicit caller hint — auto-detection is
 * NOT applied (see detectImageFormat for the opt-in helper).
 */

import type { ImageFormat } from './detect.ts';
import {
  type PbmFile,
  type PgmFile,
  type PpmFile,
  parsePbm,
  parsePgm,
  parsePpm,
} from './netpbm.ts';
import { type PfmFile, parsePfm } from './pfm.ts';
import { type QoiFile, parseQoi } from './qoi.ts';
import { type TgaFile, parseTga } from './tga.ts';
import { type TiffFile, parseTiff } from './tiff.ts';
import { type XbmFile, parseXbm } from './xbm.ts';

// ---------------------------------------------------------------------------
// Public discriminated union
// ---------------------------------------------------------------------------

export type ImageFile =
  | PbmFile
  | PgmFile
  | PpmFile
  | PfmFile
  | QoiFile
  | TiffFile
  | TgaFile
  | XbmFile;

// Re-export sub-types for consumers
export type {
  PbmFile,
  PgmFile,
  PpmFile,
  PfmFile,
  QoiFile,
  TiffFile,
  TgaFile,
  XbmFile,
  ImageFormat,
};

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export function parseImage(input: Uint8Array, format: ImageFormat): ImageFile {
  switch (format) {
    case 'pbm':
      return parsePbm(input);
    case 'pgm':
      return parsePgm(input);
    case 'ppm':
      return parsePpm(input);
    case 'pfm':
      return parsePfm(input);
    case 'qoi':
      return parseQoi(input);
    case 'tiff':
      return parseTiff(input);
    case 'tga':
      return parseTga(input);
    case 'xbm':
      return parseXbm(input);
  }
}
