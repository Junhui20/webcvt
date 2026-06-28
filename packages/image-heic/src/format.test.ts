/**
 * Tests for format.ts — the HEIC / HEIF FormatDescriptors.
 */

import { describe, expect, it } from 'vitest';
import { HEIC_FORMAT, HEIF_FORMAT } from './format.ts';

describe('HEIC_FORMAT / HEIF_FORMAT', () => {
  it('HEIC descriptor', () => {
    expect(HEIC_FORMAT.ext).toBe('heic');
    expect(HEIC_FORMAT.mime).toBe('image/heic');
    expect(HEIC_FORMAT.category).toBe('image');
  });

  it('HEIF descriptor', () => {
    expect(HEIF_FORMAT.ext).toBe('heif');
    expect(HEIF_FORMAT.mime).toBe('image/heif');
    expect(HEIF_FORMAT.category).toBe('image');
  });
});
