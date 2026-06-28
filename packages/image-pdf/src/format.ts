/**
 * PDF FormatDescriptor for @catlabtech/webcvt-image-pdf.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { PDF_MIME } from './constants.ts';

/** Format descriptor for PDF output (single image wrapped into one page). */
export const PDF_FORMAT: FormatDescriptor = {
  ext: 'pdf',
  mime: PDF_MIME,
  category: 'document',
  description: 'Portable Document Format',
};
