import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearToolCache, findTool } from './which.ts';

let binDir: string;
const ORIGINAL_ENV = { ...process.env };

function makeExecutable(name: string): string {
  const p = join(binDir, name);
  writeFileSync(p, '#!/bin/sh\nexit 0\n');
  chmodSync(p, 0o755);
  return p;
}

function makeNonExecutable(name: string): string {
  const p = join(binDir, name);
  writeFileSync(p, 'not executable');
  chmodSync(p, 0o644);
  return p;
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'webcvt-which-'));
  clearToolCache();
  // Isolate PATH and clear any real overrides for deterministic resolution.
  process.env.PATH = binDir;
  for (const v of ['WEBCVT_FFMPEG', 'WEBCVT_PANDOC', 'WEBCVT_LIBREOFFICE', 'WEBCVT_GHOSTSCRIPT']) {
    delete process.env[v];
  }
});

afterEach(() => {
  rmSync(binDir, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
  clearToolCache();
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('findTool — PATH resolution', () => {
  it('resolves a binary present on PATH', () => {
    const p = makeExecutable('ffmpeg');
    expect(findTool('ffmpeg')).toBe(p);
  });

  it('returns null when the binary is absent', () => {
    expect(findTool('ghostscript')).toBeNull();
  });

  it('returns null when PATH is empty', () => {
    process.env.PATH = '';
    clearToolCache();
    expect(findTool('ffmpeg')).toBeNull();
  });

  it('skips a non-executable file of the same name', () => {
    makeNonExecutable('ffmpeg');
    expect(findTool('ffmpeg')).toBeNull();
  });

  it('falls back through multiple candidate names (libreoffice → soffice)', () => {
    const p = makeExecutable('soffice');
    expect(findTool('libreoffice')).toBe(p);
  });
});

describe('findTool — env override', () => {
  it('honors an absolute WEBCVT_<TOOL> override', () => {
    const p = makeExecutable('my-ffmpeg');
    process.env.WEBCVT_FFMPEG = p;
    clearToolCache();
    expect(findTool('ffmpeg')).toBe(p);
  });

  it('returns null when an absolute override points at a non-executable', () => {
    const p = makeNonExecutable('my-ffmpeg');
    process.env.WEBCVT_FFMPEG = p;
    clearToolCache();
    expect(findTool('ffmpeg')).toBeNull();
  });

  it('resolves a bare-name override on PATH', () => {
    const p = makeExecutable('pandoc-custom');
    process.env.WEBCVT_PANDOC = 'pandoc-custom';
    clearToolCache();
    expect(findTool('pandoc')).toBe(p);
  });
});

describe('findTool — caching', () => {
  it('caches a positive result across calls and ignores later PATH changes until cleared', () => {
    const p = makeExecutable('ffmpeg');
    expect(findTool('ffmpeg')).toBe(p);
    // Remove from PATH but do NOT clear the cache — stale hit expected.
    process.env.PATH = '';
    expect(findTool('ffmpeg')).toBe(p);
    // Clearing forces a fresh (now-failing) lookup.
    clearToolCache();
    expect(findTool('ffmpeg')).toBeNull();
  });

  it('caches a negative (null) result', () => {
    expect(findTool('pandoc')).toBeNull();
    // Add it after the null was cached — still null until cache cleared.
    makeExecutable('pandoc');
    expect(findTool('pandoc')).toBeNull();
    clearToolCache();
    expect(findTool('pandoc')).not.toBeNull();
  });
});
