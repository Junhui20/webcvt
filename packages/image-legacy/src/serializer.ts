/**
 * Top-level image serializer dispatcher for @catlabtech/webcvt-image-legacy.
 *
 * serializeImage(file) switches on file.format and routes to the appropriate
 * per-format serializer.
 */

import { serializeIcns } from './icns.ts';
import { serializePbm, serializePgm, serializePpm } from './netpbm.ts';
import type { ImageFile } from './parser.ts';
import { serializePcx } from './pcx.ts';
import { serializePfm } from './pfm.ts';
import { serializeQoi } from './qoi.ts';
import { serializeTga } from './tga.ts';
import { serializeTiff } from './tiff.ts';
import { serializeXbm } from './xbm.ts';
import { serializeXpm } from './xpm.ts';

export function serializeImage(file: ImageFile): Uint8Array {
  switch (file.format) {
    case 'pbm':
      return serializePbm(file);
    case 'pgm':
      return serializePgm(file);
    case 'ppm':
      return serializePpm(file);
    case 'pfm':
      return serializePfm(file);
    case 'qoi':
      return serializeQoi(file);
    case 'tiff':
      return serializeTiff(file);
    case 'tga':
      return serializeTga(file);
    case 'xbm':
      return serializeXbm(file);
    case 'pcx':
      return serializePcx(file);
    case 'xpm':
      return serializeXpm(file);
    case 'icns':
      return serializeIcns(file);
  }
}
