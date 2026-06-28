/**
 * HEIC / HEIF FormatDescriptors for @catlabtech/webcvt-image-heic.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { HEIC_MIME, HEIF_MIME } from './constants.ts';

/** Format descriptor for HEIC (HEVC-coded still image in a HEIF container). */
export const HEIC_FORMAT: FormatDescriptor = {
  ext: 'heic',
  mime: HEIC_MIME,
  category: 'image',
  description: 'High Efficiency Image Container (HEIC)',
};

/** Format descriptor for the broader HEIF container. */
export const HEIF_FORMAT: FormatDescriptor = {
  ext: 'heif',
  mime: HEIF_MIME,
  category: 'image',
  description: 'High Efficiency Image File Format (HEIF)',
};
