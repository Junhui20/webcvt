import { describe, expect, it } from 'vitest';
import { TS_FORMAT, TsBackend } from './backend.ts';

const TS_FORMAT_MIME = 'video/mp2t';
const MKV_FORMAT = { ext: 'mkv', mime: 'video/x-matroska', category: 'video' as const };
const TS_FD = { ext: 'ts', mime: TS_FORMAT_MIME, category: 'video' as const };

describe('TsBackend', () => {
  const backend = new TsBackend();

  it('has name "container-ts"', () => {
    expect(backend.name).toBe('container-ts');
  });

  it('canHandle returns true for video/mp2t → video/mp2t identity', async () => {
    expect(await backend.canHandle(TS_FD, TS_FD)).toBe(true);
  });

  it('canHandle returns false for video/mp2t → video/x-matroska (cross-MIME)', async () => {
    expect(await backend.canHandle(TS_FD, MKV_FORMAT)).toBe(false);
  });

  it('canHandle returns false for video/x-matroska → video/mp2t (wrong input)', async () => {
    expect(await backend.canHandle(MKV_FORMAT, TS_FD)).toBe(false);
  });

  it('canHandle returns false for video/x-matroska → video/x-matroska (not TS)', async () => {
    expect(await backend.canHandle(MKV_FORMAT, MKV_FORMAT)).toBe(false);
  });
});

describe('TS_FORMAT descriptor', () => {
  it('has correct MIME type', () => {
    expect(TS_FORMAT.mime).toBe('video/mp2t');
  });

  it('has correct extension', () => {
    expect(TS_FORMAT.ext).toBe('ts');
  });

  it('has category video', () => {
    expect(TS_FORMAT.category).toBe('video');
  });
});
