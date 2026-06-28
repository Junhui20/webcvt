/**
 * PNG FormatDescriptor for @catlabtech/webcvt-image-jsquash-oxipng.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { OXIPNG_MIME } from './constants.ts';

/**
 * Format descriptor for PNG images produced by the OxiPNG optimiser.
 *
 * Note: `image/png` is also handled by `@catlabtech/webcvt-image-canvas`. This
 * backend exists for callers who want OxiPNG's *lossless* size reduction (it
 * re-optimises an existing PNG, or encodes pixels to a smaller PNG than canvas).
 */
export const OXIPNG_FORMAT: FormatDescriptor = {
  ext: 'png',
  mime: OXIPNG_MIME,
  category: 'image',
  description: 'PNG (OxiPNG optimiser)',
};
