/**
 * JPEG XL FormatDescriptor for @catlabtech/webcvt-image-jsquash-jxl.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { JXL_MIME } from './constants.ts';

/**
 * Format descriptor for JPEG XL images.
 *
 * JPEG XL (JXL) — ISO/IEC 18181. A royalty-free raster codec supporting both
 * lossy and mathematically-lossless compression, wide gamut, and HDR.
 */
export const JXL_FORMAT: FormatDescriptor = {
  ext: 'jxl',
  mime: JXL_MIME,
  category: 'image',
  description: 'JPEG XL (JXL)',
};
