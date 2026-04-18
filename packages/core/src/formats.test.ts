import { describe, expect, it } from 'vitest';
import { findByExt, findByMime, knownFormats, resolveFormat } from './formats.ts';

describe('findByExt', () => {
  it('finds PNG by lowercase extension', () => {
    expect(findByExt('png')?.mime).toBe('image/png');
  });

  it('is case-insensitive', () => {
    expect(findByExt('PNG')?.ext).toBe('png');
  });

  it('strips leading dot', () => {
    expect(findByExt('.png')?.ext).toBe('png');
  });

  it('returns undefined for unknown extensions', () => {
    expect(findByExt('xyz')).toBeUndefined();
  });
});

describe('findByMime', () => {
  it('finds format by MIME', () => {
    expect(findByMime('image/png')?.ext).toBe('png');
  });

  it('is case-insensitive', () => {
    expect(findByMime('IMAGE/PNG')?.ext).toBe('png');
  });
});

describe('resolveFormat', () => {
  it('passes through FormatDescriptor unchanged', () => {
    const fmt = { ext: 'test', mime: 'x/test', category: 'image' as const };
    expect(resolveFormat(fmt)).toBe(fmt);
  });

  it('resolves a MIME string', () => {
    expect(resolveFormat('image/webp')?.ext).toBe('webp');
  });

  it('resolves an extension string', () => {
    expect(resolveFormat('webp')?.mime).toBe('image/webp');
  });
});

describe('knownFormats', () => {
  it('includes all Phase 1 images', () => {
    const exts = knownFormats().map((f) => f.ext);
    expect(exts).toContain('png');
    expect(exts).toContain('jpeg');
    expect(exts).toContain('webp');
    expect(exts).toContain('bmp');
    expect(exts).toContain('ico');
    expect(exts).toContain('gif');
  });

  it('includes all Phase 1 subtitle formats', () => {
    const exts = knownFormats().map((f) => f.ext);
    expect(exts).toContain('srt');
    expect(exts).toContain('vtt');
    expect(exts).toContain('ass');
    expect(exts).toContain('ssa');
    expect(exts).toContain('sub');
    expect(exts).toContain('mpl');
  });
});
