/**
 * JPEG FormatDescriptor for @catlabtech/webcvt-image-jsquash-mozjpeg.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { MOZJPEG_MIME } from './constants.ts';

/**
 * Format descriptor for JPEG images produced/consumed by the MozJPEG codec.
 *
 * Note: `image/jpeg` is also handled by `@catlabtech/webcvt-image-canvas`. This
 * backend exists for callers who want MozJPEG's superior compression / trellis
 * quantisation rather than the browser's built-in JPEG encoder.
 */
export const MOZJPEG_FORMAT: FormatDescriptor = {
  ext: 'jpeg',
  mime: MOZJPEG_MIME,
  category: 'image',
  description: 'JPEG (MozJPEG encoder)',
};
