/**
 * Tests for format.ts — the JXL FormatDescriptor.
 */

import { describe, expect, it } from 'vitest';
import { JXL_MIME } from './constants.ts';
import { JXL_FORMAT } from './format.ts';

describe('JXL_FORMAT', () => {
  it('describes the jxl image format', () => {
    expect(JXL_FORMAT.ext).toBe('jxl');
    expect(JXL_FORMAT.mime).toBe(JXL_MIME);
    expect(JXL_FORMAT.category).toBe('image');
    expect(JXL_FORMAT.description).toContain('JPEG XL');
  });
});
