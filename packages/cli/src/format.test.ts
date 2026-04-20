import { describe, expect, it } from 'vitest';
import { inferFormatFromPath, resolveHint } from './format.ts';

describe('resolveHint', () => {
  it("resolveHint('mp3') returns FormatDescriptor for audio/mpeg", () => {
    const fmt = resolveHint('mp3');
    expect(fmt).toBeDefined();
    expect(fmt?.mime).toBe('audio/mpeg');
    expect(fmt?.ext).toBe('mp3');
  });

  it("resolveHint('audio/mpeg') returns mp3 descriptor", () => {
    const fmt = resolveHint('audio/mpeg');
    expect(fmt).toBeDefined();
    expect(fmt?.ext).toBe('mp3');
  });

  it("resolveHint('application/json') returns json descriptor", () => {
    const fmt = resolveHint('application/json');
    expect(fmt).toBeDefined();
    expect(fmt?.ext).toBe('json');
  });

  it("resolveHint('json') returns json descriptor", () => {
    const fmt = resolveHint('json');
    expect(fmt).toBeDefined();
    expect(fmt?.mime).toBe('application/json');
  });

  it("resolveHint('unknown') returns undefined", () => {
    const fmt = resolveHint('unknown-ext-xyz');
    expect(fmt).toBeUndefined();
  });

  it("resolveHint('application/x-unknown') returns undefined", () => {
    const fmt = resolveHint('application/x-unknown-mime');
    expect(fmt).toBeUndefined();
  });

  it("resolveHint detects MIME by '/' presence", () => {
    const fmt = resolveHint('image/qoi');
    expect(fmt).toBeDefined();
    expect(fmt?.ext).toBe('qoi');
  });

  it("resolveHint('qoi') returns QOI descriptor", () => {
    const fmt = resolveHint('qoi');
    expect(fmt?.mime).toBe('image/qoi');
  });
});

describe('inferFormatFromPath', () => {
  it('infers format from .mp3 extension', () => {
    const fmt = inferFormatFromPath('/some/path/audio.mp3');
    expect(fmt?.mime).toBe('audio/mpeg');
  });

  it('infers format from .json extension', () => {
    const fmt = inferFormatFromPath('data.json');
    expect(fmt?.ext).toBe('json');
  });

  it('returns undefined for path with no extension (Makefile)', () => {
    const fmt = inferFormatFromPath('Makefile');
    expect(fmt).toBeUndefined();
  });

  it('returns undefined for unknown extension', () => {
    const fmt = inferFormatFromPath('file.unknownxyz');
    expect(fmt).toBeUndefined();
  });

  it('handles uppercase extension (Trap #12 Windows paths)', () => {
    // extname returns .MP3 but findByExt lowercases
    const fmt = inferFormatFromPath('file.MP3');
    expect(fmt?.mime).toBe('audio/mpeg');
  });

  it("returns undefined for stdout '-'", () => {
    const fmt = inferFormatFromPath('-');
    expect(fmt).toBeUndefined();
  });
});
