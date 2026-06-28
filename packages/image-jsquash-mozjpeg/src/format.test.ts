/**
 * Tests for format.ts — the JPEG FormatDescriptor.
 */

import { describe, expect, it } from 'vitest';
import { MOZJPEG_MIME } from './constants.ts';
import { MOZJPEG_FORMAT } from './format.ts';

describe('MOZJPEG_FORMAT', () => {
  it('describes the jpeg image format', () => {
    expect(MOZJPEG_FORMAT.ext).toBe('jpeg');
    expect(MOZJPEG_FORMAT.mime).toBe(MOZJPEG_MIME);
    expect(MOZJPEG_FORMAT.category).toBe('image');
    expect(MOZJPEG_FORMAT.description).toContain('MozJPEG');
  });
});
