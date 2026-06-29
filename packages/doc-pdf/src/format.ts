/**
 * Format descriptors for @catlabtech/webcvt-doc-pdf.
 *
 * The `pdf` format is already registered in core's curated format table (by the
 * image-pdf package); these descriptors are re-exported for convenience so a
 * consumer wiring DocPdfBackend does not have to construct them by hand.
 */

import type { FormatDescriptor } from '@catlabtech/webcvt-core';
import { JSON_MIME, PDF_MIME } from './constants.ts';

/** Format descriptor for PDF (the reader's input). */
export const PDF_FORMAT: FormatDescriptor = {
  ext: 'pdf',
  mime: PDF_MIME,
  category: 'document',
  description: 'Portable Document Format',
};

/** Format descriptor for the JSON output of DocPdfBackend. */
export const JSON_FORMAT: FormatDescriptor = {
  ext: 'json',
  mime: JSON_MIME,
  category: 'data',
  description: 'JavaScript Object Notation',
};
