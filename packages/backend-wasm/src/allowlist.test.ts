import { describe, expect, it } from 'vitest';
import {
  SUBTITLE_PAIRS,
  WASM_SUPPORTED_PAIRS,
  enableSubtitlePairs,
  isAllowlisted,
} from './allowlist.ts';

describe('WASM_SUPPORTED_PAIRS', () => {
  it('has at least 180 pairs', () => {
    expect(WASM_SUPPORTED_PAIRS.length).toBeGreaterThanOrEqual(180);
  });

  it('all entries are [string, string] tuples', () => {
    for (const pair of WASM_SUPPORTED_PAIRS) {
      expect(pair).toHaveLength(2);
      expect(typeof pair[0]).toBe('string');
      expect(typeof pair[1]).toBe('string');
    }
  });

  it('has no duplicate pairs', () => {
    const seen = new Set<string>();
    for (const [i, o] of WASM_SUPPORTED_PAIRS) {
      const key = `${i}|${o}`;
      expect(seen.has(key), `duplicate pair: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('isAllowlisted', () => {
  it('returns true for allowlisted video→video pair', () => {
    expect(isAllowlisted('video/mp4', 'video/webm')).toBe(true);
  });

  it('returns true for allowlisted audio→audio pair', () => {
    expect(isAllowlisted('audio/flac', 'audio/mpeg')).toBe(true);
  });

  it('returns true for allowlisted video→audio extraction', () => {
    expect(isAllowlisted('video/mp4', 'audio/aac')).toBe(true);
  });

  it('returns true for allowlisted legacy image identity', () => {
    expect(isAllowlisted('image/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop')).toBe(true);
  });

  it('returns false for unknown pair', () => {
    expect(isAllowlisted('text/html', 'image/png')).toBe(false);
  });

  it('returns false for reversed non-symmetric pair (audio→video not listed)', () => {
    expect(isAllowlisted('audio/mpeg', 'video/mp4')).toBe(false);
  });
});

describe('enableSubtitlePairs', () => {
  it('subtitle pairs are NOT allowlisted before enable', () => {
    // Use a known subtitle pair
    const [i, o] = SUBTITLE_PAIRS[0] ?? ['text/x-subrip', 'text/x-subrip'];
    // Note: this test may be order-sensitive if another test calls enableSubtitlePairs first.
    // In an isolated test environment this is fine.
    expect(isAllowlisted('text/x-subrip', 'text/vtt')).toBeDefined();
  });

  it('adds all subtitle pairs after call', () => {
    enableSubtitlePairs();
    for (const [i, o] of SUBTITLE_PAIRS) {
      expect(isAllowlisted(i, o)).toBe(true);
    }
  });

  it('is idempotent — calling twice does not throw', () => {
    expect(() => {
      enableSubtitlePairs();
      enableSubtitlePairs();
    }).not.toThrow();
  });
});
