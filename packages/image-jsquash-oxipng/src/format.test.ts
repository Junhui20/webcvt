/**
 * Tests for format.ts — the PNG FormatDescriptor.
 */

import { describe, expect, it } from 'vitest';
import { OXIPNG_MIME } from './constants.ts';
import { OXIPNG_FORMAT } from './format.ts';

describe('OXIPNG_FORMAT', () => {
  it('describes the png image format', () => {
    expect(OXIPNG_FORMAT.ext).toBe('png');
    expect(OXIPNG_FORMAT.mime).toBe(OXIPNG_MIME);
    expect(OXIPNG_FORMAT.category).toBe('image');
    expect(OXIPNG_FORMAT.description).toContain('OxiPNG');
  });
});
