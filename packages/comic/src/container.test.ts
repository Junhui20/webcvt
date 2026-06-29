import { describe, expect, it } from 'vitest';
import { makeRar, makeSevenZip } from './_test-helpers/fixtures.ts';
import { detectComicContainer } from './container.ts';

describe('detectComicContainer', () => {
  it('detects a ZIP local file header as cbz', () => {
    expect(detectComicContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('cbz');
  });

  it('detects a RAR signature as cbr (RAR4 and RAR5 share the prefix)', () => {
    expect(detectComicContainer(makeRar())).toBe('cbr');
    expect(
      detectComicContainer(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])),
    ).toBe('cbr');
  });

  it('detects a 7z signature as cb7', () => {
    expect(detectComicContainer(makeSevenZip())).toBe('cb7');
  });

  it('returns unknown for unrecognised bytes', () => {
    expect(detectComicContainer(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
  });

  it('returns unknown for a buffer shorter than any signature', () => {
    expect(detectComicContainer(new Uint8Array([0x50, 0x4b]))).toBe('unknown');
    expect(detectComicContainer(new Uint8Array(0))).toBe('unknown');
  });

  it('does not match a ZIP EOCD-only (empty archive) header as cbz', () => {
    // "PK\x05\x06" is a valid ZIP marker but not the local file header we key on.
    expect(detectComicContainer(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe('unknown');
  });
});
