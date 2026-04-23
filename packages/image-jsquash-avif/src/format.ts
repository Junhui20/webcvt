/**
 * AVIF FormatDescriptor for @catlabtech/webcvt-image-jsquash-avif.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { AVIF_MIME } from './constants.ts';

/**
 * Format descriptor for AVIF images.
 *
 * AV1 Image File Format (AVIF) — ISO/IEC 23000-22.
 * Encodes still images using the AV1 video codec inside an HEIF/ISOBMFF container.
 */
export const AVIF_FORMAT: FormatDescriptor = {
  ext: 'avif',
  mime: AVIF_MIME,
  category: 'image',
  description: 'AV1 Image File Format (AVIF)',
};
