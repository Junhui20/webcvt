/**
 * Tests for format.ts — the PDF FormatDescriptor.
 */

import { describe, expect, it } from 'vitest';
import { PDF_MIME } from './constants.ts';
import { PDF_FORMAT } from './format.ts';

describe('PDF_FORMAT', () => {
  it('describes the pdf document format', () => {
    expect(PDF_FORMAT.ext).toBe('pdf');
    expect(PDF_FORMAT.mime).toBe(PDF_MIME);
    expect(PDF_FORMAT.category).toBe('document');
    expect(PDF_FORMAT.description).toContain('Portable Document Format');
  });
});
